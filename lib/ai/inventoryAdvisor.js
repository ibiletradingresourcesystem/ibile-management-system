/**
 * AI Inventory Advisor
 * 
 * Analyzes inventory health and generates actionable recommendations:
 * restock, discount, bundle, stop purchasing, transfer between branches.
 */
import { executeRecommendationPipeline } from "./orchestrator";
import { calculateInventoryValue, calculateLowStock, calculateDeadStock, calculateInventoryHealth } from "@/lib/analytics/inventoryAnalytics";
import { calculatePurchaseMetrics } from "@/lib/analytics/profitAnalytics";
import { buildSalesDateRange } from "@/lib/analytics/salesAnalytics";

const INVENTORY_PROMPT = `You are a senior inventory management consultant for a Nigerian retail business.
Analyze the inventory data and provide actionable recommendations.

RULES:
- Currency is Nigerian Naira (â‚¦)
- Be specific about which products need attention
- Prioritize by financial impact
- Consider seasonality in Nigeria
- Provide concrete actions, not vague advice

Return JSON:
{
  "overallAssessment": "brief assessment of inventory health",
  "immediateActions": [{"action": "string", "products": ["name"], "reason": "string", "impact": "â‚¦ amount", "urgency": "critical|high|medium"}],
  "restockRecommendations": [{"product": "name", "quantity": number, "reason": "string"}],
  "discountCandidates": [{"product": "name", "reason": "string", "suggestedDiscount": "10-30%"}],
  "stopPurchasing": [{"product": "name", "reason": "string", "tiedUpValue": "â‚¦ amount"}],
  "bundleSuggestions": [{"products": ["name1", "name2"], "reason": "string"}],
  "risks": [{"risk": "string", "severity": "high|medium|low", "mitigation": "string"}],
  "opportunities": [{"opportunity": "string", "potentialBenefit": "â‚¦ amount"}],
  "healthScore": 0-100,
  "confidence": 0-100,
  "priority": "critical|high|medium|low"
}

INVENTORY DATA:
`;

/**
 * Generate inventory advisor recommendations
 * @param {Object} [options]
 * @param {boolean} [options.forceRegenerate=false]
 * @param {string} [options.location]
 * @returns {Promise<Object>}
 */
export async function generateInventoryAdvice(options = {}) {
  const dateRange = buildSalesDateRange("last30");

  const [inventoryValue, lowStock, deadStock, health, purchases] = await Promise.all([
    calculateInventoryValue(),
    calculateLowStock(15),
    calculateDeadStock(30),
    calculateInventoryHealth(),
    calculatePurchaseMetrics(dateRange),
  ]);

  const metrics = {
    inventoryValue,
    lowStock: { count: lowStock.lowStockCount, products: lowStock.lowStockProducts.slice(0, 10) },
    deadStock: { count: deadStock.deadStockCount, totalTiedUp: deadStock.totalTiedUpValue, products: deadStock.deadStockProducts.slice(0, 10) },
    health,
    purchases,
  };

  return executeRecommendationPipeline({
    recommendationType: "inventory",
    entityType: "global",
    entityName: "Inventory Health",
    metrics,
    generateAI: async (m) => {
      const prompt = INVENTORY_PROMPT + JSON.stringify(m, null, 2);
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
      recommendation: aiData.overallAssessment || "",
      reason: (aiData.immediateActions || []).map(a => a.action).join("; "),
      priority: aiData.priority || "medium",
      confidence: aiData.confidence || 0,
      estimatedBenefit: (aiData.opportunities || []).reduce((s, o) => s + (parseInt(String(o.potentialBenefit).replace(/[^0-9]/g, "")) || 0), 0),
      riskLevel: aiData.risks?.length > 2 ? "high" : aiData.risks?.length > 0 ? "medium" : "low",
      category: "inventory",
      data: aiData,
    }),
    forceRegenerate: options.forceRegenerate,
    location: options.location,
  });
}
