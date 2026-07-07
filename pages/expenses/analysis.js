import { useState, useEffect, useMemo } from "react";
import Layout from "@/components/Layout";
import { formatCurrency } from "@/lib/format";
import { RefreshCw, Filter, Download, ChevronDown, ChevronUp } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";

const COLORS = ["#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#be185d", "#4f46e5", "#65a30d", "#ea580c"];

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function getDateRange(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start, end;

  switch (period) {
    case "today":
      start = today;
      end = new Date(today); end.setDate(end.getDate() + 1);
      break;
    case "yesterday":
      start = new Date(today); start.setDate(start.getDate() - 1);
      end = today;
      break;
    case "this-week": {
      const day = today.getDay();
      const diff = (day + 6) % 7;
      start = new Date(today); start.setDate(start.getDate() - diff);
      end = new Date(today); end.setDate(end.getDate() + 1);
      break;
    }
    case "last-week": {
      const day = today.getDay();
      const diff = (day + 6) % 7;
      start = new Date(today); start.setDate(start.getDate() - diff - 7);
      end = new Date(start); end.setDate(end.getDate() + 7);
      break;
    }
    case "this-month":
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today); end.setDate(end.getDate() + 1);
      break;
    case "last-month":
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    default:
      return null;
  }
  return { start, end };
}

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
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);

  // Expense list
  const [showAllExpenses, setShowAllExpenses] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (locations.length > 0) {
      fetchReports();
    }
  }, [selectedDate, locations]);

  async function fetchData() {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${localStorage.getItem("auth_token")}` };
      const [expRes, locRes] = await Promise.all([
        fetch("/api/expenses", { headers }),
        fetch("/api/setup/get"),
      ]);
      const expData = await expRes.json();
      setExpenses(expData.expenses || expData || []);
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

  // === Filtering ===
  const filteredExpenses = useMemo(() => {
    let list = [...expenses];
    const range = getDateRange(activePeriod);
    if (range) {
      list = list.filter(e => {
        const d = new Date(e.createdAt || e.expenseDate);
        return d >= range.start && d < range.end;
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
      const cat = e.categoryName || "Uncategorized";
      map[cat] = (map[cat] || 0) + Number(e.amount || 0);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredExpenses]);

  // Cash summary from reports
  const totalCashReceived = Object.values(reports).reduce((s, r) => s + (r?.cashReceived || 0), 0);
  const totalPayments = Object.values(reports).reduce((s, r) => s + (r?.totalPayments || 0), 0);
  const totalCashAtHand = Object.values(reports).reduce((s, r) => s + (r?.cashAtHand || 0), 0);

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
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">Visualize and monitor your business expenditures in one place.</p>
          </div>
          <button onClick={() => { fetchData(); fetchReports(); }} className="btn-action-primary flex items-center gap-2 text-sm">
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

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="content-card text-center">
            <p className="text-sm text-gray-500">Cash Received</p>
            <p className="text-2xl font-bold text-blue-700">{formatCurrency(totalCashReceived)}</p>
          </div>
          <div className="content-card text-center">
            <p className="text-sm text-gray-500">Expenses</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(totalSpent)}</p>
          </div>
          <div className="content-card text-center">
            <p className="text-sm text-gray-500">Cash at Hand</p>
            <p className="text-2xl font-bold text-green-700">{formatCurrency(totalCashAtHand)}</p>
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
                      {formatCurrency(exp.amount)} - {exp.categoryName} - {exp.locationName || "—"}
                    </p>
                    <p className="text-xs text-gray-400">{formatDate(exp.createdAt)}</p>
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

        {/* Daily Cash Report */}
        <div className="content-card mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">💰 Daily Cash Report</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {locations.length === 1 ? (
              <div className="md:col-span-2">
                <h3 className="font-semibold text-sm text-gray-700 mb-2">🏪 {locations[0]}</h3>
                {reports[locations[0]] ? (
                  <EndOfDayCard location={locations[0]} report={reports[locations[0]]} />
                ) : (
                  <p className="text-xs text-gray-400 italic">No daily cash records for {locations[0]}</p>
                )}
              </div>
            ) : (
              locations.map(loc => (
                <div key={loc}>
                  <h3 className="font-semibold text-sm text-gray-700 mb-2">🏪 {loc}</h3>
                  {reports[loc] ? (
                    <EndOfDayCard location={loc} report={reports[loc]} />
                  ) : (
                    <p className="text-xs text-gray-400 italic">No daily cash records for {loc}</p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* End of Day Report - Detailed */}
        {locations.map(loc => (
          <div key={loc} className="content-card mb-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">📊 End of Day Report</h2>
                <p className="text-sm text-gray-500">Date: {selectedDate} | Location: {loc}</p>
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
    </Layout>
  );
}

function EndOfDayCard({ location, report }) {
  if (!report) return null;
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
      <div className="flex justify-between"><span className="text-gray-600">Cash B/F</span><span>{formatCurrency(report.cashBroughtForward || 0)}</span></div>
      <div className="flex justify-between"><span className="text-gray-600">Cash Received</span><span>{formatCurrency(report.cashReceived || 0)}</span></div>
      <div className="flex justify-between"><span className="text-gray-600">Total Available</span><span>{formatCurrency(report.totalCashAvailable || 0)}</span></div>
      <div className="flex justify-between"><span className="text-gray-600">Payments</span><span className="text-red-600">-{formatCurrency(report.totalPayments || 0)}</span></div>
      <div className="flex justify-between font-bold border-t pt-1"><span className="text-green-700">Cash at Hand</span><span className="text-green-700">{formatCurrency(report.cashAtHand || 0)}</span></div>
    </div>
  );
}
