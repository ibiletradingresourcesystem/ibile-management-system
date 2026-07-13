/**
 * Gemini AI Service
 * 
 * Handles all communication with Google Gemini API.
 * All prompts are centralized here — API routes never construct prompts directly.
 * Only receives pre-calculated business metrics; never raw DB documents.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = "gemini-1.5-flash";

let _genAI = null;

/**
 * Get or initialize the Gemini client
 * @returns {GoogleGenerativeAI}
 */
function getClient() {
  if (!_genAI) {
    if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");
    _genAI = new GoogleGenerativeAI(API_KEY);
  }
  return _genAI;
}

/**
 * Get a generative model instance
 * @returns {GenerativeModel}
 */
function getModel() {
  return getClient().getGenerativeModel({ model: MODEL_NAME });
}

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

Provide your analysis in the following JSON structure:
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
Return as a JSON array of strings.

METRICS:
`;

// ─── PUBLIC API ──────────────────────────────────────────────────────

/**
 * Generate a business report summary from metrics
 * @param {Object} metrics - Pre-calculated business metrics from dashboardAnalytics
 * @returns {Promise<Object>} Parsed AI response
 */
export async function generateBusinessSummary(metrics) {
  const startTime = Date.now();
  const prompt = REPORT_SUMMARY_PROMPT + JSON.stringify(metrics, null, 2);

  try {
    const model = getModel();
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    const parsed = JSON.parse(jsonMatch[1].trim());

    const executionTime = Date.now() - startTime;

    return {
      success: true,
      data: parsed,
      meta: {
        provider: "google",
        model: MODEL_NAME,
        promptLength: prompt.length,
        responseLength: text.length,
        executionTimeMs: executionTime,
      },
    };
  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error("[Gemini] generateBusinessSummary error:", error.message);

    return {
      success: false,
      error: error.message,
      meta: {
        provider: "google",
        model: MODEL_NAME,
        promptLength: REPORT_SUMMARY_PROMPT.length + 500,
        executionTimeMs: executionTime,
      },
    };
  }
}

/**
 * Generate specific recommendations from metrics
 * @param {Object} metrics
 * @returns {Promise<Object>}
 */
export async function generateRecommendations(metrics) {
  const prompt = RECOMMENDATIONS_PROMPT + JSON.stringify(metrics, null, 2);

  try {
    const model = getModel();
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    const parsed = JSON.parse(jsonMatch[1].trim());

    return { success: true, data: Array.isArray(parsed) ? parsed : parsed.recommendations || [] };
  } catch (error) {
    console.error("[Gemini] generateRecommendations error:", error.message);
    return { success: false, error: error.message, data: [] };
  }
}

/**
 * Generate a report summary suitable for a specific report type
 * @param {Object} metrics
 * @param {"daily"|"weekly"|"monthly"|"yearly"} reportType
 * @returns {Promise<Object>}
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

  try {
    const model = getModel();
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    const parsed = JSON.parse(jsonMatch[1].trim());

    return { success: true, data: parsed };
  } catch (error) {
    console.error("[Gemini] generateReportSummary error:", error.message);
    return { success: false, error: error.message };
  }
}
