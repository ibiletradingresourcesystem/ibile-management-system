/**
 * AI Orchestrator — Shared Pipeline
 * 
 * Every AI module follows the same workflow:
 * 1. Generate metrics → 2. Hash → 3. Check cache → 4. Call Gemini if needed → 5. Store → 6. Return
 * 
 * This module provides the reusable pipeline so each advisor only defines its metrics + prompt.
 */
import { generateMetricsHash, isFresh, logAIEvent } from "./insightUtils";
import AIRecommendation from "@/models/AIRecommendation";

/**
 * A stored recommendation is served again for this long whatever has changed, and for a day if
 * nothing has. The cache used to require a status recommendations never have, so it never hit:
 * every product page asked the AI afresh and spent the free quota.
 */
const RECOMMENDATION_MIN_REFRESH_MS = 2 * 60 * 60 * 1000;

const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Execute the shared AI recommendation pipeline
 * @param {Object} params
 * @param {string} params.recommendationType - "pricing"|"inventory"|"restock"|"product-performance"|"business"
 * @param {string} params.entityType - "product"|"category"|"vendor"|"location"|"global"
 * @param {string} [params.entityId] - ObjectId of entity
 * @param {string} [params.entityName] - Display name
 * @param {Object} params.metrics - Pre-calculated metrics (input to AI)
 * @param {Function} params.generateAI - async function(metrics) → { success, data, meta }
 * @param {Function} params.formatResult - function(aiData, metrics) → recommendation fields
 * @param {boolean} [params.forceRegenerate=false]
 * @param {string} [params.location]
 * @returns {Promise<Object>}
 */
export async function executeRecommendationPipeline({
  recommendationType,
  entityType = "global",
  entityId,
  entityName = "",
  metrics,
  generateAI,
  formatResult,
  forceRegenerate = false,
  location = "All Locations",
}) {
  const startTime = Date.now();
  const hash = generateMetricsHash(metrics);

  // Check cache: the one stored for this entity and location, as the save below files it
  if (!forceRegenerate) {
    const cached = await AIRecommendation.findOne({
      recommendationType,
      entityType,
      ...(entityId ? { entityId } : {}),
      location,
      status: { $in: ["pending", "approved", "implemented"] },
    })
      .sort({ generatedAt: -1 })
      .lean();

    if (cached && isFresh(cached, { hash, minRefreshMs: RECOMMENDATION_MIN_REFRESH_MS })) {
      logAIEvent({
        action: "cache-hit",
        reportType: recommendationType,
        location,
        cacheHit: true,
        executionTimeMs: Date.now() - startTime,
        provider: cached.provider,
        model: cached.model,
      });

      return {
        success: true,
        cached: true,
        recommendation: cached,
      };
    }
  }

  // Generate AI recommendation
  const aiResult = await generateAI(metrics);

  if (!aiResult.success) {
    // Try to return last available recommendation
    const fallback = await AIRecommendation.findOne({
      recommendationType,
      entityType,
      ...(entityId ? { entityId } : {}),
    })
      .sort({ generatedAt: -1 })
      .lean();

    logAIEvent({
      action: "generation-failed",
      reportType: recommendationType,
      location,
      cacheHit: false,
      executionTimeMs: Date.now() - startTime,
      error: aiResult.error,
    });

    // The real reason — a bad key, a used-up quota — so the screen can say what to fix
    return {
      success: false,
      cached: !!fallback,
      recommendation: fallback || null,
      error: aiResult.error || "AI recommendation temporarily unavailable.",
    };
  }

  // Format and store
  const formatted = formatResult(aiResult.data, metrics);
  const doc = {
    recommendationType,
    entityType,
    entityId: entityId || undefined,
    entityName,
    metrics,
    hash,
    recommendation: formatted.recommendation || "",
    reason: formatted.reason || "",
    priority: formatted.priority || "medium",
    confidence: formatted.confidence || 0,
    estimatedBenefit: formatted.estimatedBenefit || 0,
    category: formatted.category || "",
    riskLevel: formatted.riskLevel || "low",
    difficulty: formatted.difficulty || "moderate",
    data: formatted.data || {},
    status: "pending",
    provider: aiResult.meta?.provider || "",
    model: aiResult.meta?.model || "",
    executionTimeMs: aiResult.meta?.executionTimeMs || (Date.now() - startTime),
    generatedAt: new Date(),
    location,
  };

  // Upsert per entity+type
  const filter = {
    recommendationType,
    entityType,
    ...(entityId ? { entityId } : {}),
    location,
  };
  const saved = await AIRecommendation.findOneAndUpdate(filter, doc, { upsert: true, new: true }).lean();

  logAIEvent({
    action: "generated",
    reportType: recommendationType,
    location,
    cacheHit: false,
    executionTimeMs: Date.now() - startTime,
    provider: doc.provider,
    model: doc.model,
  });

  return {
    success: true,
    cached: false,
    recommendation: saved,
  };
}

/**
 * Get all recommendations of a type with optional filters
 * @param {Object} filters
 * @returns {Promise<Array>}
 */
export async function getRecommendations(filters = {}) {
  const query = {};
  if (filters.recommendationType) query.recommendationType = filters.recommendationType;
  if (filters.entityType) query.entityType = filters.entityType;
  if (filters.entityId) query.entityId = filters.entityId;
  if (filters.status) query.status = filters.status;
  if (filters.priority) query.priority = filters.priority;
  if (filters.location) query.location = filters.location;

  // Most urgent first. Sorted as text, "low" came before "medium".
  const rows = await AIRecommendation.find(query)
    .sort({ generatedAt: -1 })
    .limit(filters.limit || 50)
    .lean();
  return rows.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9));
}

/**
 * Approve a recommendation
 * @param {string} id
 * @param {string} userId
 * @param {string} userName
 * @param {string} [notes]
 * @returns {Promise<Object>}
 */
export async function approveRecommendation(id, userId, userName, notes) {
  return AIRecommendation.findByIdAndUpdate(id, {
    status: "approved",
    approvedBy: userId,
    approvedByName: userName,
    approvedAt: new Date(),
    notes: notes || "",
  }, { new: true }).lean();
}

/**
 * Reject a recommendation
 * @param {string} id
 * @param {string} userId
 * @param {string} userName
 * @param {string} reason
 * @returns {Promise<Object>}
 */
export async function rejectRecommendation(id, userId, userName, reason) {
  return AIRecommendation.findByIdAndUpdate(id, {
    status: "rejected",
    approvedBy: userId,
    approvedByName: userName,
    approvedAt: new Date(),
    rejectedReason: reason || "",
  }, { new: true }).lean();
}

/**
 * Mark a recommendation as implemented
 * @param {string} id
 * @returns {Promise<Object>}
 */
export async function markImplemented(id) {
  return AIRecommendation.findByIdAndUpdate(id, {
    status: "implemented",
    implementedAt: new Date(),
  }, { new: true }).lean();
}
