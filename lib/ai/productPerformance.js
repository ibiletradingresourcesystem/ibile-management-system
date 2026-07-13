/**
 * AI Product Performance Analysis
 * 
 * Categorizes products by performance and generates improvement recommendations.
 * Categories: Star, Growth, Stable, Slow, Declining, Dead Stock, Promotion Candidate, Discontinue.
 */
import { executeRecommendationPipeline } from "./orchestrator";
import Product from "@/models/Product";
import { Transaction } from "@/models/Transactions";

const PERFORMANCE_PROMPT = `You are a product portfolio analyst for a Nigerian retail business.
Analyze product performance data and categorize each product.

CATEGORIES:
- Star: High sales velocity + high margin
- Growth: Increasing sales trend
- Stable: Consistent moderate sales
- Slow: Below average sales velocity
- Declining: Decreasing sales trend
- Dead Stock: No sales in 30+ days with stock remaining
- Promotion Candidate: Good product, needs sales boost
- Discontinue Candidate: Low margin + no sales + high stock age

RULES:
- Be objective, data-driven
- Currency: Nigerian Naira (₦)
- Focus on top 15-20 most impactful products
- Provide specific actionable recommendations per product

Return JSON:
{
  "productAnalysis": [
    {
      "name": "product name",
      "category": "Star|Growth|Stable|Slow|Declining|Dead Stock|Promotion Candidate|Discontinue Candidate",
      "salesVelocity": "high|medium|low|none",
      "profitContribution": "high|medium|low",
      "recommendation": "brief specific action",
      "priority": "high|medium|low"
    }
  ],
  "starProducts": ["name1", "name2"],
  "atRiskProducts": ["name1", "name2"],
  "promotionCandidates": ["name1", "name2"],
  "discontinueCandidates": ["name1"],
  "overallInsight": "brief portfolio summary",
  "confidence": 0-100,
  "priority": "high|medium|low"
}

PRODUCT PERFORMANCE DATA:
`;

/**
 * Generate product performance analysis
 * @param {Object} [options]
 * @param {boolean} [options.forceRegenerate]
 * @returns {Promise<Object>}
 */
export async function generateProductPerformanceAnalysis(options = {}) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000);

  // Get top products by total revenue
  const products = await Product.find({ isArchived: { $ne: true }, isStockManaged: true })
    .select("name quantity costPrice salePriceIncTax totalUnitsSold totalRevenue lastSoldAt minStock")
    .sort({ totalRevenue: -1 })
    .limit(30)
    .lean();

  const productIds = products.map((p) => p._id);

  // Recent 30-day sales
  const [recentSales, previousSales] = await Promise.all([
    Transaction.aggregate([
      { $match: { status: "completed", subStatus: { $ne: "void" }, createdAt: { $gte: thirtyDaysAgo } } },
      { $unwind: "$items" },
      { $match: { "items.productId": { $in: productIds } } },
      { $group: { _id: "$items.productId", units: { $sum: { $ifNull: ["$items.qty", "$items.quantity"] } }, revenue: { $sum: { $multiply: [{ $ifNull: ["$items.salePriceIncTax", "$items.price"] }, { $ifNull: ["$items.qty", "$items.quantity"] }] } } } },
    ]),
    Transaction.aggregate([
      { $match: { status: "completed", subStatus: { $ne: "void" }, createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } } },
      { $unwind: "$items" },
      { $match: { "items.productId": { $in: productIds } } },
      { $group: { _id: "$items.productId", units: { $sum: { $ifNull: ["$items.qty", "$items.quantity"] } }, revenue: { $sum: { $multiply: [{ $ifNull: ["$items.salePriceIncTax", "$items.price"] }, { $ifNull: ["$items.qty", "$items.quantity"] }] } } } },
    ]),
  ]);

  const recentMap = {};
  recentSales.forEach((s) => { recentMap[String(s._id)] = s; });
  const prevMap = {};
  previousSales.forEach((s) => { prevMap[String(s._id)] = s; });

  const metrics = {
    products: products.map((p) => {
      const recent = recentMap[String(p._id)] || { units: 0, revenue: 0 };
      const prev = prevMap[String(p._id)] || { units: 0, revenue: 0 };
      const margin = p.salePriceIncTax > 0 ? ((p.salePriceIncTax - (p.costPrice || 0)) / p.salePriceIncTax) * 100 : 0;
      const trend = prev.units > 0 ? ((recent.units - prev.units) / prev.units) * 100 : recent.units > 0 ? 100 : 0;

      return {
        name: p.name,
        currentStock: p.quantity,
        costPrice: p.costPrice || 0,
        sellingPrice: p.salePriceIncTax || 0,
        margin: Math.round(margin),
        last30DaysSales: recent.units,
        last30DaysRevenue: Math.round(recent.revenue),
        previous30DaysSales: prev.units,
        salesTrend: Math.round(trend),
        totalLifetimeSold: p.totalUnitsSold || 0,
        daysSinceLastSale: p.lastSoldAt ? Math.floor((Date.now() - new Date(p.lastSoldAt).getTime()) / 86400000) : 999,
      };
    }),
  };

  return executeRecommendationPipeline({
    recommendationType: "product-performance",
    entityType: "global",
    entityName: "Product Portfolio",
    metrics,
    generateAI: async (m) => {
      const prompt = PERFORMANCE_PROMPT + JSON.stringify(m, null, 2);
      const startTime = Date.now();
      try {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
        const parsed = JSON.parse(jsonMatch[1].trim());
        return { success: true, data: parsed, meta: { provider: "google", model: "gemini-2.0-flash", executionTimeMs: Date.now() - startTime, promptLength: prompt.length, responseLength: text.length } };
      } catch (err) {
        return { success: false, error: err.message, meta: { provider: "google", model: "gemini-2.0-flash", executionTimeMs: Date.now() - startTime } };
      }
    },
    formatResult: (aiData) => ({
      recommendation: aiData.overallInsight || "",
      reason: `${(aiData.starProducts || []).length} stars, ${(aiData.atRiskProducts || []).length} at risk`,
      priority: aiData.priority || "medium",
      confidence: aiData.confidence || 0,
      category: "product-performance",
      data: aiData,
    }),
    forceRegenerate: options.forceRegenerate,
  });
}
