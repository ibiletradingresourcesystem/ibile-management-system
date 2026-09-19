/**
 * AI provider picker and health panel.
 *
 * The AI area used to fail silently whenever the Gemini key was rejected: the
 * chat replied "try again", and nothing said the key was the problem. This
 * shows which providers have keys, which one is in use, lets an admin switch
 * between Google Gemini and OpenAI, and runs a live test that reports the
 * provider's actual error.
 */
import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { Bot, CheckCircle2, XCircle, RefreshCw, AlertTriangle, Settings2 } from "lucide-react";

export default function AIProviderPanel({ isAdmin = false, onProviderChange, compact = false }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await apiClient.get("/api/ai/settings");
      setSettings(data.settings);
      onProviderChange?.(data.settings);
    } catch (err) {
      setError(err.response?.data?.error || "Could not load AI settings");
    } finally {
      setLoading(false);
    }
  }, [onProviderChange]);

  useEffect(() => {
    load();
  }, [load]);

  const update = async (patch) => {
    setSaving(true);
    setError("");
    setTestResult(null);
    try {
      const { data } = await apiClient.put("/api/ai/settings", patch);
      setSettings(data.settings);
      onProviderChange?.(data.settings);
    } catch (err) {
      setError(err.response?.data?.error || "Could not save AI settings");
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (providerId) => {
    setTesting(true);
    setTestResult(null);
    setError("");
    try {
      const { data } = await apiClient.post("/api/ai/settings", { provider: providerId });
      setTestResult(data.result);
      if (data.settings) setSettings(data.settings);
    } catch (err) {
      setTestResult({ ok: false, error: err.response?.data?.error || "Test request failed" });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="content-card animate-pulse">
        <div className="h-4 w-40 bg-gray-200 rounded mb-3" />
        <div className="h-3 w-full bg-gray-100 rounded" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="alert alert-error">
        <p className="text-sm">{error || "AI settings are unavailable."}</p>
      </div>
    );
  }

  const anyConfigured = settings.providers.some((p) => p.configured);
  const active = settings.providers.find((p) => p.id === settings.activeProvider);

  return (
    <div className="content-card">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Bot size={18} style={{ color: "var(--accent-text)" }} />
        <h3 className="text-base font-semibold text-gray-800">AI Engine</h3>
        <span className="ml-auto flex items-center gap-2">
          <button
            onClick={() => runTest(settings.provider)}
            disabled={testing || !anyConfigured}
            className="btn-action btn-action-secondary btn-sm inline-flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw size={14} className={testing ? "animate-spin" : ""} />
            {testing ? "Testing…" : "Test connection"}
          </button>
        </span>
      </div>

      {!anyConfigured && (
        <div className="alert alert-error mb-4 flex items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-semibold mb-1">No AI provider is configured</p>
            <p>
              Add <code className="font-mono">GEMINI_API_KEY</code> or <code className="font-mono">OPENAI_API_KEY</code>{" "}
              to the server environment and restart the app. Keys are read from the environment only and are never stored
              in the database.
            </p>
          </div>
        </div>
      )}

      {/* Provider cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        {settings.providers.map((provider) => {
          const isActive = settings.activeProvider === provider.id;
          const isChosen = settings.provider === provider.id;
          return (
            <button
              key={provider.id}
              type="button"
              disabled={!isAdmin || !provider.configured}
              onClick={() => update({ provider: provider.id })}
              className={`text-left p-4 border-2 transition disabled:cursor-not-allowed ${
                isChosen ? "border-gray-800" : "border-gray-200 hover:border-gray-300"
              } ${!provider.configured ? "opacity-60" : ""}`}
              style={{ borderRadius: "var(--radius-xl)" }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-sm text-gray-900">{provider.label}</span>
                {provider.configured ? (
                  <CheckCircle2 size={15} className="text-emerald-600" />
                ) : (
                  <XCircle size={15} className="text-gray-400" />
                )}
                {isActive && <span className="theme-badge-soft ml-auto text-[10px] px-2 py-0.5 rounded-full">In use</span>}
              </div>
              <p className="text-xs text-gray-500">
                {provider.configured ? `Key found in ${provider.envKey}` : `${provider.envKey} not set`}
              </p>
              {provider.configured && (
                <p className="text-xs text-gray-500 mt-1">
                  Model: {provider.id === "openai" ? settings.openaiModel : settings.geminiModel}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {isAdmin && (
        <div className="flex flex-wrap items-end gap-4 mb-4">
          <div>
            <label className="form-label text-xs">Selection mode</label>
            <select
              value={settings.provider}
              onChange={(e) => update({ provider: e.target.value })}
              disabled={saving}
              className="form-select"
              style={{ minWidth: "190px" }}
            >
              <option value="auto">Automatic (first working key)</option>
              <option value="gemini">Always Google Gemini</option>
              <option value="openai">Always OpenAI</option>
            </select>
          </div>

          {settings.available.gemini && (
            <div>
              <label className="form-label text-xs">Gemini model</label>
              <select
                value={settings.geminiModel}
                onChange={(e) => update({ geminiModel: e.target.value })}
                disabled={saving}
                className="form-select"
              >
                {settings.providers.find((p) => p.id === "gemini").models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}

          {settings.available.openai && (
            <div>
              <label className="form-label text-xs">OpenAI model</label>
              <select
                value={settings.openaiModel}
                onChange={(e) => update({ openaiModel: e.target.value })}
                disabled={saving}
                className="form-select"
              >
                {settings.providers.find((p) => p.id === "openai").models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2 pb-2">
            <input
              id="ai-enabled"
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
              className="w-4 h-4"
              style={{ width: "1rem", height: "1rem" }}
            />
            <label htmlFor="ai-enabled" className="text-sm text-gray-700">
              AI features enabled
            </label>
          </div>
        </div>
      )}

      {!isAdmin && active && (
        <p className="text-xs text-gray-500 mb-3">
          Running on {active.label}. An administrator can change the provider.
        </p>
      )}

      {/* Test result */}
      {testResult && (
        <div className={`alert ${testResult.ok ? "alert-success" : "alert-error"} flex items-start gap-3`}>
          {testResult.ok ? (
            <CheckCircle2 size={18} className="mt-0.5 flex-shrink-0" />
          ) : (
            <XCircle size={18} className="mt-0.5 flex-shrink-0" />
          )}
          <div className="text-sm">
            {testResult.ok ? (
              <p>
                Connected to {testResult.provider === "openai" ? "OpenAI" : "Google Gemini"} using {testResult.model} in{" "}
                {testResult.executionTimeMs} ms.
              </p>
            ) : (
              <p>{testResult.error}</p>
            )}
          </div>
        </div>
      )}

      {!testResult && settings.lastCheck && (
        <p className="text-xs text-gray-500">
          Last checked {new Date(settings.lastCheck.at).toLocaleString("en-NG")} —{" "}
          {settings.lastCheck.ok ? "connection healthy" : settings.lastCheck.error}
        </p>
      )}

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </div>
  );
}
