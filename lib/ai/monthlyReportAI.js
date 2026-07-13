/**
 * Monthly Report AI Integration
 * 
 * Generates AI executive insights for the monthly report.
 * Uses the same cache/hash pipeline as other AI modules.
 * Gracefully falls back to no-AI if Gemini is unavailable.
 */
import { generateMetricsHash, isCacheValid, logAIEvent } from "./insightUtils";
import AIInsight from "@/models/AIInsight";

const MONTHLY_REPORT_PROMPT = `You are a senior business consultant preparing an executive monthly report for a Nigerian retail business CEO.
Analyze the metrics and generate a professional executive briefing.

RULES:
- Currency: Nigerian Naira (₦)
- Be concise, professional, executive-level language
- Maximum 300 words for executive summary
- Maximum 6 items per section
- Focus on actionable insights
- Highlight both achievements and concerns
- Recommendations must be specific and prioritized

Return JSON:
{
  "executiveSummary": "300-word max professional summary of the month's performance",
  "highlights": [
    {"title": "short title", "description": "brief explanation", "impact": "positive/negative/neutral"}
  ],
  "risks": [
    {"title": "risk title", "description": "explanation", "severity": "high/medium/low", "mitigation": "suggested action"}
  ],
  "opportunities": [
    {"title": "opportunity", "description": "explanation", "potentialBenefit": "₦ or % estimate", "effort": "low/medium/high"}
  ],
  "recommendations": {
    "immediate": [{"action": "what to do", "reason": "why", "expectedImpact": "₦ or % benefit", "confidence": 0-100}],
    "shortTerm": [{"action": "what to do", "reason": "why", "expectedImpact": "₦ or % benefit", "confidence": 0-100}],
    "longTerm": [{"action": "what to do", "reason": "why", "expectedImpact": "₦ or % benefit", "confidence": 0-100}]
  },
  "healthScore": 0-100,
  "growthOutlook": "positive/neutral/negative"
}

MONTHLY BUSINESS METRICS:
`;

/**
 * Generate AI insights for a monthly report
 * @param {Object} monthlyMetrics - Pre-calculated metrics from monthly report
 * @returns {Promise<Object|null>} AI insight data or null if unavailable
 */
export async function generateMonthlyReportInsight(monthlyMetrics) {
  const startTime = Date.now();
  const hash = generateMetricsHash(monthlyMetrics);
  const reportPeriod = monthlyMetrics.reportPeriod || "Monthly";

  try {
    // Check cache first
    const cached = await AIInsight.findOne({
      reportType: "monthly",
      hash,
      status: "completed",
    }).lean();

    if (cached && isCacheValid(cached)) {
      logAIEvent({
        action: "monthly-cache-hit",
        reportType: "monthly",
        cacheHit: true,
        executionTimeMs: Date.now() - startTime,
        provider: cached.provider,
        model: cached.model,
      });

      return {
        executiveSummary: cached.summary,
        highlights: cached.data?.highlights || cached.highlights || [],
        risks: cached.data?.risks || [],
        opportunities: cached.data?.opportunities || cached.opportunities || [],
        recommendations: cached.data?.recommendations || { immediate: [], shortTerm: [], longTerm: [] },
        healthScore: cached.healthScore,
        growthOutlook: cached.data?.growthOutlook || "neutral",
        cached: true,
        generatedAt: cached.generatedAt,
      };
    }

    // Generate new insight via Gemini
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("[Monthly AI] GEMINI_API_KEY not configured, skipping AI insights");
      return null;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = MONTHLY_REPORT_PROMPT + JSON.stringify(monthlyMetrics, null, 2);

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
    const parsed = JSON.parse(jsonMatch[1].trim());

    const executionTime = Date.now() - startTime;

    // Store in AIInsight
    await AIInsight.findOneAndUpdate(
      { reportType: "monthly", reportPeriod },
      {
        reportType: "monthly",
        reportPeriod,
        location: "All Locations",
        metrics: monthlyMetrics,
        hash,
        summary: parsed.executiveSummary || "",
        highlights: (parsed.highlights || []).map(h => h.title || h),
        growthAnalysis: "",
        riskAnalysis: (parsed.risks || []).map(r => r.title).join("; "),
        opportunities: (parsed.opportunities || []).map(o => o.title || o),
        recommendations: [
          ...(parsed.recommendations?.immediate || []).map(r => r.action),
          ...(parsed.recommendations?.shortTerm || []).map(r => r.action),
        ],
        healthScore: parsed.healthScore || 0,
        data: parsed,
        provider: "google",
        model: "gemini-1.5-flash",
        executionTimeMs: executionTime,
        generatedAt: new Date(),
        status: "completed",
      },
      { upsert: true, new: true }
    );

    logAIEvent({
      action: "monthly-generated",
      reportType: "monthly",
      cacheHit: false,
      executionTimeMs: executionTime,
      provider: "google",
      model: "gemini-1.5-flash",
      promptLength: prompt.length,
      responseLength: text.length,
    });

    return {
      executiveSummary: parsed.executiveSummary || "",
      highlights: parsed.highlights || [],
      risks: parsed.risks || [],
      opportunities: parsed.opportunities || [],
      recommendations: parsed.recommendations || { immediate: [], shortTerm: [], longTerm: [] },
      healthScore: parsed.healthScore || 0,
      growthOutlook: parsed.growthOutlook || "neutral",
      cached: false,
      generatedAt: new Date(),
    };
  } catch (err) {
    console.error("[Monthly AI] Failed to generate insight:", err.message);

    logAIEvent({
      action: "monthly-failed",
      reportType: "monthly",
      cacheHit: false,
      executionTimeMs: Date.now() - startTime,
      error: err.message,
    });

    // Try to return last known insight
    const lastInsight = await AIInsight.findOne({ reportType: "monthly" }).sort({ generatedAt: -1 }).lean();
    if (lastInsight) {
      return {
        executiveSummary: lastInsight.summary,
        highlights: lastInsight.data?.highlights || [],
        risks: lastInsight.data?.risks || [],
        opportunities: lastInsight.data?.opportunities || lastInsight.opportunities || [],
        recommendations: lastInsight.data?.recommendations || { immediate: [], shortTerm: [], longTerm: [] },
        healthScore: lastInsight.healthScore,
        growthOutlook: lastInsight.data?.growthOutlook || "neutral",
        cached: true,
        generatedAt: lastInsight.generatedAt,
        stale: true,
      };
    }

    return null;
  }
}

/**
 * Build the AI section HTML for the monthly report email
 * @param {Object|null} insight - AI insight from generateMonthlyReportInsight()
 * @returns {string} HTML string to insert into report
 */
export function buildMonthlyReportAIHtml(insight) {
  if (!insight) return "";

  const healthColor = insight.healthScore >= 70 ? "#059669" : insight.healthScore >= 40 ? "#d97706" : "#dc2626";
  const outlookEmoji = insight.growthOutlook === "positive" ? "📈" : insight.growthOutlook === "negative" ? "📉" : "➡️";

  let html = `
    <!-- AI EXECUTIVE BRIEFING -->
    <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: white; padding: 30px; border-radius: 10px; margin-bottom: 20px;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 20px;">
        <h2 style="margin: 0; font-size: 20px;">🤖 AI Executive Briefing</h2>
        <span style="background: rgba(255,255,255,0.2); padding: 3px 10px; border-radius: 20px; font-size: 10px; text-transform: uppercase; letter-spacing: 1px;">AI Generated</span>
      </div>
      <div style="display: flex; gap: 20px; margin-bottom: 20px;">
        <div style="background: rgba(255,255,255,0.15); padding: 12px 16px; border-radius: 8px;">
          <p style="margin: 0; font-size: 10px; opacity: 0.8; text-transform: uppercase;">Health Score</p>
          <p style="margin: 4px 0 0 0; font-size: 24px; font-weight: bold; color: ${healthColor === "#059669" ? "#6ee7b7" : healthColor === "#d97706" ? "#fde68a" : "#fca5a5"};">${insight.healthScore}/100</p>
        </div>
        <div style="background: rgba(255,255,255,0.15); padding: 12px 16px; border-radius: 8px;">
          <p style="margin: 0; font-size: 10px; opacity: 0.8; text-transform: uppercase;">Growth Outlook</p>
          <p style="margin: 4px 0 0 0; font-size: 18px; font-weight: bold;">${outlookEmoji} ${insight.growthOutlook}</p>
        </div>
      </div>
      <p style="font-size: 14px; line-height: 1.6; opacity: 0.95; margin: 0;">${insight.executiveSummary}</p>
      ${insight.stale ? '<p style="margin-top: 10px; font-size: 11px; opacity: 0.6;">⚠️ Using cached analysis from previous period</p>' : ""}
    </div>`;

  // Highlights
  if (insight.highlights?.length > 0) {
    html += `
    <div style="background: white; padding: 25px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #e5e7eb;">
      <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #1f2937;"> Business Highlights</h3>
      ${insight.highlights.slice(0, 6).map(h => `
        <div style="padding: 10px 14px; margin-bottom: 8px; background: #f0fdf4; border-radius: 6px; border-left: 3px solid #10b981;">
          <p style="margin: 0; font-size: 13px; font-weight: 600; color: #065f46;">${h.title || h}</p>
          ${h.description ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #6b7280;">${h.description}</p>` : ""}
        </div>
      `).join("")}
    </div>`;
  }

  // Risks
  if (insight.risks?.length > 0) {
    html += `
    <div style="background: white; padding: 25px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #e5e7eb;">
      <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #1f2937;">⚠️ Business Risks</h3>
      ${insight.risks.slice(0, 6).map(r => `
        <div style="padding: 10px 14px; margin-bottom: 8px; background: #fef2f2; border-radius: 6px; border-left: 3px solid ${r.severity === "high" ? "#dc2626" : "#f59e0b"};">
          <p style="margin: 0; font-size: 13px; font-weight: 600; color: #991b1b;">${r.title || r}</p>
          ${r.description ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #6b7280;">${r.description}</p>` : ""}
          ${r.mitigation ? `<p style="margin: 4px 0 0 0; font-size: 11px; color: #059669;">💡 ${r.mitigation}</p>` : ""}
        </div>
      `).join("")}
    </div>`;
  }

  // Opportunities
  if (insight.opportunities?.length > 0) {
    html += `
    <div style="background: white; padding: 25px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #e5e7eb;">
      <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #1f2937;">💡 Opportunities</h3>
      ${insight.opportunities.slice(0, 6).map(o => `
        <div style="padding: 10px 14px; margin-bottom: 8px; background: #eff6ff; border-radius: 6px; border-left: 3px solid #3b82f6;">
          <p style="margin: 0; font-size: 13px; font-weight: 600; color: #1e40af;">${o.title || o}</p>
          ${o.description ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #6b7280;">${o.description}</p>` : ""}
          ${o.potentialBenefit ? `<p style="margin: 4px 0 0 0; font-size: 11px; color: #059669; font-weight: 600;">Potential: ${o.potentialBenefit}</p>` : ""}
        </div>
      `).join("")}
    </div>`;
  }

  // Recommendations
  const recs = insight.recommendations || {};
  const allRecs = [...(recs.immediate || []), ...(recs.shortTerm || []), ...(recs.longTerm || [])];
  if (allRecs.length > 0) {
    html += `
    <div style="background: white; padding: 25px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #e5e7eb;">
      <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #1f2937;">📋 Manager Recommendations</h3>`;

    if (recs.immediate?.length > 0) {
      html += `<p style="font-size: 12px; font-weight: 700; color: #dc2626; margin: 12px 0 8px 0; text-transform: uppercase;">Immediate Actions</p>`;
      html += recs.immediate.slice(0, 3).map(r => `
        <div style="padding: 8px 12px; margin-bottom: 6px; background: #fef2f2; border-radius: 4px;">
          <p style="margin: 0; font-size: 12px; color: #1f2937;"><strong>${r.action}</strong></p>
          <p style="margin: 2px 0 0 0; font-size: 11px; color: #6b7280;">${r.reason || ""} ${r.expectedImpact ? `• Impact: ${r.expectedImpact}` : ""}</p>
        </div>
      `).join("");
    }

    if (recs.shortTerm?.length > 0) {
      html += `<p style="font-size: 12px; font-weight: 700; color: #d97706; margin: 12px 0 8px 0; text-transform: uppercase;">Short-Term Actions</p>`;
      html += recs.shortTerm.slice(0, 3).map(r => `
        <div style="padding: 8px 12px; margin-bottom: 6px; background: #fffbeb; border-radius: 4px;">
          <p style="margin: 0; font-size: 12px; color: #1f2937;"><strong>${r.action}</strong></p>
          <p style="margin: 2px 0 0 0; font-size: 11px; color: #6b7280;">${r.reason || ""}</p>
        </div>
      `).join("");
    }

    if (recs.longTerm?.length > 0) {
      html += `<p style="font-size: 12px; font-weight: 700; color: #2563eb; margin: 12px 0 8px 0; text-transform: uppercase;">Long-Term Strategy</p>`;
      html += recs.longTerm.slice(0, 3).map(r => `
        <div style="padding: 8px 12px; margin-bottom: 6px; background: #eff6ff; border-radius: 4px;">
          <p style="margin: 0; font-size: 12px; color: #1f2937;"><strong>${r.action}</strong></p>
          <p style="margin: 2px 0 0 0; font-size: 11px; color: #6b7280;">${r.reason || ""}</p>
        </div>
      `).join("");
    }

    html += `</div>`;
  }

  return html;
}
