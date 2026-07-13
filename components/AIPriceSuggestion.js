/**
 * AI Price Suggestion — Inline component for ProductForm
 * 
 * Shows AI-recommended price for a product when available.
 * Loads from /api/ai/pricing?productId=X (cached recommendations).
 */
import { useState, useCallback } from "react";
import { apiClient } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";

export default function AIPriceSuggestion({ productId, currentPrice, onApplyPrice }) {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  const fetchSuggestion = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError("");
    setDismissed(false);
    try {
      const res = await apiClient.get(`/api/ai/pricing?productId=${productId}`);
      if (res.data?.recommendation?.data) {
        setSuggestion(res.data.recommendation.data);
      } else {
        setError("No pricing recommendation available");
      }
    } catch (err) {
      setError("Could not load AI suggestion");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  if (!productId) return null;
  if (dismissed) return null;

  // Not yet loaded — show trigger button
  if (!suggestion && !loading && !error) {
    return (
      <button
        type="button"
        onClick={fetchSuggestion}
        className="mt-1 text-xs text-purple-600 hover:text-purple-800 hover:underline flex items-center gap-1"
      >
        <span className="text-[10px]">✨</span> Get AI price recommendation
      </button>
    );
  }

  if (loading) {
    return (
      <div className="mt-2 p-2.5 bg-purple-50 border border-purple-200 rounded-lg animate-pulse">
        <p className="text-xs text-purple-600">Analyzing pricing...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <p className="text-xs text-gray-400">{error}</p>
        <button type="button" onClick={fetchSuggestion} className="text-xs text-purple-600 hover:underline">Retry</button>
      </div>
    );
  }

  if (!suggestion) return null;

  const recommended = Number(suggestion.recommendedPrice) || 0;
  const diff = recommended - (Number(currentPrice) || 0);
  const isIncrease = diff > 0;
  const isDecrease = diff < 0;
  const noChange = Math.abs(diff) < 1;

  return (
    <div className="mt-2 p-3 bg-purple-50 border border-purple-200 rounded-lg">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-purple-700">AI Price Suggestion</span>
          <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">
            {suggestion.confidence || 0}% confident
          </span>
        </div>
        <button type="button" onClick={() => setDismissed(true)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
      </div>

      <div className="flex items-center gap-3 mb-1.5">
        <span className="text-lg font-bold text-purple-800">{formatCurrency(recommended)}</span>
        {!noChange && (
          <span className={`text-xs font-semibold ${isIncrease ? "text-green-600" : "text-red-600"}`}>
            {isIncrease ? "▲" : "▼"} {formatCurrency(Math.abs(diff))}
          </span>
        )}
        {noChange && <span className="text-xs text-gray-500">No change needed</span>}
      </div>

      {suggestion.reason && (
        <p className="text-[11px] text-gray-600 mb-2 leading-snug">{suggestion.reason}</p>
      )}

      <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-2">
        <span>Margin: {suggestion.recommendedMargin || 0}%</span>
        <span>•</span>
        <span>Strategy: {suggestion.strategy || "maintain"}</span>
        <span>•</span>
        <span>Risk: {suggestion.riskLevel || "low"}</span>
      </div>

      {!noChange && onApplyPrice && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => { onApplyPrice(recommended); setDismissed(true); }}
            className="text-xs bg-purple-600 text-white px-3 py-1 rounded font-medium hover:bg-purple-700"
          >
            Apply {formatCurrency(recommended)}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-xs border border-gray-300 text-gray-600 px-3 py-1 rounded hover:bg-gray-50"
          >
            Ignore
          </button>
        </div>
      )}
    </div>
  );
}
