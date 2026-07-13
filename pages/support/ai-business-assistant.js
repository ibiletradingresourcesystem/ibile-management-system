/**
 * AI Business Assistant Page
 * 
 * Central workspace for all AI capabilities.
 * Route: /support/ai-business-assistant
 */
import { useState, useEffect, useCallback, useRef } from "react";
import Layout from "@/components/Layout";
import { apiClient } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import AIDecisionCenter from "@/components/AIDecisionCenter";
import { Send, RefreshCw, Sparkles, TrendingUp, AlertTriangle, Package, DollarSign } from "lucide-react";

export default function AIBusinessAssistantPage() {
  const [activeSection, setActiveSection] = useState("overview");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    try { setIsAdmin(JSON.parse(localStorage.getItem("user") || "{}").role === "admin"); } catch {}
  }, []);

  const sections = [
    { key: "overview", label: "Overview" },
    { key: "chat", label: "AI Chat" },
    { key: "decisions", label: "Decision Center" },
    { key: "insights", label: "Insights" },
  ];

  return (
    <Layout>
      <div className="page-container">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="page-title">AI Business Assistant</h1>
              <span className="text-[10px] bg-purple-100 text-purple-700 px-2.5 py-1 rounded-full font-semibold uppercase">AI Powered</span>
            </div>
            <p className="page-subtitle">Review recommendations, ask business questions, and manage AI insights</p>
          </div>

          {/* Section Tabs */}
          <div className="flex overflow-x-auto border-b mb-6 gap-0">
            {sections.map((s) => (
              <button
                key={s.key}
                onClick={() => setActiveSection(s.key)}
                className={`px-5 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  activeSection === s.key ? "border-purple-600 text-purple-600" : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Content */}
          {activeSection === "overview" && <OverviewSection isAdmin={isAdmin} />}
          {activeSection === "chat" && <ChatSection />}
          {activeSection === "decisions" && <AIDecisionCenter isAdmin={isAdmin} />}
          {activeSection === "insights" && <InsightsSection />}
        </div>
      </div>
    </Layout>
  );
}

// ─── OVERVIEW SECTION ──────────────────────────────────────────

function OverviewSection({ isAdmin }) {
  const [summary, setSummary] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [summaryRes, recsRes] = await Promise.all([
          apiClient.get("/api/ai/report-summary?period=today").catch(() => ({ data: null })),
          apiClient.get("/api/ai/recommendations?status=pending&limit=5").catch(() => ({ data: { recommendations: [] } })),
        ]);
        setSummary(summaryRes.data);
        setRecommendations(recsRes.data?.recommendations || []);
      } catch {} finally { setLoading(false); }
    }
    load();
  }, []);

  if (loading) return <OverviewSkeleton />;

  const metrics = summary?.metrics;
  const insight = summary?.insight;

  return (
    <div className="space-y-6">
      {/* Health Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<TrendingUp size={18} />} label="Today's Sales" value={formatCurrency(metrics?.sales?.totalSales || 0)} color="blue" />
        <StatCard icon={<DollarSign size={18} />} label="Gross Profit" value={formatCurrency(metrics?.profit?.grossProfit || 0)} color="green" />
        <StatCard icon={<Package size={18} />} label="Low Stock" value={String(metrics?.stockHealth?.lowStockCount || 0)} color={metrics?.stockHealth?.lowStockCount > 10 ? "red" : "green"} />
        <StatCard icon={<AlertTriangle size={18} />} label="Pending Actions" value={String(recommendations.length)} color={recommendations.length > 3 ? "red" : "yellow"} />
      </div>

      {/* Executive Summary */}
      {insight && (
        <div className="content-card border-l-4 border-purple-500">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={16} className="text-purple-600" />
            <h3 className="text-sm font-bold text-gray-700 uppercase">AI Executive Summary</h3>
            {insight.healthScore > 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ml-auto ${
                insight.healthScore >= 70 ? "bg-green-100 text-green-700" : insight.healthScore >= 40 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"
              }`}>{insight.healthScore}/100</span>
            )}
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">{insight.summary}</p>
        </div>
      )}

      {/* Today's Priorities */}
      {recommendations.length > 0 && (
        <div className="content-card">
          <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Pending Recommendations</h3>
          <div className="space-y-2">
            {recommendations.slice(0, 5).map((rec) => (
              <div key={rec._id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5 border">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{rec.recommendation || rec.entityName}</p>
                  <p className="text-xs text-gray-500">{rec.recommendationType} • {rec.priority}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                  rec.priority === "critical" ? "bg-red-100 text-red-700" :
                  rec.priority === "high" ? "bg-orange-100 text-orange-700" :
                  "bg-yellow-100 text-yellow-700"
                }`}>{rec.priority}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Insights */}
      {insight?.highlights?.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="content-card">
            <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Highlights</h3>
            {insight.highlights.slice(0, 4).map((h, i) => (
              <p key={i} className="text-sm text-gray-600 mb-1.5 flex items-start gap-2"><span className="text-green-500">●</span>{h}</p>
            ))}
          </div>
          {insight?.recommendations?.length > 0 && (
            <div className="content-card">
              <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Top Recommendations</h3>
              {insight.recommendations.slice(0, 4).map((r, i) => (
                <p key={i} className="text-sm text-gray-600 mb-1.5 flex items-start gap-2"><span className="text-blue-500">{i + 1}.</span>{r}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CHAT SECTION ──────────────────────────────────────────

function ChatSection() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const chatEndRef = useRef(null);

  useEffect(() => {
    apiClient.get("/api/ai/chat").then(res => setSuggestions(res.data?.suggestions || [])).catch(() => {});
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages]);

  const sendMessage = useCallback(async (text) => {
    const userMsg = text || input.trim();
    if (!userMsg) return;

    const newMessages = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);
    setInput("");
    setSending(true);

    try {
      const res = await apiClient.post("/api/ai/chat", {
        message: userMsg,
        history: newMessages.slice(-8),
      });
      setMessages([...newMessages, { role: "assistant", content: res.data.response, source: res.data.source }]);
    } catch (err) {
      setMessages([...newMessages, { role: "assistant", content: "Sorry, I couldn't process that. Please try again.", source: "error" }]);
    } finally {
      setSending(false);
    }
  }, [input, messages]);

  return (
    <div className="content-card" style={{ height: "560px", display: "flex", flexDirection: "column" }}>
      <div className="flex items-center gap-2 mb-4 pb-3 border-b flex-shrink-0">
        <Sparkles size={18} className="text-purple-600" />
        <h3 className="text-base font-bold text-gray-800">AI Business Chat</h3>
        <span className="text-xs text-gray-400 ml-auto">Ask anything about your business</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-3 mb-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Sparkles size={32} className="text-purple-200 mx-auto mb-3" />
            <p className="text-sm text-gray-500 mb-4">Ask me about your business performance, inventory, or get recommendations.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.slice(0, 6).map((q, i) => (
                <button key={i} onClick={() => sendMessage(q)} className="text-xs bg-purple-50 text-purple-700 px-3 py-1.5 rounded-full hover:bg-purple-100 transition">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
              msg.role === "user" ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-800"
            }`}>
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              {msg.source && msg.role === "assistant" && (
                <p className="text-[10px] opacity-60 mt-1">{msg.source === "knowledge-base" ? "From help center" : msg.source === "ai" ? "AI generated" : ""}</p>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-4 py-2.5 text-sm text-gray-500 animate-pulse">Thinking...</div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 pt-3 border-t flex-shrink-0">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Ask about sales, inventory, recommendations..."
          className="flex-1 border rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-400 focus:border-transparent"
          disabled={sending}
        />
        <button onClick={() => sendMessage()} disabled={sending || !input.trim()} className="bg-purple-600 text-white px-4 py-2.5 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition">
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

// ─── INSIGHTS SECTION ──────────────────────────────────────────

function InsightsSection() {
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get("/api/ai/monthly-report")
      .then(res => setInsight(res.data?.insight))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="content-card animate-pulse"><div className="h-4 w-48 bg-gray-200 rounded mb-3" /><div className="h-3 w-full bg-gray-100 rounded" /></div>;

  if (!insight) return <div className="content-card"><p className="text-sm text-gray-500">No monthly insights available yet. Generate from the Reports page.</p></div>;

  return (
    <div className="space-y-4">
      <div className="content-card border-l-4 border-purple-500">
        <h3 className="text-sm font-bold text-gray-700 uppercase mb-2">Monthly Executive Summary</h3>
        <p className="text-sm text-gray-700 leading-relaxed">{insight.executiveSummary}</p>
        <p className="text-xs text-gray-400 mt-2">{insight.reportPeriod} • Generated {insight.generatedAt ? new Date(insight.generatedAt).toLocaleDateString() : ""}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {insight.highlights?.length > 0 && (
          <div className="content-card">
            <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Highlights</h3>
            <div className="space-y-2">{insight.highlights.slice(0, 6).map((h, i) => (
              <p key={i} className="text-sm text-gray-600 flex items-start gap-2"><span className="text-green-500 mt-0.5">●</span>{h.title || h}</p>
            ))}</div>
          </div>
        )}
        {insight.risks?.length > 0 && (
          <div className="content-card border-l-4 border-red-400">
            <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Risks</h3>
            <div className="space-y-2">{insight.risks.slice(0, 6).map((r, i) => (
              <p key={i} className="text-sm text-gray-600 flex items-start gap-2"><span className="text-red-500 mt-0.5">▲</span>{r.title || r}</p>
            ))}</div>
          </div>
        )}
        {insight.opportunities?.length > 0 && (
          <div className="content-card border-l-4 border-blue-400">
            <h3 className="text-sm font-bold text-gray-700 uppercase mb-3">Opportunities</h3>
            <div className="space-y-2">{insight.opportunities.slice(0, 6).map((o, i) => (
              <p key={i} className="text-sm text-gray-600 flex items-start gap-2"><span className="text-blue-500 mt-0.5">◆</span>{o.title || o}</p>
            ))}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SHARED COMPONENTS ──────────────────────────────────────────

function StatCard({ icon, label, value, color = "blue" }) {
  const colors = {
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-1">{icon}<span className="text-[10px] font-medium uppercase">{label}</span></div>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[1,2,3,4].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl" />)}
      </div>
      <div className="content-card"><div className="h-4 w-48 bg-gray-200 rounded mb-3" /><div className="h-3 w-full bg-gray-100 rounded" /><div className="h-3 w-3/4 bg-gray-100 rounded mt-2" /></div>
    </div>
  );
}
