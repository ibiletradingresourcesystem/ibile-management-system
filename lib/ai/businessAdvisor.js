/**
 * AI Business Recommendation Engine
 * 
 * Combines all business metrics to generate holistic recommendations
 * covering sales, inventory, profit, expenses, purchasing, and operations.
 */
import { executeRecommendationPipeline } from "./orchestrator";
import { generateDashboardMetrics } from "@/lib/analytics/dashboardAnalytics";

const BUSINESS_PROMPT = `You are a senior business advisor for a Nigerian retail/inventory management company.
Analyze all business metrics comprehensively and provide strategic recommendations.

RULES:
- Currency: Nigerian Naira (â‚¦)
- Be specific and actionable
- Prioritize by financial impact
- Consider Nigerian market conditions
- Each recommendation must include implementation difficulty and expected benefit

Return JSON:
{
  "strategicSummary": "2-3 sentence business strategy overview",
  "recommendations": [
    {
      "title": "short action title",
      "description": "detailed recommendation",
      "category": "sales|inventory|pricing|expenses|purchasing|operations",
      "priority": "critical|high|medium|low",
      "estimatedBenefit": "â‚¦ amount or percentage",
      "difficulty": "easy|moderate|hard",
      "timeframe": "immediate|short-term|medium-term|long-term",
      "riskLevel": "low|medium|high"
    }
  ],
  "businessRisks": [{"risk": "string", "severity": "high|medium|low", "mitigation": "string"}],
  "businessOpportunities": [{"opportunity": "string", "potentialBenefit": "â‚¦ amount", "effort": "low|medium|high"}],
  "keyMetrics": {
    "healthScore": 0-100,
    "growthOutlook": "positive|neutral|negative",
    "cashFlowRisk": "low|medium|high",
    "inventoryEfficiency": "good|fair|poor"
  },
  "confidence": 0-100,
  "priority": "critical|high|medium|low"
}

BUSINESS METRICS:
`;

/**
 * Generate comprehensive business recommendations
 * @param {Object} [options]
 * @param {string} [options.period="month"]
 * @param {string} [options.location]
 * @param {boolean} [options.forceRegenerate]
 * @returns {Promise<Object>}
 */
export async function generateBusinessRecommendations(options = {}) {
  const { period = "month", location, forceRegenerate = false } = options;
  const metrics = await generateDashboardMetrics(period, location);

  return executeRecommendationPipeline({
    recommendationType: "business",
    entityType: "global",
    entityName: "Business Strategy",
    metrics,
    generateAI: async (m) => {
      const prompt = BUSINESS_PROMPT + JSON.stringify(m, null, 2);
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
      recommendation: aiData.strategicSummary || "",
      reason: (aiData.recommendations || []).slice(0, 3).map((r) => r.title).join(", "),
      priority: aiData.priority || "medium",
      confidence: aiData.confidence || 0,
      estimatedBenefit: (aiData.recommendations || []).reduce((s, r) => s + (parseInt(String(r.estimatedBenefit).replace(/[^0-9]/g, "")) || 0), 0),
      riskLevel: (aiData.businessRisks || []).some((r) => r.severity === "high") ? "high" : "medium",
      category: "business",
      data: aiData,
    }),
    forceRegenerate,
    location: location || "All Locations",
  });
}
