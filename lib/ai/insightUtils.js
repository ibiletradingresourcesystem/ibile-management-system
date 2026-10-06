/**
 * AI Insight Utilities
 * 
 * Hash generation, cache management, and logging for AI insights.
 */
import crypto from "crypto";

/** JSON with every object's keys in order, at every depth, so equal data always reads the same. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Generate a SHA-256 hash of the metrics object for change detection.
 *
 * It used to pass the top-level key names to JSON.stringify as its list of keys to keep, and that
 * list applies at every depth — so every nested figure was dropped, the hash never changed with
 * the numbers, and a cached report (another month's, even) was served as if nothing had moved.
 *
 * @param {Object} metrics
 * @returns {string} Hex hash string
 */
export function generateMetricsHash(metrics) {
  // Remove volatile fields that don't represent actual data changes
  const { generatedAt, ...stableMetrics } = metrics || {};
  return crypto.createHash("sha256").update(stableStringify(stableMetrics)).digest("hex");
}

/** Cache validity duration: 24 hours */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a stored answer can be served again: unchanged data within a day, or any answer younger
 * than `minRefreshMs`. The second rule matters now the hash sees every figure: a "today" summary
 * would otherwise go back to the AI after every single sale, and on a free key the quota runs out.
 */
export function isFresh(doc, { hash, minRefreshMs = 0, maxAgeMs = CACHE_TTL_MS } = {}) {
  if (!doc?.generatedAt) return false;
  const age = Date.now() - new Date(doc.generatedAt).getTime();
  if (age < 0) return true;
  if (age < minRefreshMs) return true;
  return Boolean(hash) && doc.hash === hash && age < maxAgeMs;
}

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
