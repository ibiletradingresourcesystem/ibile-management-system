/**
 * AI Decision Center Dashboard Component
 * 
 * Central hub for all AI recommendations. Displays:
 * - Business recommendations (approve/reject workflow)
 * - Inventory alerts
 * - Restock recommendations
 * - Product performance
 * - Pricing suggestions
 */
import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";

const PRIORITY_COLORS = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
  low: "bg-blue-100 text-blue-700 border-blue-200",
};

const STATUS_COLORS = {
  pending: "bg-yellow-50 text-yellow-700",
  approved: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-700",
  implemented: "bg-blue-50 text-blue-700",
};

const TABS = [
  { key: "all", label: "All" },
  { key: "business", label: "Business" },
  { key: "inventory", label: "Inventory" },
  { key: "restock", label: "Restock" },
  { key: "product-performance", label: "Products" },
  { key: "pricing", label: "Pricing" },
];

export default function AIDecisionCenter({ isAdmin = false }) {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [generating, setGenerating] = useState({});
  const [actionLoading, setActionLoading] = useState(null);

  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeTab !== "all") params.set("type", activeTab);
      const res = await apiClient.get(`/api/ai/recommendations?${params}`);
      setRecommendations(res.data?.recommendations || []);
    } catch (err) {
      console.error("Failed to load recommendations:", err);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { fetchRecommendations(); }, [fetchRecommendations]);

  const handleGenerate = async (type) => {
    setGenerating((prev) => ({ ...prev, [type]: true }));
    try {
      const endpoint = `/api/ai/${type}?regenerate=true`;
      await apiClient.get(endpoint);
      fetchRecommendations();
    } catch (err) {
      console.error(`Generate ${type} failed:`, err);
    } finally {
      setGenerating((prev) => ({ ...prev, [type]: false }));
    }
  };

  const handleAction = async (id, action, reason) => {
    setActionLoading(id);
    try {
      await apiClient.put("/api/ai/recommendations", { id, action, reason });
      fetchRecommendations();
    } catch (err) {
      alert(err.response?.data?.error || "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            AI Decision Center
            <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold uppercase">AI Powered</span>
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">AI-generated recommendations requiring manager review</p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            {["business", "inventory", "restock", "product-performance"].map((type) => (
              <button
                key={type}
                onClick={() => handleGenerate(type)}
                disabled={generating[type]}
                className="text-xs border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
              >
                {generating[type] ? "..." : `Generate ${type.replace("-", " ")}`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto border-b gap-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === tab.key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="content-card animate-pulse">
              <div className="h-4 w-48 bg-gray-200 rounded mb-2" />
              <div className="h-3 w-full bg-gray-100 rounded" />
              <div className="h-3 w-3/4 bg-gray-100 rounded mt-1" />
            </div>
          ))}
        </div>
      ) : recommendations.length === 0 ? (
        <div className="content-card text-center py-12">
          <p className="text-gray-400 text-sm">No recommendations yet.</p>
          {isAdmin && (
            <button
              onClick={() => handleGenerate("business")}
              className="mt-3 text-sm text-blue-600 hover:underline"
            >
              Generate Business Recommendations
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {recommendations.map((rec) => (
            <RecommendationCard
              key={rec._id}
              rec={rec}
              isAdmin={isAdmin}
              onAction={handleAction}
              actionLoading={actionLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RecommendationCard({ rec, isAdmin, onAction, actionLoading }) {
  const [expanded, setExpanded] = useState(false);
  const priorityClass = PRIORITY_COLORS[rec.priority] || PRIORITY_COLORS.medium;
  const statusClass = STATUS_COLORS[rec.status] || STATUS_COLORS.pending;

  return (
    <div className="content-card hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${priorityClass}`}>
              {rec.priority?.toUpperCase()}
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusClass}`}>
              {rec.status}
            </span>
            <span className="text-[10px] text-gray-400 uppercase">{rec.recommendationType}</span>
            {rec.confidence > 0 && (
              <span className="text-[10px] text-gray-400">Confidence: {rec.confidence}%</span>
            )}
          </div>
          <p className="text-sm font-medium text-gray-800 mt-1.5">{rec.recommendation || rec.entityName}</p>
          {rec.reason && <p className="text-xs text-gray-500 mt-0.5">{rec.reason}</p>}
        </div>
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0">
          {expanded ? "Less" : "More"}
        </button>
      </div>

      {/* Expanded Details */}
      {expanded && rec.data && (
        <div className="mt-3 pt-3 border-t space-y-2">
          {/* Render type-specific data */}
          {rec.recommendationType === "business" && rec.data.recommendations && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {rec.data.recommendations.slice(0, 6).map((r, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-2.5 text-xs">
                  <p className="font-medium text-gray-800">{r.title}</p>
                  <p className="text-gray-500 mt-0.5">{r.description}</p>
                  {r.estimatedBenefit && <p className="text-green-600 mt-1 font-medium">{r.estimatedBenefit}</p>}
                </div>
              ))}
            </div>
          )}
          {rec.recommendationType === "inventory" && rec.data.immediateActions && (
            <div className="space-y-1.5">
              {rec.data.immediateActions.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-xs bg-red-50 rounded px-2.5 py-1.5">
                  <span className="text-red-600 font-bold">{a.urgency?.toUpperCase()}</span>
                  <span className="text-gray-700">{a.action}</span>
                </div>
              ))}
            </div>
          )}
          {rec.recommendationType === "restock" && rec.data.urgentRestock && (
            <div className="space-y-1.5">
              {rec.data.urgentRestock.map((r, i) => (
                <div key={i} className="flex justify-between text-xs bg-orange-50 rounded px-2.5 py-1.5">
                  <span className="font-medium">{r.product}</span>
                  <span>Order: {r.recommendedQty} units | Stock out in {r.daysUntilStockout} days</span>
                </div>
              ))}
            </div>
          )}
          {rec.recommendationType === "product-performance" && rec.data.productAnalysis && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {rec.data.productAnalysis.slice(0, 8).map((p, i) => (
                <div key={i} className="flex justify-between text-xs bg-gray-50 rounded px-2.5 py-1.5">
                  <span className="font-medium truncate">{p.name}</span>
                  <span className={`font-semibold ${p.category === "Star" ? "text-green-600" : p.category === "Declining" || p.category === "Dead Stock" ? "text-red-600" : "text-gray-600"}`}>{p.category}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 pt-2">
            Generated: {rec.generatedAt ? new Date(rec.generatedAt).toLocaleString() : "—"} | Model: {rec.model}
          </p>
        </div>
      )}

      {/* Actions */}
      {isAdmin && rec.status === "pending" && (
        <div className="flex gap-2 mt-3 pt-3 border-t">
          <button
            onClick={() => onAction(rec._id, "approve")}
            disabled={actionLoading === rec._id}
            className="text-xs bg-green-600 text-white px-3 py-1.5 rounded font-medium hover:bg-green-700 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            onClick={() => {
              const reason = prompt("Reason for rejection:");
              if (reason) onAction(rec._id, "reject", reason);
            }}
            disabled={actionLoading === rec._id}
            className="text-xs border border-red-300 text-red-600 px-3 py-1.5 rounded font-medium hover:bg-red-50 disabled:opacity-50"
          >
            Reject
          </button>
          {rec.status === "approved" && (
            <button
              onClick={() => onAction(rec._id, "implement")}
              disabled={actionLoading === rec._id}
              className="text-xs border border-blue-300 text-blue-600 px-3 py-1.5 rounded font-medium hover:bg-blue-50 disabled:opacity-50"
            >
              Mark Implemented
            </button>
          )}
        </div>
      )}
      {rec.approvedByName && (
        <p className="text-[10px] text-gray-400 mt-2">
          {rec.status === "approved" ? "Approved" : "Reviewed"} by {rec.approvedByName} on {rec.approvedAt ? new Date(rec.approvedAt).toLocaleDateString() : "—"}
        </p>
      )}
    </div>
  );
}
