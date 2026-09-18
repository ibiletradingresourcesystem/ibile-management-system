/**
 * AI Pricing Assistant
 * 
 * Recommends a selling price by working in mark-up — what to add on top of cost — since that is
 * how a price is built from what the stock cost. The product screen reports the resulting profit
 * margin. Never updates prices automatically.
 */
import { executeRecommendationPipeline } from "./orchestrator";
import { generateBusinessSummary } from "./gemini";
import { calculateMarginPercent, calculateMarkupPercent, normalizeTaxRate } from "@/lib/pricing";

const PRICING_PROMPT = `You are a retail pricing strategist for a Nigerian market.
Analyze the product data below and recommend an optimal selling price.

RULES:
- Currency is Nigerian Naira (â‚¦)
- Work in mark-up: recommendedPrice = costPrice x (1 + recommendedMarkup / 100)
- currentMarkup is (price - cost) / cost, what is added on top of cost to reach today's price
- currentMargin is (price - cost) / price, the share of that price that is profit, for context
- Never recommend a mark-up that puts the price below cost
- Consider cost price, current margin, sales velocity, stock levels
- Higher sales velocity products can maintain current margins
- Slow-moving products may need price reduction to clear stock
- Never recommend selling below cost price
- Consider market positioning

Return a JSON object:
{
  "recommendedPrice": number,
  "recommendedMarkup": number (percentage added on top of cost),
  "currentMarkup": number (percentage),
  "priceChange": number (positive=increase, negative=decrease),
  "reason": "brief explanation",
  "expectedRevenueImpact": "increase/decrease/neutral",
  "expectedProfitImpact": "increase/decrease/neutral",
  "confidence": 0-100,
  "riskLevel": "low|medium|high",
  "priority": "critical|high|medium|low",
  "strategy": "maintain|increase|decrease|promotional"
}

PRODUCT DATA:
`;

/**
 * Generate pricing recommendation for a product
 * @param {Object} product - Product document with sales data
 * @param {Object} [options]
 * @param {boolean} [options.forceRegenerate=false]
 * @returns {Promise<Object>}
 */
export async function generatePricingRecommendation(product, options = {}) {
  const metrics = buildPricingMetrics(product);

  return executeRecommendationPipeline({
    recommendationType: "pricing",
    entityType: "product",
    entityId: product._id,
    entityName: product.name,
    metrics,
    generateAI: async (m) => {
      const prompt = PRICING_PROMPT + JSON.stringify(m, null, 2);
      const startTime = Date.now();
      try {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
        const parsed = JSON.parse(jsonMatch[1].trim());
        return {
          success: true,
          data: parsed,
          meta: { provider: "google", model: "gemini-2.0-flash", executionTimeMs: Date.now() - startTime, promptLength: prompt.length, responseLength: text.length },
        };
      } catch (err) {
        return { success: false, error: err.message, meta: { provider: "google", model: "gemini-2.0-flash", executionTimeMs: Date.now() - startTime } };
      }
    },
    formatResult: (aiData) => ({
      recommendation: `${aiData.strategy === "increase" ? "Increase" : aiData.strategy === "decrease" ? "Decrease" : "Maintain"} price to â‚¦${Number(aiData.recommendedPrice || 0).toLocaleString()} (${aiData.recommendedMarkup ?? aiData.recommendedMargin ?? 0}% mark-up)`,
      reason: aiData.reason || "",
      priority: aiData.priority || "medium",
      confidence: aiData.confidence || 0,
      estimatedBenefit: aiData.priceChange ? Math.abs(aiData.priceChange) * (product.totalUnitsSold || 1) : 0,
      riskLevel: aiData.riskLevel || "low",
      category: "pricing",
      data: aiData,
    }),
    forceRegenerate: options.forceRegenerate,
  });
}

/**
 * Build pricing metrics from product data
 */
function buildPricingMetrics(product) {
  const costPrice = product.costPrice || 0;
  const sellingPrice = product.salePriceIncTax || 0;
  // The same sums the product card uses, so the panel never quotes a different margin
  const taxRate = normalizeTaxRate(product.taxRate);
  const markup = calculateMarkupPercent(costPrice, sellingPrice);
  const margin = calculateMarginPercent(costPrice, sellingPrice);
  const daysSinceLastSale = product.lastSoldAt
    ? Math.floor((Date.now() - new Date(product.lastSoldAt).getTime()) / 86400000)
    : 999;

  return {
    productName: product.name,
    costPrice,
    currentSellingPrice: sellingPrice,
    currentMarkup: Math.round(markup * 10) / 10,
    currentMargin: Math.round(margin * 10) / 10,
    vatRate: taxRate,
    quantity: product.quantity || 0,
    totalUnitsSold: product.totalUnitsSold || 0,
    totalRevenue: product.totalRevenue || 0,
    daysSinceLastSale,
    isStockManaged: product.isStockManaged || false,
    minStock: product.minStock || 0,
    isPromotion: product.isPromotion || false,
    category: product.category?.name || "",
  };
}
