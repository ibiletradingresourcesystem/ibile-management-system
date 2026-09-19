/**
 * AI Chat Service
 * 
 * Handles the hybrid support + AI chat system.
 * Flow: User message â†’ Check knowledge base â†’ Check cached AI â†’ Generate new AI response
 */
import { generateDashboardMetrics } from "@/lib/analytics/dashboardAnalytics";
import { getRecommendations } from "./orchestrator";
import AIInsight from "@/models/AIInsight";
import { generateAIText } from "./provider";

/**
 * Build business context for AI chat (summarized analytics only, never raw data)
 * @returns {Promise<Object>}
 */
export async function buildBusinessContext() {
  try {
    const [metrics, recommendations, latestInsight] = await Promise.all([
      generateDashboardMetrics("today").catch(() => null),
      getRecommendations({ limit: 10, status: "pending" }).catch(() => []),
      AIInsight.findOne({ reportType: "monthly" }).sort({ generatedAt: -1 }).lean().catch(() => null),
    ]);

    return {
      currentDate: new Date().toISOString().split("T")[0],
      todaySales: metrics?.sales?.totalSales || 0,
      todayTransactions: metrics?.sales?.transactionCount || 0,
      monthSales: metrics?.sales?.totalSales || 0,
      grossProfit: metrics?.profit?.grossProfit || 0,
      netProfit: metrics?.profit?.netProfit || 0,
      grossMargin: metrics?.profit?.grossMargin || 0,
      inventoryValue: metrics?.inventory?.totalCostValue || 0,
      lowStockCount: metrics?.stockHealth?.lowStockCount || 0,
      deadStockCount: metrics?.stockHealth?.deadStockCount || 0,
      healthScore: metrics?.stockHealth?.healthScore || 0,
      pendingRecommendations: recommendations.length,
      topProducts: (metrics?.topProducts || []).slice(0, 5).map(p => p.name),
      latestInsight: latestInsight?.summary || "",
      salesGrowth: metrics?.growth?.salesGrowth || 0,
    };
  } catch (err) {
    console.error("[AI Chat] Context build error:", err.message);
    return { currentDate: new Date().toISOString().split("T")[0], error: "Context unavailable" };
  }
}

const CHAT_SYSTEM_PROMPT = `You are an AI Business Assistant for a Nigerian retail/inventory management business.
You have access to real-time business context provided below.

RULES:
- Currency: Nigerian Naira (â‚¦)
- Be concise, professional, and actionable
- If asked about specific numbers, use the context provided
- For pricing/inventory/restock questions, mention that detailed recommendations are available in the AI Decision Center
- Never fabricate data â€” if context doesn't contain the answer, say so
- Keep responses under 200 words unless explicitly asked for detail
- Focus on actionable business advice

CURRENT BUSINESS CONTEXT:
`;

/**
 * Process a chat message through the hybrid system
 * @param {string} message - User's message
 * @param {Array} conversationHistory - Previous messages for context
 * @returns {Promise<Object>}
 */
export async function processAIChatMessage(message, conversationHistory = [], providerOverride = null) {
  const startTime = Date.now();

  // Build business context
  const context = await buildBusinessContext();

  // Construct the full prompt with context + conversation history
  const historyText = conversationHistory.slice(-6).map(m =>
    `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`
  ).join("\n");

  const prompt = `${CHAT_SYSTEM_PROMPT}${JSON.stringify(context, null, 2)}

${historyText ? `CONVERSATION HISTORY:\n${historyText}\n\n` : ""}User: ${message}

Respond helpfully and concisely:`;

  const result = await generateAIText(prompt, { provider: providerOverride });

  if (result.success) {
    return {
      success: true,
      response: result.text,
      context: { salesToday: context.todaySales, healthScore: context.healthScore },
      meta: { ...result.meta, executionTimeMs: Date.now() - startTime },
    };
  }

  // The reason matters here. The old code swallowed it and always said "try
  // again", which hid an invalid key or an exhausted quota indefinitely.
  console.error("[AI Chat] Generation error:", result.error);
  return {
    success: false,
    response: result.error,
    error: result.error,
    meta: { ...result.meta, executionTimeMs: Date.now() - startTime },
  };
}

/** Suggested questions for the chat interface */
export const SUGGESTED_QUESTIONS = [
  "Summarize today's business performance",
  "What products should I restock?",
  "Which products should I discontinue?",
  "Show pricing recommendations",
  "What inventory needs attention?",
  "What should I focus on today?",
  "Why are sales declining?",
  "Summarize this month's report",
];
