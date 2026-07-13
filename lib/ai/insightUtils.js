/**
 * AI Insight Utilities
 * 
 * Hash generation, cache management, and logging for AI insights.
 */
import crypto from "crypto";

/**
 * Generate a SHA-256 hash of the metrics object for change detection
 * @param {Object} metrics
 * @returns {string} Hex hash string
 */
export function generateMetricsHash(metrics) {
  // Remove volatile fields that don't represent actual data changes
  const { generatedAt, ...stableMetrics } = metrics;
  const json = JSON.stringify(stableMetrics, Object.keys(stableMetrics).sort());
  return crypto.createHash("sha256").update(json).digest("hex");
}

/** Cache validity duration: 24 hours */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Check if a cached insight is still valid
 * @param {Object} insight - AIInsight document
 * @returns {boolean}
 */
export function isCacheValid(insight) {
  if (!insight || insight.status !== "completed") return false;
  const age = Date.now() - new Date(insight.generatedAt).getTime();
  return age < CACHE_TTL_MS;
}

/**
 * Log AI generation event for monitoring
 * @param {Object} params
 */
export function logAIEvent({
  action,
  reportType,
  location,
  cacheHit,
  executionTimeMs,
  provider,
  model,
  promptLength,
  responseLength,
  error,
}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    action,
    reportType,
    location,
    cacheHit: !!cacheHit,
    executionTimeMs,
    provider,
    model,
    promptLength,
    responseLength,
    error: error || null,
  };

  if (error) {
    console.error("[AI Insight]", JSON.stringify(logEntry));
  } else {
    console.log("[AI Insight]", JSON.stringify(logEntry));
  }

  return logEntry;
}

/**
 * Map period string to reportType enum value
 * @param {string} period
 * @returns {"daily"|"weekly"|"monthly"|"yearly"}
 */
export function periodToReportType(period) {
  switch (period) {
    case "today":
    case "yesterday":
      return "daily";
    case "week":
      return "weekly";
    case "month":
    case "last30":
      return "monthly";
    case "year":
    case "last90":
      return "yearly";
    default:
      return "monthly";
  }
}
