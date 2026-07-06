import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import useProgress from "@/lib/useProgress";
import { formatCurrency, formatNumber } from "@/lib/format";
import { addDaysToDateKey, getDateKey, getDateTimeParts, getTodayDateKey, getWeekStartDateKey, parseDateKey } from "@/lib/dateFilter";
import {
  getTransactionDiscount,
  getTransactionItemQuantity,
  getTransactionNetSales,
  getTransactionRefundValue,
  isCompletedSale,
  isRefundedSale,
} from "@/lib/sales-report-utils";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

function MetricCard({ title, value, icon, color }) {
  const colors = {
    sky: "theme-note-primary",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    purple: "bg-purple-50 border-purple-200 text-purple-700",
  };
  return (
    <div className={`border rounded-xl p-4 shadow-sm ${colors[color] || colors.sky}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium opacity-80">{title}</span>
        <span className="text-xl">{icon}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

const METRICS = [
  { value: "totalSales", label: "Total Sales" },
  { value: "transactionCount", label: "Transaction Count" },
  { value: "avgTransaction", label: "Avg Transaction Value" },
  { value: "itemsSold", label: "Items Sold" },
  { value: "discounts", label: "Discounts" },
  { value: "refunds", label: "Refund Count" },
  { value: "refundValue", label: "Refund Value" },
  { value: "netSales", label: "Net Sales" },
];

function getDefaultDateKey(offset = 0) {
  const todayKey = getTodayDateKey();
  if (!todayKey) return "";
  return offset === 0 ? todayKey : addDaysToDateKey(todayKey, offset) || todayKey;
}

export default function TimeComparisons() {
  const [metric, setMetric] = useState("totalSales");
  const [dateRange1Start, setDateRange1Start] = useState(() => getDefaultDateKey(-7));
  const [dateRange1End, setDateRange1End] = useState(() => getDefaultDateKey());
  const [dateRange2Start, setDateRange2Start] = useState(() => getDefaultDateKey(-14));
  const [dateRange2End, setDateRange2End] = useState(() => getDefaultDateKey(-7));
  const [interval, setInterval] = useState("daily");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();

  useEffect(() => { fetchData(); }, [metric, dateRange1Start, dateRange1End, dateRange2Start, dateRange2End, interval]);

  function aggregateByInterval(transactions, startDate, endDate, intervalType) {
    const rangeStart = parseDateKey(startDate)?.key;
    const rangeEnd = parseDateKey(endDate)?.key;
    const buckets = {};

    if (!rangeStart || !rangeEnd) return [];

    const filteredTx = transactions.filter((tx) => {
      const txDateKey = getDateKey(tx.createdAt);
      return (isCompletedSale(tx) || isRefundedSale(tx)) && txDateKey && txDateKey >= rangeStart && txDateKey <= rangeEnd;
    });

    filteredTx.forEach((tx) => {
      const parts = getDateTimeParts(tx.createdAt);
      if (!parts) return;

      let key;
      if (intervalType === "daily") key = parts.dateKey;
      else if (intervalType === "weekly") {
        const weekStart = getWeekStartDateKey(parts.dateKey);
        if (!weekStart) return;
        key = "W-" + weekStart;
      } else if (intervalType === "monthly") key = `${parts.year}-${parts.month}`;
      else key = parts.dateKey;

      if (!buckets[key]) {
        buckets[key] = { totalSales: 0, transactionCount: 0, itemsSold: 0, discounts: 0, refunds: 0, refundValue: 0 };
      }
      if (isCompletedSale(tx)) {
        buckets[key].totalSales += getTransactionNetSales(tx);
        buckets[key].transactionCount += 1;
        buckets[key].itemsSold += getTransactionItemQuantity(tx);
        buckets[key].discounts += getTransactionDiscount(tx);
      } else if (isRefundedSale(tx)) {
        buckets[key].refunds += 1;
        buckets[key].refundValue += getTransactionRefundValue(tx);
      }
    });

    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, vals]) => ({
        label: key,
        ...vals,
        avgTransaction: vals.transactionCount > 0 ? vals.totalSales / vals.transactionCount : 0,
        netSales: vals.totalSales,
      }));
  }

  async function fetchData() {
    try {
      setLoading(true);
      start();
      onFetch();
      const res = await fetch("/api/transactions/transactions");
      const txRes = await res.json();
      if (!txRes.success || !txRes.transactions) { setData(null); setLoading(false); return; }

      const period1 = aggregateByInterval(txRes.transactions, dateRange1Start, dateRange1End, interval);
      onProcess();
      const period2 = aggregateByInterval(txRes.transactions, dateRange2Start, dateRange2End, interval);

      const p1Total = period1.reduce((s, b) => s + (b[metric] || 0), 0);
      const p2Total = period2.reduce((s, b) => s + (b[metric] || 0), 0);
      const diff = p1Total - p2Total;
      const diffPercent = p2Total > 0 ? ((diff / p2Total) * 100).toFixed(1) : "N/A";

      setData({ period1, period2, p1Total, p2Total, diff, diffPercent });
    } catch (err) { console.error("Error fetching data:", err); }
    finally { complete(); setLoading(false); }
  }

  const metricLabel = METRICS.find((m) => m.value === metric)?.label || metric;
  const isCurrency = ["totalSales", "avgTransaction", "discounts", "refundValue", "netSales"].includes(metric);
  const fmt = (v) => (isCurrency ? formatCurrency(v) : formatNumber(v));

  const chartData = data ? (() => {
    const maxLen = Math.max(data.period1.length, data.period2.length);
    const labels = [];
    for (let i = 0; i < maxLen; i++) {
      const l1 = data.period1[i]?.label || "";
      const l2 = data.period2[i]?.label || "";
      labels.push(l1 && l2 ? `${l1} / ${l2}` : l1 || l2 || `Point ${i + 1}`);
    }
    return {
      labels,
      datasets: [
        {
          label: `Period 1 (${dateRange1Start} to ${dateRange1End})`,
          data: data.period1.map((b) => b[metric] || 0),
          borderColor: "#0ea5e9", backgroundColor: "rgba(14,165,233,0.1)",
          fill: true, tension: 0.4, pointRadius: 4,
        },
        {
          label: `Period 2 (${dateRange2Start} to ${dateRange2End})`,
          data: data.period2.map((b) => b[metric] || 0),
          borderColor: "#8b5cf6", backgroundColor: "rgba(139,92,246,0.1)",
          fill: true, tension: 0.4, pointRadius: 4,
        },
      ],
    };
  })() : null;

  const maxLen = data ? Math.max(data.period1.length, data.period2.length) : 0;
  const comparisonRows = [];
  if (data) {
    for (let i = 0; i < maxLen; i++) {
      const p1 = data.period1[i];
      const p2 = data.period2[i];
      const v1 = p1 ? (p1[metric] || 0) : 0;
      const v2 = p2 ? (p2[metric] || 0) : 0;
      const d = v1 - v2;
      comparisonRows.push({
        label1: p1?.label || "-", label2: p2?.label || "-",
        v1, v2, diff: d,
        diffPercent: v2 > 0 ? ((d / v2) * 100).toFixed(1) : "N/A",
      });
    }
  }

  return (
    <Layout title="Time Comparison">
      <div className="page-container">
        <div className="page-content">
          {/* Breadcrumb */}
          <div className="mb-6 text-sm text-gray-600">
            <Link href="/" className="text-cyan-600 hover:text-cyan-700">Home</Link>
            <span className="mx-2 text-gray-400">{">"}</span>
            <Link href="/reporting" className="text-cyan-600 hover:text-cyan-700">Reporting</Link>
            <span className="mx-2 text-gray-400">{">"}</span>
            <span className="text-gray-800 font-medium">Time Comparisons</span>
          </div>

          <div className="page-header">
            <h1 className="page-title">Time Period Comparison</h1>
            <p className="page-subtitle">Compare metrics between two time periods</p>
          </div>

          {/* Filters */}
          <div className="content-card mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Metric</label>
                <select value={metric} onChange={(e) => setMetric(e.target.value)} className="form-select">
                  {METRICS.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Interval</label>
                <select value={interval} onChange={(e) => setInterval(e.target.value)} className="form-select">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="p-4 theme-note-primary rounded-lg">
                <h4 className="text-sm font-semibold theme-section-title mb-3">Period 1</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Start</label>
                    <input type="date" value={dateRange1Start} onChange={(e) => setDateRange1Start(e.target.value)} className="form-input text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">End</label>
                    <input type="date" value={dateRange1End} onChange={(e) => setDateRange1End(e.target.value)} className="form-input text-sm" />
                  </div>
                </div>
              </div>
              <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                <h4 className="text-sm font-semibold text-purple-700 mb-3">Period 2</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Start</label>
                    <input type="date" value={dateRange2Start} onChange={(e) => setDateRange2Start(e.target.value)} className="form-input text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">End</label>
                    <input type="date" value={dateRange2End} onChange={(e) => setDateRange2End(e.target.value)} className="form-input text-sm" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="content-card">
              <Loader size="md" text="Loading comparison data..." progress={progress} />
            </div>
          ) : data ? (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <MetricCard title={`Period 1 ${metricLabel}`} value={fmt(data.p1Total)} icon="📊" color="sky" />
                <MetricCard title={`Period 2 ${metricLabel}`} value={fmt(data.p2Total)} icon="📈" color="purple" />
                <MetricCard title="Difference" value={fmt(data.diff)} icon={data.diff >= 0 ? "📈" : "📉"} color={data.diff >= 0 ? "emerald" : "amber"} />
                <MetricCard title="Change %" value={data.diffPercent === "N/A" ? "N/A" : `${data.diffPercent}%`} icon="🔄" color={data.diff >= 0 ? "emerald" : "amber"} />
              </div>

              {/* Chart */}
              <div className="content-card mb-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">{metricLabel} Over Time</h3>
                <div style={{ maxHeight: "400px" }}>
                  {chartData && (
                    <Line
                      data={chartData}
                      options={{
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: { legend: { position: "bottom" } },
                        scales: { y: { beginAtZero: true } },
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Comparison Table */}
              <div className="data-table-container">
                <table className="data-table">
                  <thead className="sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Period 1</th>
                      <th className="px-4 py-3 text-right font-semibold">Value</th>
                      <th className="px-4 py-3 text-left font-semibold">Period 2</th>
                      <th className="px-4 py-3 text-right font-semibold">Value</th>
                      <th className="px-4 py-3 text-right font-semibold">Difference</th>
                      <th className="px-4 py-3 text-right font-semibold">Change %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {comparisonRows.map((row, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="px-4 py-3 font-medium text-gray-800">{row.label1}</td>
                        <td className="px-4 py-3 text-right">{fmt(row.v1)}</td>
                        <td className="px-4 py-3 font-medium text-gray-800">{row.label2}</td>
                        <td className="px-4 py-3 text-right">{fmt(row.v2)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${row.diff >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {row.diff >= 0 ? "+" : ""}{fmt(row.diff)}
                        </td>
                        <td className={`px-4 py-3 text-right font-medium ${row.diff >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {row.diffPercent === "N/A" ? "N/A" : `${row.diff >= 0 ? "+" : ""}${row.diffPercent}%`}
                        </td>
                      </tr>
                    ))}
                    {/* Total Row */}
                    <tr className="theme-table-summary-row font-bold border-t-2 border-gray-300">
                      <td className="px-4 py-3 text-gray-800">Total</td>
                      <td className="px-4 py-3 text-right">{fmt(data.p1Total)}</td>
                      <td className="px-4 py-3 text-gray-800">Total</td>
                      <td className="px-4 py-3 text-right">{fmt(data.p2Total)}</td>
                      <td className={`px-4 py-3 text-right ${data.diff >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {data.diff >= 0 ? "+" : ""}{fmt(data.diff)}
                      </td>
                      <td className={`px-4 py-3 text-right ${data.diff >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                        {data.diffPercent === "N/A" ? "N/A" : `${data.diff >= 0 ? "+" : ""}${data.diffPercent}%`}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="content-card text-center text-gray-500 py-12">No data available for the selected periods.</div>
          )}
        </div>
      </div>
    </Layout>
  );
}

