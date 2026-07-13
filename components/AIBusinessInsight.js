/**
 * AI Business Insight Component
 * 
 * Displays AI-generated business intelligence on the Reports page.
 * Fetches from /api/ai/report-summary — never calls Gemini directly.
 */
import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";

export default function AIBusinessInsight({ period = "month", location }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchInsight = useCallback(async (regenerate = false) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ period });
      if (location) params.set("location", location);
      if (regenerate) params.set("regenerate", "true");

      const res = await apiClient.get(`/api/ai/report-summary?${params}`);
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load AI insights");
    } finally {
      setLoading(false);
    }
  }, [period, location]);

  useEffect(() => {
    fetchInsight();
  }, [fetchInsight]);

  if (loading) {
    return <InsightSkeleton />;
  }

  if (error) {
    return (
      <div className="content-card border-l-4 border-red-400">
        <p className="text-sm text-red-600">{error}</p>
        <button onClick={() => fetchInsight()} className="text-xs text-blue-600 hover:underline mt-2">Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const insight = data.insight;
  const metrics = data.metrics;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-gray-800">AI Business Intelligence</h2>
          <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold uppercase">AI Generated</span>
        </div>
        <div className="flex items-center gap-2">
          {data.cached && <span className="text-[10px] text-gray-400">Cached</span>}
          {data.generatedAt && <span className="text-[10px] text-gray-400">{new Date(data.generatedAt).toLocaleString()}</span>}
          <button
            onClick={() => fetchInsight(true)}
            disabled={loading}
            className="text-xs border border-gray-300 px-3 py-1 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Regenerate
          </button>
        </div>
      </div>

      {!insight && !data.aiAvailable && (
        <div className="content-card bg-yellow-50 border-yellow-200">
          <p className="text-sm text-yellow-800">AI insight is temporarily unavailable. Showing calculated metrics only.</p>
        </div>
      )}

      {insight && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Executive Summary */}
          <div className="content-card border-l-4 border-purple-500 lg:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-bold text-gray-700 uppercase">Executive Summary</h3>
              {insight.healthScore > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Health Score:</span>
                  <span className={`text-sm font-bold px-2 py-0.5 rounded-full ${
                    insight.healthScore >= 70 ? "bg-green-100 text-green-700" :
                    insight.healthScore >= 40 ? "bg-yellow-100 text-yellow-700" :
                    "bg-red-100 text-red-700"
                  }`}>{insight.healthScore}/100</span>
                </div>
              )}
            </div>
            <p className="text-sm text-gray-700 leading-relaxed">{insight.summary}</p>
          </div>

          {/* Highlights */}
          {insight.highlights?.length > 0 && (
            <div className="content-card">
              <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Business Highlights</h3>
              <ul className="space-y-2">
                {insight.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="text-green-500 mt-0.5">●</span>
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Growth Analysis */}
          {insight.growthAnalysis && (
            <div className="content-card">
              <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Growth Analysis</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{insight.growthAnalysis}</p>
            </div>
          )}

          {/* Risks */}
          {insight.riskAnalysis && (
            <div className="content-card border-l-4 border-red-400">
              <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Risk Analysis</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{insight.riskAnalysis}</p>
            </div>
          )}

          {/* Opportunities */}
          {insight.opportunities?.length > 0 && (
            <div className="content-card border-l-4 border-blue-400">
              <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Opportunities</h3>
              <ul className="space-y-2">
                {insight.opportunities.map((o, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="text-blue-500 mt-0.5">◆</span>
                    {o}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {insight.recommendations?.length > 0 && (
            <div className="content-card border-l-4 border-emerald-400 lg:col-span-2">
              <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Recommendations</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {insight.recommendations.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-gray-600 bg-emerald-50 rounded-lg p-2.5">
                    <span className="text-emerald-600 font-bold text-xs mt-0.5">{i + 1}.</span>
                    {r}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Loading skeleton */
function InsightSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="h-6 w-48 bg-gray-200 rounded" />
        <div className="h-5 w-20 bg-purple-100 rounded-full" />
      </div>
      <div className="content-card border-l-4 border-purple-200">
        <div className="h-4 w-32 bg-gray-200 rounded mb-3" />
        <div className="space-y-2">
          <div className="h-3 w-full bg-gray-100 rounded" />
          <div className="h-3 w-4/5 bg-gray-100 rounded" />
          <div className="h-3 w-3/5 bg-gray-100 rounded" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="content-card"><div className="h-4 w-24 bg-gray-200 rounded mb-3" /><div className="h-3 w-full bg-gray-100 rounded" /><div className="h-3 w-3/4 bg-gray-100 rounded mt-2" /></div>
        <div className="content-card"><div className="h-4 w-24 bg-gray-200 rounded mb-3" /><div className="h-3 w-full bg-gray-100 rounded" /><div className="h-3 w-3/4 bg-gray-100 rounded mt-2" /></div>
      </div>
    </div>
  );
}
