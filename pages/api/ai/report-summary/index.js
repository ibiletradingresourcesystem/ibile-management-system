/**
 * API Route: /api/ai/report-summary
 * 
 * Generates or retrieves cached AI business insights.
 * 
 * Workflow:
 * 1. Generate metrics via analytics engine
 * 2. Hash metrics for cache lookup
 * 3. Check AIInsight cache (same hash + valid TTL)
 * 4. If cache hit → return stored insight
 * 5. If cache miss → call Gemini → store → return
 * 
 * Query params:
 * - period: today|week|month|year|last30|last90 (default: month)
 * - location: optional location filter
 * - regenerate: "true" to force regeneration
 */
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { generateDashboardMetrics } from "@/lib/analytics/dashboardAnalytics";
import { generateBusinessSummary } from "@/lib/ai/gemini";
import { generateMetricsHash, isCacheValid, logAIEvent, periodToReportType } from "@/lib/ai/insightUtils";
import AIInsight from "@/models/AIInsight";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  const { period = "month", location, regenerate } = req.query;
  const forceRegenerate = regenerate === "true";

  await mongooseConnect();

  const startTime = Date.now();

  try {
    // Step 1: Generate metrics
    const metrics = await generateDashboardMetrics(period, location || undefined);
    const metricsGenerationTime = Date.now() - startTime;

    // Step 2: Generate hash
    const hash = generateMetricsHash(metrics);
    const reportType = periodToReportType(period);
    const locationKey = location || "All Locations";

    // Step 3: Check cache (unless forced regeneration)
    if (!forceRegenerate) {
      const cached = await AIInsight.findOne({
        reportType,
        location: locationKey,
        hash,
        status: "completed",
      }).lean();

      if (cached && isCacheValid(cached)) {
        logAIEvent({
          action: "cache-hit",
          reportType,
          location: locationKey,
          cacheHit: true,
          executionTimeMs: Date.now() - startTime,
          provider: cached.provider,
          model: cached.model,
        });

        return res.status(200).json({
          success: true,
          cached: true,
          metrics,
          insight: {
            summary: cached.summary,
            highlights: cached.highlights,
            growthAnalysis: cached.growthAnalysis,
            riskAnalysis: cached.riskAnalysis,
            opportunities: cached.opportunities,
            recommendations: cached.recommendations,
            healthScore: cached.healthScore,
          },
          generatedAt: cached.generatedAt,
          metricsGenerationTimeMs: metricsGenerationTime,
        });
      }
    }

    // Step 4: Call Gemini
    const aiResult = await generateBusinessSummary(metrics);

    if (!aiResult.success) {
      logAIEvent({
        action: "generation-failed",
        reportType,
        location: locationKey,
        cacheHit: false,
        executionTimeMs: Date.now() - startTime,
        provider: aiResult.meta?.provider,
        model: aiResult.meta?.model,
        error: aiResult.error,
      });

      // Return metrics without AI insight — report still loads
      return res.status(200).json({
        success: true,
        cached: false,
        aiAvailable: false,
        metrics,
        insight: null,
        error: "AI insight is temporarily unavailable.",
        metricsGenerationTimeMs: metricsGenerationTime,
      });
    }

    // Step 5: Store insight
    const insightData = {
      reportType,
      reportPeriod: metrics.reportPeriod,
      location: locationKey,
      metrics,
      hash,
      summary: aiResult.data.executiveSummary || "",
      highlights: aiResult.data.highlights || [],
      growthAnalysis: aiResult.data.growthAnalysis || "",
      riskAnalysis: aiResult.data.riskAnalysis || "",
      opportunities: aiResult.data.opportunities || [],
      recommendations: aiResult.data.recommendations || [],
      healthScore: Number(aiResult.data.healthScore) || 0,
      provider: aiResult.meta.provider,
      model: aiResult.meta.model,
      executionTimeMs: aiResult.meta.executionTimeMs,
      generatedAt: new Date(),
      status: "completed",
      cacheHit: false,
    };

    // Upsert: replace existing insight for same reportType + location
    await AIInsight.findOneAndUpdate(
      { reportType, location: locationKey },
      insightData,
      { upsert: true, new: true }
    );

    logAIEvent({
      action: "generated",
      reportType,
      location: locationKey,
      cacheHit: false,
      executionTimeMs: Date.now() - startTime,
      provider: aiResult.meta.provider,
      model: aiResult.meta.model,
      promptLength: aiResult.meta.promptLength,
      responseLength: aiResult.meta.responseLength,
    });

    return res.status(200).json({
      success: true,
      cached: false,
      aiAvailable: true,
      metrics,
      insight: {
        summary: insightData.summary,
        highlights: insightData.highlights,
        growthAnalysis: insightData.growthAnalysis,
        riskAnalysis: insightData.riskAnalysis,
        opportunities: insightData.opportunities,
        recommendations: insightData.recommendations,
        healthScore: insightData.healthScore,
      },
      generatedAt: insightData.generatedAt,
      metricsGenerationTimeMs: metricsGenerationTime,
      aiExecutionTimeMs: aiResult.meta.executionTimeMs,
    });
  } catch (err) {
    console.error("[AI Report Summary] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
