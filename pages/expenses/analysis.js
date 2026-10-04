import { useState, useEffect, useMemo, useRef } from "react";
import Layout from "@/components/Layout";
import { formatCurrency } from "@/lib/format";
import { RefreshCw, Filter, Download, ChevronDown, ChevronUp } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { addDays, currentTradingDay, formatDayKey, TRADING_DAY_START_HOUR, tradingDayKey } from "@/lib/tradingDay";

const COLORS = ["#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#be185d", "#4f46e5", "#65a30d", "#ea580c"];

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * The days a period covers, first and last, as "YYYY-MM-DD" trading days — 6am to 6am, the days the
 * till cash is kept in, so the cash and the expenses on this page cover the same hours. At 1am,
 * "Today" is still the day that began at 6am yesterday. null is all time.
 */
function getPeriodDays(period) {
  const today = currentTradingDay();
  const sinceMonday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const firstOfMonth = `${today.slice(0, 7)}-01`;

  switch (period) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case "this-week":
      return { from: addDays(today, -sinceMonday), to: today };
    case "last-week": {
      const from = addDays(today, -sinceMonday - 7);
      return { from, to: addDays(from, 6) };
    }
    case "this-month":
      return { from: firstOfMonth, to: today };
    case "last-month": {
      const to = addDays(firstOfMonth, -1);
      return { from: `${to.slice(0, 7)}-01`, to };
    }
    default:
      return null;
  }
}

/** When a payment went out, as the cash entries count it: when it was paid, else when it was entered. */
const paidAt = (expense) => expense.expenseDate || expense.createdAt;

export default function ExpenseAnalysisPage() {
  const [expenses, setExpenses] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBarChart, setShowBarChart] = useState(false);

  // Filters
  const [activePeriod, setActivePeriod] = useState("today");
  const [filters, setFilters] = useState({ category: "", minAmount: "", maxAmount: "", location: "" });
  const [showFilters, setShowFilters] = useState(false);

  // Daily cash report
  const [reports, setReports] = useState({});
  // The trading day it is now: before 6am the till's day is still yesterday
  const [selectedDate, setSelectedDate] = useState(currentTradingDay());
  const [dailyCashEntries, setDailyCashEntries] = useState({});

  // Expense list
  const [showAllExpenses, setShowAllExpenses] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  // The cards: the cash for the period and location picked in the filters
  const [cashSummary, setCashSummary] = useState(null);
  // Only the latest answer counts when the filters change faster than the server replies
  const expensesRequest = useRef(0);
  const summaryRequest = useRef(0);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    fetchExpenses();
  }, [activePeriod]);

  useEffect(() => {
    if (locations.length > 0) {
      // The day's report brings the cash entries up to date, so the period totals are read after it
      fetchReports().then(fetchCashSummary);
      fetchDailyCashEntries();
    }
  }, [selectedDate, locations]);

  useEffect(() => {
    if (locations.length > 0) fetchCashSummary();
  }, [activePeriod, filters.location]);

  async function fetchData() {
    setLoading(true);
    try {
      const locRes = await fetch("/api/setup/get");
      const locData = await locRes.json();
      if (locData.store?.locations) {
        const locs = locData.store.locations.map(l => typeof l === "string" ? l : l.name);
        setLocations(locs);
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  /**
   * The period's expenses. Asked for without a range, the list sends only the newest 50, which
   * left the longer periods short.
   */
  async function fetchExpenses() {
    const headers = { Authorization: `Bearer ${localStorage.getItem("auth_token")}` };
    const days = getPeriodDays(activePeriod);
    const params = new URLSearchParams({ all: "true" });
    if (days) {
      params.set("from", days.from);
      params.set("to", days.to);
    }
    const request = ++expensesRequest.current;
    try {
      const res = await fetch(`/api/expenses?${params}`, { headers });
      const data = await res.json();
      const list = Array.isArray(data?.expenses) ? data.expenses : Array.isArray(data) ? data : [];
      if (request === expensesRequest.current) setExpenses(list);
    } catch (err) {
      console.error("Expenses fetch failed:", err);
    }
  }

  async function fetchCashSummary() {
    const headers = { Authorization: `Bearer ${localStorage.getItem("auth_token")}` };
    const days = getPeriodDays(activePeriod);
    const params = new URLSearchParams();
    if (days) {
      params.set("from", days.from);
      params.set("to", days.to);
    }
    if (filters.location) params.set("location", filters.location);
    const request = ++summaryRequest.current;
    try {
      const res = await fetch(`/api/daily-cash/summary?${params}`, { headers });
      const data = await res.json();
      if (request === summaryRequest.current && res.ok) setCashSummary(data.totals || null);
    } catch (err) {
      console.error("Cash summary fetch failed:", err);
    }
  }

  async function fetchReports() {
    const headers = { Authorization: `Bearer ${localStorage.getItem("auth_token")}` };
    const reportData = {};
    for (const loc of locations) {
      try {
        const res = await fetch(`/api/daily-cash/report?location=${encodeURIComponent(loc)}&date=${selectedDate}`, { headers });
        if (res.ok) reportData[loc] = await res.json();
      } catch (err) {
        console.error(`Report fetch failed for ${loc}:`, err);
      }
    }
    setReports(reportData);
  }

  async function fetchDailyCashEntries() {
    const headers = { Authorization: `Bearer ${localStorage.getItem("auth_token")}` };
    const entries = {};
    for (const loc of locations) {
      try {
        const res = await fetch(`/api/daily-cash?location=${encodeURIComponent(loc)}`, { headers });
        if (res.ok) entries[loc] = await res.json();
      } catch (err) {
        console.error(`Daily cash fetch failed for ${loc}:`, err);
      }
    }
    setDailyCashEntries(entries);
  }

  /**
   * Entries written before the cash figures were corrected hold the expected cash rather than what
   * was counted, and only the last till of each day. This walks the days again from the till
   * reports; anything typed in by hand is left as it is.
   */
  async function rebuildCashEntries() {
    setRebuilding(true);
    try {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
      };
      const res = await fetch("/api/daily-cash/rebuild", { method: "POST", headers, body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rebuild failed");
      await Promise.all([fetchReports(), fetchDailyCashEntries()]);
      await fetchCashSummary();
    } catch (err) {
      console.error("Cash rebuild failed:", err);
    } finally {
      setRebuilding(false);
    }
  }

  // === Filtering ===
  const filteredExpenses = useMemo(() => {
    let list = [...expenses];
    const days = getPeriodDays(activePeriod);
    if (days) {
      list = list.filter(e => {
        const day = tradingDayKey(paidAt(e));
        return Boolean(day) && day >= days.from && day <= days.to;
      });
    }
    if (filters.category) list = list.filter(e => e.categoryName === filters.category);
    if (filters.location) list = list.filter(e => e.locationName === filters.location);
    if (filters.minAmount) list = list.filter(e => Number(e.amount) >= Number(filters.minAmount));
    if (filters.maxAmount) list = list.filter(e => Number(e.amount) <= Number(filters.maxAmount));
    return list;
  }, [expenses, activePeriod, filters]);

  const totalSpent = filteredExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const allCategories = [...new Set(expenses.map(e => e.categoryName).filter(Boolean))];

  const expensesByCategory = useMemo(() => {
    const map = {};
    filteredExpenses.forEach(e => {
      const cat = e.categoryName || "General";
      map[cat] = (map[cat] || 0) + Number(e.amount || 0);
    });
    const sorted = Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    // Limit chart to top 8 categories, group rest as "Other"
    if (sorted.length > 8) {
      const top = sorted.slice(0, 8);
      const otherTotal = sorted.slice(8).reduce((s, item) => s + item.value, 0);
      if (otherTotal > 0) top.push({ name: "Other", value: otherTotal });
      return top;
    }
    return sorted;
  }, [filteredExpenses]);

  // What the cards cover, said under each of them
  const periodDays = getPeriodDays(activePeriod);
  const periodLabel = [
    filters.location || "All locations",
    !periodDays
      ? "all time"
      : periodDays.from === periodDays.to
        ? formatDayKey(periodDays.from, { weekday: true })
        : `${formatDayKey(periodDays.from)} – ${formatDayKey(periodDays.to)}`,
  ].join(" · ");
  const atHandLabel = [
    filters.location || "All locations",
    !periodDays || periodDays.to >= currentTradingDay() ? "now" : `end of ${formatDayKey(periodDays.to)}`,
  ].join(" · ");

  const handlePeriodSelect = (p) => setActivePeriod(prev => prev === p ? "" : p);
  const resetFilters = () => {
    setFilters({ category: "", minAmount: "", maxAmount: "", location: "" });
    setActivePeriod("today");
  };

  const periods = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "this-week", label: "This Week" },
    { key: "last-week", label: "Last Week" },
    { key: "this-month", label: "This Month" },
    { key: "last-month", label: "Last Month" },
  ];

  return (
    <Layout>
      <div className="page-container">
        <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">Visualize and monitor your business expenditures in one place.</p>
          </div>
          <button onClick={() => { fetchData(); fetchExpenses(); fetchReports().then(fetchCashSummary); }} className="btn-action-primary flex items-center gap-2 text-sm">
            <RefreshCw className="w-4 h-4" /> Refresh Data
          </button>
        </div>

        {/* Active Filters Badge */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-gray-500">Active Filters:</span>
          {activePeriod && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">Date: {activePeriod}</span>}
          {filters.location && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Location: {filters.location}</span>}
          {(activePeriod || filters.location || filters.category) && (
            <button onClick={resetFilters} className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded hover:bg-red-200">Reset Filters</button>
          )}
        </div>

        {/* Filter Panel */}
        <div className="content-card mb-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Period</label>
              <select value={activePeriod} onChange={e => setActivePeriod(e.target.value)} className="form-select text-sm w-auto">
                <option value="">All Time</option>
                {periods.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Location</label>
              <select value={filters.location} onChange={e => setFilters(f => ({ ...f, location: e.target.value }))} className="form-select text-sm w-auto">
                <option value="">All</option>
                {locations.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Min Amount</label>
              <input type="number" value={filters.minAmount} onChange={e => setFilters(f => ({ ...f, minAmount: e.target.value }))} placeholder="₦0" className="form-input text-sm w-28" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Max Amount</label>
              <input type="number" value={filters.maxAmount} onChange={e => setFilters(f => ({ ...f, maxAmount: e.target.value }))} placeholder="₦100,000" className="form-input text-sm w-28" />
            </div>
          </div>
        </div>

        {/* Summary Cards: the period and location picked above */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="content-card text-center">
            <p className="text-sm text-gray-500">Cash Received</p>
            <p className="text-2xl font-bold text-blue-700">{formatCurrency(cashSummary?.cashReceived || 0)}</p>
            <p className="text-xs text-gray-400 mt-1">{periodLabel}</p>
          </div>
          <div className="content-card text-center">
            <p className="text-sm text-gray-500">Expenses</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(totalSpent)}</p>
            <p className="text-xs text-gray-400 mt-1">{periodLabel}</p>
          </div>
          <div className="content-card text-center">
            <p className="text-sm text-gray-500">Cash at Hand</p>
            <p className="text-2xl font-bold text-green-700">{formatCurrency(cashSummary?.cashAtHand || 0)}</p>
            <p className="text-xs text-gray-400 mt-1">{atHandLabel}</p>
          </div>
        </div>

        {/* Chart + Expense List */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Category Breakdown */}
          <div className="content-card">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-800">Category Breakdown</h2>
              <button onClick={() => setShowBarChart(!showBarChart)} className="text-xs text-blue-600 hover:underline">
                {showBarChart ? "Pie Chart" : "Bar Chart"}
              </button>
            </div>
            {expensesByCategory.length === 0 ? (
              <p className="text-sm text-gray-400 italic text-center py-8">No data for selected period.</p>
            ) : showBarChart ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={expensesByCategory}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                  <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]}>
                    {expensesByCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={expensesByCategory} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name }) => name}>
                    {expensesByCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            )}
            {/* Legend */}
            <div className="flex flex-wrap gap-2 mt-3">
              {expensesByCategory.map((item, i) => (
                <span key={item.name} className="flex items-center gap-1 text-xs text-gray-600">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  {item.name}
                </span>
              ))}
            </div>
          </div>

          {/* All Expenses */}
          <div className="content-card">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">All Expenses</h2>
            {filteredExpenses.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No expenses for this period.</p>
            ) : (
              <div className="space-y-3 max-h-[350px] overflow-y-auto">
                {(showAllExpenses ? filteredExpenses : filteredExpenses.slice(0, 6)).map(exp => (
                  <div key={exp._id} className="border-b border-gray-100 pb-2">
                    <p className="font-medium text-sm text-gray-900">{exp.title}</p>
                    <p className="text-xs text-gray-500">
                      {formatCurrency(exp.amount)} - {exp.categoryName === "Petty Cash" ? "Petty Cash Vendor" : exp.categoryName} - {exp.locationName || "—"}
                    </p>
                    <p className="text-xs text-gray-400">{formatDate(paidAt(exp))}</p>
                  </div>
                ))}
              </div>
            )}
            {filteredExpenses.length > 6 && (
              <button onClick={() => setShowAllExpenses(!showAllExpenses)} className="mt-3 text-xs text-blue-600 hover:underline flex items-center gap-1">
                {showAllExpenses ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> Show all ({filteredExpenses.length})</>}
              </button>
            )}
          </div>
        </div>

        {/* End of Day + Daily Cash side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* End of Day Report - Detailed (takes 2 cols) */}
          <div className="lg:col-span-2">
        {locations.map(loc => (
          <div key={loc} className="content-card mb-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">📊 End of Day Report</h2>
                <p className="text-sm text-gray-500">Date: {selectedDate} | Location: {loc}</p>
                <p className="text-xs text-gray-400">
                  {TRADING_DAY_START_HOUR}am to {TRADING_DAY_START_HOUR}am: a till closed before {TRADING_DAY_START_HOUR}am counts for this day.
                </p>
              </div>
              <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="form-input w-auto text-sm" />
            </div>

            {reports[loc] ? (
              <>
                <div className="border border-gray-100 rounded-lg overflow-hidden mb-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left py-3 px-4 text-blue-700 font-semibold">METRIC</th>
                        <th className="text-right py-3 px-4 text-blue-700 font-semibold">AMOUNT (₦)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-50">
                        <td className="py-3 px-4 text-gray-700">Cash B/F (Prev. Day)</td>
                        <td className="py-3 px-4 text-right font-medium">{Number(reports[loc].cashBroughtForward || 0).toLocaleString()}</td>
                      </tr>
                      <tr className="border-b border-gray-50">
                        <td className="py-3 px-4 text-gray-700">Cash Received</td>
                        <td className="py-3 px-4 text-right font-medium">{Number(reports[loc].cashReceived || 0).toLocaleString()}</td>
                      </tr>
                      <tr className="border-b border-gray-50">
                        <td className="py-3 px-4 text-gray-700">Total Cash Available</td>
                        <td className="py-3 px-4 text-right font-medium">{Number(reports[loc].totalCashAvailable || 0).toLocaleString()}</td>
                      </tr>
                      <tr className="border-b border-gray-50">
                        <td className="py-3 px-4 text-gray-700">Total Payments</td>
                        <td className="py-3 px-4 text-right font-medium text-red-600">-{Number(reports[loc].totalPayments || 0).toLocaleString()}</td>
                      </tr>
                      <tr>
                        <td className="py-3 px-4 font-semibold text-green-700">Cash at Hand</td>
                        <td className="py-3 px-4 text-right font-bold text-green-700">{Number(reports[loc].cashAtHand || 0).toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Payments */}
                <div className="mb-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">💎 Payments</h4>
                  {reports[loc]?.expenses?.length > 0 ? (
                    <div className="space-y-1">
                      {reports[loc].expenses.map(e => (
                        <p key={e._id} className="text-xs text-gray-600">• {e.title} — {formatCurrency(e.amount)}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">No payments for this date.</p>
                  )}
                </div>

                {/* Share Buttons */}
                <div className="flex flex-wrap gap-3 pt-3 border-t border-gray-100">
                  <button
                    onClick={() => {
                      const text = `End of Day Report\nDate: ${selectedDate} | ${loc}\n\nCash B/F: ₦${Number(reports[loc].cashBroughtForward || 0).toLocaleString()}\nCash Received: ₦${Number(reports[loc].cashReceived || 0).toLocaleString()}\nTotal Available: ₦${Number(reports[loc].totalCashAvailable || 0).toLocaleString()}\nTotal Payments: -₦${Number(reports[loc].totalPayments || 0).toLocaleString()}\nCash at Hand: ₦${Number(reports[loc].cashAtHand || 0).toLocaleString()}`;
                      navigator.clipboard.writeText(text);
                    }}
                    className="text-xs border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 flex items-center gap-1"
                  >
                    📋 Copy
                  </button>
                  <button
                    onClick={() => {
                      const text = `End of Day Report\nDate: ${selectedDate} | ${loc}\n\nCash B/F: ₦${Number(reports[loc].cashBroughtForward || 0).toLocaleString()}\nCash Received: ₦${Number(reports[loc].cashReceived || 0).toLocaleString()}\nTotal Available: ₦${Number(reports[loc].totalCashAvailable || 0).toLocaleString()}\nTotal Payments: -₦${Number(reports[loc].totalPayments || 0).toLocaleString()}\nCash at Hand: ₦${Number(reports[loc].cashAtHand || 0).toLocaleString()}`;
                      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
                    }}
                    className="text-xs border border-green-300 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-50 flex items-center gap-1"
                  >
                    💬 WhatsApp
                  </button>
                  <button
                    onClick={() => {
                      const text = `End of Day Report\nDate: ${selectedDate} | ${loc}\n\nCash B/F: ₦${Number(reports[loc].cashBroughtForward || 0).toLocaleString()}\nCash Received: ₦${Number(reports[loc].cashReceived || 0).toLocaleString()}\nTotal Available: ₦${Number(reports[loc].totalCashAvailable || 0).toLocaleString()}\nTotal Payments: -₦${Number(reports[loc].totalPayments || 0).toLocaleString()}\nCash at Hand: ₦${Number(reports[loc].cashAtHand || 0).toLocaleString()}`;
                      window.open(`mailto:?subject=End of Day Report - ${loc}&body=${encodeURIComponent(text)}`);
                    }}
                    className="text-xs border border-blue-300 text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-50 flex items-center gap-1"
                  >
                    ✉️ Email
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-400 italic">No report data for this date.</p>
            )}
          </div>
        ))}
          </div>

          {/* Daily Cash Report */}
          <div className="lg:col-span-1">
            <div className="content-card">
              <div className="flex items-start justify-between gap-2 mb-4">
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">💰 Daily Cash Report</h2>
                <button
                  onClick={rebuildCashEntries}
                  disabled={rebuilding}
                  title="Work the entries out again from the till closings, using the cash that was counted"
                  className="text-xs border border-blue-300 text-blue-700 px-2 py-1 rounded hover:bg-blue-50 disabled:opacity-50 whitespace-nowrap"
                >
                  {rebuilding ? "Recalculating…" : "Recalculate"}
                </button>
              </div>
              {locations.map(loc => (
                <div key={loc} className="mb-4">
                  <h3 className="font-semibold text-sm text-blue-700 mb-2 flex items-center gap-1">🏪 {loc}</h3>
                  {dailyCashEntries[loc]?.length > 0 ? (
                    <div className="max-h-[300px] overflow-y-auto space-y-1">
                      {dailyCashEntries[loc].map(entry => (
                        <div key={entry._id} className="flex justify-between items-center bg-blue-50 rounded px-3 py-2 text-sm">
                          {/* The server says which day an entry is; reading it out of the date depends on the computer's time zone */}
                          <span className="text-gray-700 flex items-center gap-1">🏪 {formatDayKey(entry.day) || formatDate(entry.date)}</span>
                          <span className="font-bold text-blue-800">{formatCurrency(entry.amount)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">No daily cash entries.</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        </div>
      </div>
    </Layout>
  );
}
