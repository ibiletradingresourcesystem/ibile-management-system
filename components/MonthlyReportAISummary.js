/**
 * Monthly Report AI Summary Component
 * 
 * Displays the AI executive briefing from the monthly report.
 * Loads from cache (/api/ai/monthly-report) — never calls Gemini.
 */
import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";

export default function MonthlyReportAISummary({ isAdmin = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [regenerating, setRegenerating] = useState(false);

  const fetchInsight = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiClient.get("/api/ai/monthly-report");
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load monthly insight");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchInsight(); }, [fetchInsight]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await apiClient.post("/api/ai/monthly-report");
      fetchInsight();
    } catch (err) {
      alert(err.response?.data?.error || "Regeneration failed");
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="content-card animate-pulse">
        <div className="h-5 w-56 bg-gray-200 rounded mb-4" />
        <div className="h-3 w-full bg-gray-100 rounded mb-2" />
        <div className="h-3 w-4/5 bg-gray-100 rounded mb-2" />
        <div className="h-3 w-3/5 bg-gray-100 rounded" />
      </div>
    );
  }

  if (error || !data?.insight) {
    return (
      <div className="content-card border-l-4 border-gray-300">
        <p className="text-sm text-gray-500">{error || "No monthly AI insight available yet."}</p>
        {isAdmin && (
          <button onClick={handleRegenerate} disabled={regenerating} className="mt-2 text-xs text-blue-600 hover:underline disabled:opacity-50">
            {regenerating ? "Generating..." : "Generate Monthly Insight"}
          </button>
        )}
      </div>
    );
  }

  const { insight, metrics } = data;
  const healthColor = insight.healthScore >= 70 ? "text-green-600" : insight.healthScore >= 40 ? "text-yellow-600" : "text-red-600";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-gray-800">Monthly AI Executive Briefing</h2>
          <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold uppercase">AI</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400">{insight.reportPeriod}</span>
          {insight.generatedAt && <span className="text-[10px] text-gray-400">{new Date(insight.generatedAt).toLocaleDateString()}</span>}
          {isAdmin && (
            <button onClick={handleRegenerate} disabled={regenerating} className="text-xs border border-gray-300 px-3 py-1 rounded hover:bg-gray-50 disabled:opacity-50">
              {regenerating ? "..." : "Regenerate"}
            </button>
          )}
        </div>
      </div>

      {/* Executive Summary + Health */}
      <div className="content-card border-l-4 border-purple-500">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-700 uppercase">Executive Summary</h3>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-bold ${healthColor}`}>Health: {insight.healthScore}/100</span>
            <span className="text-xs text-gray-500 capitalize">{insight.growthOutlook} outlook</span>
          </div>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed">{insight.executiveSummary}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Highlights */}
        {insight.highlights?.length > 0 && (
          <div className="content-card">
            <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Business Highlights</h3>
            <div className="space-y-2">
              {insight.highlights.slice(0, 6).map((h, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-green-500 mt-0.5 flex-shrink-0">●</span>
                  <div>
                    <p className="font-medium text-gray-800">{h.title || h}</p>
                    {h.description && <p className="text-xs text-gray-500">{h.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Risks */}
        {insight.risks?.length > 0 && (
          <div className="content-card border-l-4 border-red-400">
            <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Business Risks</h3>
            <div className="space-y-2">
              {insight.risks.slice(0, 6).map((r, i) => (
                <div key={i} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${r.severity === "high" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"}`}>{r.severity}</span>
                    <p className="font-medium text-gray-800">{r.title || r}</p>
                  </div>
                  {r.mitigation && <p className="text-xs text-green-600 mt-0.5 ml-6">→ {r.mitigation}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Opportunities */}
        {insight.opportunities?.length > 0 && (
          <div className="content-card border-l-4 border-blue-400">
            <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Opportunities</h3>
            <div className="space-y-2">
              {insight.opportunities.slice(0, 6).map((o, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-blue-500 mt-0.5 flex-shrink-0">◆</span>
                  <div>
                    <p className="font-medium text-gray-800">{o.title || o}</p>
                    {o.potentialBenefit && <p className="text-xs text-green-600 font-medium">{o.potentialBenefit}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {(insight.recommendations?.immediate?.length > 0 || insight.recommendations?.shortTerm?.length > 0) && (
          <div className="content-card border-l-4 border-emerald-400">
            <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Recommendations</h3>
            <div className="space-y-3">
              {insight.recommendations.immediate?.slice(0, 3).map((r, i) => (
                <div key={`im-${i}`} className="bg-red-50 rounded-lg p-2.5 text-xs">
                  <span className="text-[10px] font-bold text-red-600 uppercase">Immediate</span>
                  <p className="font-medium text-gray-800 mt-0.5">{r.action}</p>
                  {r.expectedImpact && <p className="text-green-600 mt-0.5">{r.expectedImpact}</p>}
                </div>
              ))}
              {insight.recommendations.shortTerm?.slice(0, 3).map((r, i) => (
                <div key={`st-${i}`} className="bg-yellow-50 rounded-lg p-2.5 text-xs">
                  <span className="text-[10px] font-bold text-yellow-600 uppercase">Short-term</span>
                  <p className="font-medium text-gray-800 mt-0.5">{r.action}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* KPI Snapshot from metrics */}
      {metrics && (
        <div className="content-card">
          <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">KPI Snapshot</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KPIBadge label="Total Sales" value={formatCurrency(metrics.totalSales || 0)} />
            <KPIBadge label="Gross Profit" value={formatCurrency(metrics.grossProfit || 0)} />
            <KPIBadge label="Net Profit" value={formatCurrency(metrics.netProfit || 0)} color={metrics.netProfit >= 0 ? "green" : "red"} />
            <KPIBadge label="Transactions" value={String(metrics.totalTransactions || 0)} />
            <KPIBadge label="Stock Value" value={formatCurrency(metrics.stockValue || 0)} />
            <KPIBadge label="Gross Margin" value={`${metrics.grossMargin || 0}%`} />
            <KPIBadge label="Low Stock" value={String(metrics.lowStockCount || 0)} color={metrics.lowStockCount > 10 ? "red" : "green"} />
            <KPIBadge label="Expenses" value={formatCurrency(metrics.totalExpenses || 0)} />
          </div>
        </div>
      )}
    </div>
  );
}

function KPIBadge({ label, value, color }) {
  const colorClass = color === "red" ? "text-red-600" : color === "green" ? "text-green-600" : "text-gray-900";
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <p className="text-[10px] text-gray-500 uppercase font-medium">{label}</p>
      <p className={`text-sm font-bold mt-0.5 ${colorClass}`}>{value}</p>
    </div>
  );
}
