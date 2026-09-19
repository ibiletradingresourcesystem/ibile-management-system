/**
 * Business report generation.
 *
 * The prompts live here; the network call goes through `lib/ai/provider`, so
 * the same prompts run on Google Gemini or OpenAI depending on what the
 * business selected. The module keeps its original name and exports so nothing
 * that imports it has to change.
 */
import { generateAIText } from "./provider";

// ─── PROMPT TEMPLATES ────────────────────────────────────────────────

const REPORT_SUMMARY_PROMPT = `You are a senior business analyst for a retail/inventory management company in Nigeria.
Analyze the following business metrics and provide a concise, actionable executive report.

IMPORTANT RULES:
- Use professional business language
- Be concise — max 3-4 sentences per section
- Currency is Nigerian Naira (₦)
- Focus on actionable insights, not just restating numbers
- If growth is negative, flag it as a concern
- Highlight the most impactful findings first

Respond with JSON only, in this structure:
{
  "executiveSummary": "2-3 sentence overview of business performance",
  "highlights": ["highlight 1", "highlight 2", "highlight 3"],
  "growthAnalysis": "Analysis of sales and transaction growth trends",
  "riskAnalysis": "Key risks identified (stock issues, declining sales, high expenses, etc.)",
  "opportunities": ["opportunity 1", "opportunity 2", "opportunity 3"],
  "recommendations": ["recommendation 1", "recommendation 2", "recommendation 3", "recommendation 4"],
  "healthScore": 0-100 (overall business health based on metrics)
}

BUSINESS METRICS:
`;

const RECOMMENDATIONS_PROMPT = `You are a retail business advisor in Nigeria.
Based on these metrics, provide 5 specific, actionable recommendations to improve business performance.
Focus on: inventory optimization, sales growth, cost reduction, and risk mitigation.
Respond with JSON only: an object with a "recommendations" array of strings.

METRICS:
`;

// ─── PUBLIC API ──────────────────────────────────────────────────────

/**
 * Generate a business report summary from metrics.
 * @param {Object} metrics - Pre-calculated business metrics from dashboardAnalytics
 */
export async function generateBusinessSummary(metrics) {
  const prompt = REPORT_SUMMARY_PROMPT + JSON.stringify(metrics, null, 2);
  const result = await generateAIText(prompt, { json: true });

  if (!result.success) {
    console.error("[AI] generateBusinessSummary error:", result.error);
    return { success: false, error: result.error, meta: result.meta };
  }

  return { success: true, data: result.data, meta: result.meta };
}

/**
 * Generate specific recommendations from metrics.
 * @param {Object} metrics
 */
export async function generateRecommendations(metrics) {
  const prompt = RECOMMENDATIONS_PROMPT + JSON.stringify(metrics, null, 2);
  const result = await generateAIText(prompt, { json: true });

  if (!result.success) {
    console.error("[AI] generateRecommendations error:", result.error);
    return { success: false, error: result.error, data: [], meta: result.meta };
  }

  const parsed = result.data;
  const list = Array.isArray(parsed) ? parsed : parsed?.recommendations || [];
  return { success: true, data: list, meta: result.meta };
}

/**
 * Generate a report summary tailored to a reporting period.
 * @param {Object} metrics
 * @param {"daily"|"weekly"|"monthly"|"yearly"} reportType
 */
export async function generateReportSummary(metrics, reportType = "monthly") {
  const periodContext = {
    daily: "Focus on today's operational performance and immediate actions needed.",
    weekly: "Focus on weekly trends, compare to last week, identify patterns.",
    monthly: "Focus on monthly performance, seasonal patterns, and strategic planning.",
    yearly: "Focus on annual performance, year-over-year growth, and long-term strategy.",
  };

  const prompt = `${REPORT_SUMMARY_PROMPT}

Additional Context: ${periodContext[reportType] || periodContext.monthly}

${JSON.stringify(metrics, null, 2)}`;

  const result = await generateAIText(prompt, { json: true });

  if (!result.success) {
    console.error("[AI] generateReportSummary error:", result.error);
    return { success: false, error: result.error, meta: result.meta };
  }

  return { success: true, data: result.data, meta: result.meta };
}
