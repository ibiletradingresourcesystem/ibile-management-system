/**
 * AI Product Performance Analysis
 * 
 * Categorizes products by performance and generates improvement recommendations.
 * Categories: Star, Growth, Stable, Slow, Declining, Dead Stock, Promotion Candidate, Discontinue.
 */
import { executeRecommendationPipeline } from "./orchestrator";
import Product from "@/models/Product";
import { calculateMarginPercent, normalizeTaxRate } from "@/lib/pricing";
import { Transaction } from "@/models/Transactions";
import { generateAIText } from "./provider";
import { calculateDeadStock } from "@/lib/analytics/inventoryAnalytics";
import { SHOP_RULES_FOR_AI } from "./shopRules";

const PERFORMANCE_PROMPT = `You are a product portfolio analyst for a Nigerian retail business.
Analyze product performance data and categorize each product.

CATEGORIES:
- Star: High sales velocity + high margin
- Growth: Increasing sales trend
- Stable: Consistent moderate sales
- Slow: Below average sales velocity
- Declining: Decreasing sales trend
- Dead Stock: "isDeadStock" is true (worked out by the shop rule below; use it as given)
- Promotion Candidate: Good product, needs sales boost
- Discontinue Candidate: Low margin + no sales + high stock age

${SHOP_RULES_FOR_AI}

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
  const now = Date.now();
  const thirtyDaysAgo = new Date(now - 30 * 86400000);
  const sixtyDaysAgo = new Date(now - 60 * 86400000);
  const ninetyDaysAgo = new Date(now - 90 * 86400000);
  const units = { $ifNull: ["$items.qty", "$items.quantity"] };
  const revenue = { $multiply: [{ $ifNull: ["$items.salePriceIncTax", "$items.price"] }, units] };
  const inLast30 = { $gte: ["$createdAt", thirtyDaysAgo] };
  const inPrevious30 = { $and: [{ $gte: ["$createdAt", sixtyDaysAgo] }, { $lt: ["$createdAt", thirtyDaysAgo] }] };

  // Three months of sales by product, read from the sales themselves: the product's own sales
  // totals and last-sold date are never kept, so every product looked unsold. Credit sales are
  // sales: leaving them out understated every product sold on account.
  const [sales, deadStock] = await Promise.all([
    Transaction.aggregate([
      { $match: { status: { $in: ["completed", "credit"] }, subStatus: { $ne: "void" }, createdAt: { $gte: ninetyDaysAgo } } },
      { $unwind: "$items" },
      { $match: { "items.productId": { $ne: null } } },
      {
        $group: {
          _id: "$items.productId",
          units30: { $sum: { $cond: [inLast30, units, 0] } },
          revenue30: { $sum: { $cond: [inLast30, revenue, 0] } },
          unitsPrevious30: { $sum: { $cond: [inPrevious30, units, 0] } },
          revenuePrevious30: { $sum: { $cond: [inPrevious30, revenue, 0] } },
          units90: { $sum: units },
          lastSold: { $max: "$createdAt" },
        },
      },
    ]),
    calculateDeadStock(),
  ]);

  // The 30 biggest sellers of the last two months, and the dead stock holding the most money
  const salesById = new Map(sales.map((row) => [String(row._id), row]));
  const deadIds = new Set(deadStock.deadStockProducts.slice(0, 10).map((product) => product.productId));
  const topIds = sales
    .sort((a, b) => (b.revenue30 + b.revenuePrevious30) - (a.revenue30 + a.revenuePrevious30))
    .slice(0, 30)
    .map((row) => String(row._id));
  const products = await Product.find({ _id: { $in: [...new Set([...topIds, ...deadIds])] }, isArchived: { $ne: true }, isStockManaged: true })
    .select("name quantity costPrice salePriceIncTax taxRate minStock")
    .lean();

  const metrics = {
    products: products.map((p) => {
      const row = salesById.get(String(p._id)) || { units30: 0, revenue30: 0, unitsPrevious30: 0, units90: 0, lastSold: null };
      // The product's own mark-up on cost, so this reads the same as the product screen
      const margin = calculateMarginPercent(p.costPrice, p.salePriceIncTax, normalizeTaxRate(p.taxRate));
      const trend = row.unitsPrevious30 > 0
        ? ((row.units30 - row.unitsPrevious30) / row.unitsPrevious30) * 100
        : row.units30 > 0 ? 100 : 0;

      return {
        name: p.name,
        currentStock: p.quantity,
        costPrice: p.costPrice || 0,
        sellingPrice: p.salePriceIncTax || 0,
        margin: Math.round(margin),
        last30DaysSales: row.units30,
        last30DaysRevenue: Math.round(row.revenue30),
        previous30DaysSales: row.unitsPrevious30,
        last90DaysSales: row.units90,
        salesTrend: Math.round(trend),
        // Null when it has not sold in the last 3 months at all
        daysSinceLastSale: row.lastSold ? Math.floor((now - new Date(row.lastSold).getTime()) / 86400000) : null,
        isDeadStock: deadIds.has(String(p._id)),
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
      const result = await generateAIText(prompt, { json: true });
      return result.success
        ? { success: true, data: result.data, meta: result.meta }
        : { success: false, error: result.error, meta: { ...result.meta, executionTimeMs: Date.now() - startTime } };
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
