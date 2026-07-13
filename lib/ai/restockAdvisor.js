/**
 * AI Restock Recommendation Engine
 * 
 * Calculates optimal restock quantities based on sales velocity,
 * lead times, safety stock, and seasonal demand patterns.
 */
import { executeRecommendationPipeline } from "./orchestrator";
import Product from "@/models/Product";
import { Transaction } from "@/models/Transactions";

const RESTOCK_PROMPT = `You are a supply chain analyst for a Nigerian retail business.
Analyze stock levels and sales velocity to recommend restock quantities.

RULES:
- Currency is Nigerian Naira (₦)
- Consider average daily sales rate
- Factor in 3-7 day lead time for local suppliers
- Safety stock = 3 days of average sales minimum
- Flag critical items that may stock out within 3 days
- Order quantities should be in practical amounts (not fractions)

Return JSON:
{
  "urgentRestock": [{"product": "name", "currentStock": number, "recommendedQty": number, "daysUntilStockout": number, "urgency": "critical|high|medium", "estimatedCost": number}],
  "routineRestock": [{"product": "name", "currentStock": number, "recommendedQty": number, "daysUntilStockout": number, "reason": "string"}],
  "doNotRestock": [{"product": "name", "reason": "string"}],
  "totalEstimatedCost": number,
  "recommendedOrderDate": "ASAP|This week|Next week",
  "summary": "brief summary",
  "confidence": 0-100,
  "priority": "critical|high|medium|low"
}

STOCK & SALES DATA:
`;

/**
 * Generate restock recommendations
 * @param {Object} [options]
 * @param {boolean} [options.forceRegenerate]
 * @returns {Promise<Object>}
 */
export async function generateRestockRecommendations(options = {}) {
  // Get products needing restock attention
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  const products = await Product.find({
    isArchived: { $ne: true },
    isStockManaged: true,
    quantity: { $lte: 50 }, // Focus on products with limited stock
  })
    .select("name quantity costPrice salePriceIncTax minStock maxStock lastSoldAt totalUnitsSold")
    .sort({ quantity: 1 })
    .limit(30)
    .lean();

  // Get sales velocity for these products
  const productIds = products.map((p) => p._id);
  const salesVelocity = await Transaction.aggregate([
    {
      $match: {
        status: "completed",
        subStatus: { $ne: "void" },
        createdAt: { $gte: thirtyDaysAgo },
      },
    },
    { $unwind: "$items" },
    { $match: { "items.productId": { $in: productIds } } },
    {
      $group: {
        _id: "$items.productId",
        totalSold: { $sum: { $ifNull: ["$items.qty", "$items.quantity"] } },
      },
    },
  ]);

  const velocityMap = {};
  salesVelocity.forEach((v) => { velocityMap[String(v._id)] = v.totalSold; });

  const metrics = {
    products: products.map((p) => ({
      name: p.name,
      currentStock: p.quantity,
      costPrice: p.costPrice || 0,
      minStock: p.minStock || 5,
      maxStock: p.maxStock || 100,
      avgDailySales: Math.round(((velocityMap[String(p._id)] || 0) / 30) * 10) / 10,
      totalSoldLast30Days: velocityMap[String(p._id)] || 0,
      daysOfStock: (velocityMap[String(p._id)] || 1) > 0 ? Math.round(p.quantity / ((velocityMap[String(p._id)] || 1) / 30)) : 999,
    })),
    analysisDate: new Date().toISOString().split("T")[0],
  };

  return executeRecommendationPipeline({
    recommendationType: "restock",
    entityType: "global",
    entityName: "Restock Plan",
    metrics,
    generateAI: async (m) => {
      const prompt = RESTOCK_PROMPT + JSON.stringify(m, null, 2);
      const startTime = Date.now();
      try {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
        const parsed = JSON.parse(jsonMatch[1].trim());
        return { success: true, data: parsed, meta: { provider: "google", model: "gemini-1.5-flash", executionTimeMs: Date.now() - startTime, promptLength: prompt.length, responseLength: text.length } };
      } catch (err) {
        return { success: false, error: err.message, meta: { provider: "google", model: "gemini-1.5-flash", executionTimeMs: Date.now() - startTime } };
      }
    },
    formatResult: (aiData) => ({
      recommendation: aiData.summary || "",
      reason: `${(aiData.urgentRestock || []).length} urgent, ${(aiData.routineRestock || []).length} routine items`,
      priority: aiData.priority || "medium",
      confidence: aiData.confidence || 0,
      estimatedBenefit: aiData.totalEstimatedCost || 0,
      riskLevel: (aiData.urgentRestock || []).length > 3 ? "high" : "medium",
      category: "restock",
      data: aiData,
    }),
    forceRegenerate: options.forceRegenerate,
  });
}
