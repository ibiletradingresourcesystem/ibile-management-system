import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
  ArcElement,
  Filler,
} from "chart.js";
import { Line, Bar, Pie } from "react-chartjs-2";
import Layout from "@/components/Layout";
import { formatCurrency } from "@/lib/format";
import Loader from "@/components/Loader";
import useProgress from "@/lib/useProgress";

ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
  ArcElement
  ,Filler
);

export default function Reporting() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [location, setLocation] = useState("All");
  const [period, setPeriod] = useState("DAY");
  const [timeRange, setTimeRange] = useState("Last 14 days");
  const [availableLocations, setAvailableLocations] = useState([]);
  const [showHourlyChart, setShowHourlyChart] = useState(true);
  const [showComparison, setShowComparison] = useState(true);

  useEffect(() => {
    async function loadLocations() {
      try {
        const res = await fetch("/api/setup/get");
        const data = await res.json();
        const locations = Array.isArray(data?.store?.locations)
          ? data.store.locations
              .map((loc) => String(loc?.name || "").trim())
              .filter(Boolean)
          : [];

        setAvailableLocations(locations);
      } catch (error) {
        console.error("Error loading reporting locations:", error);
      }
    }

    loadLocations();
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      start();
      const periodLower = period.toLowerCase();
      const rangeParam = encodeURIComponent(timeRange);
      onFetch();
      const res = await fetch(
        `/api/reporting/reporting-data?location=${location}&period=${periodLower}&range=${rangeParam}`
      );
      onProcess();
      setReport(await res.json());
      complete();
      setLoading(false);
    }
    load();
  }, [location, period, timeRange]);

  if (loading) return <Layout><div className="min-h-screen flex items-center justify-center"><Loader size="md" text="Loading report data..." progress={progress} /></div></Layout>;

  const { 
    dates = [], 
    salesData = [], 
    transactionQty = [], 
    salesByTender = {}, 
    salesByLocation = {}, 
    bestSellingProducts = [], 
    summary = {},
    hourlyOfDay = new Array(24).fill(0),
    comparisonSalesData = [],
    comparisonTransactionQty = [],
    prevTotalSales = 0,
    prevTotalTransactions = 0,
  } = report;

  const locationOptions = Array.from(
    new Set([
      ...availableLocations,
      ...Object.keys(salesByLocation || {}).filter(Boolean),
      "online",
    ])
  ).sort((a, b) => {
    if (a === "online") return -1;
    if (b === "online") return 1;
    return a.localeCompare(b);
  });

  return (
    <Layout title="Reporting">
      <div className="page-container">
        <div className="page-content">
          {/* HEADER */}
          <div className="page-header">
            <div>
              <h1 className="page-title">Sales Report</h1>
              <p className="page-subtitle">Track your business performance and metrics in real-time</p>
            </div>
            <Link
              href="/reporting/end-of-day-report"
              className="btn-action-primary whitespace-nowrap"
            >
               EOD Reports
            </Link>
          </div>

          {/* FILTER BAR */}
          <div className="content-card mb-4 md:mb-6">
            <div className="flex flex-col gap-3 md:gap-4">
              {/* First row: Location and Time Range */}
              <div className="flex flex-col sm:flex-row gap-3 md:gap-4">
                {/* Location Dropdown */}
                <div className="flex-1 min-w-0">
                  <label className="form-label">Location</label>
                  <select 
                    value={location} 
                    onChange={(e) => setLocation(e.target.value)} 
                    className="form-select"
                  >
                    <option value="All">All Locations</option>
                    <option value="online">Online</option>
                    {locationOptions.map((l) => (
                      l !== "online" && <option key={l} value={l}>{l || "Unknown"}</option>
                    ))}
                  </select>
                </div>

                {/* Time Range Dropdown */}
                <div className="flex-1 min-w-0">
                  <label className="form-label">Time Range</label>
                  <select 
                    value={timeRange} 
                    onChange={(e) => setTimeRange(e.target.value)} 
                    className="form-select"
                  >
                    <option value="Today">Today</option>
                    <option value="Yesterday">Yesterday</option>
                    <option value="Last 7 days">Last 7 days</option>
                    <option value="Last 14 days">Last 14 days</option>
                    <option value="Last 30 days">Last 30 days</option>
                    <option value="Last 90 days">Last 90 days</option>
                    <option value="This week">This week</option>
                    <option value="This month">This month</option>
                    <option value="This year">This year</option>
                    <option value="Last week">Last week</option>
                    <option value="Last month">Last month</option>
                    <option value="Last year">Last year</option>
                  </select>
                </div>
              </div>

              {/* Second row: Period Buttons */}
              <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                <label className="form-label mb-0">Period:</label>
                <div className="flex gap-1 md:gap-2 flex-wrap">
                  {["MONTH", "WEEK", "DAY", "HOURLY"].map((p) => (
                    <button
                      key={p}
                      onClick={() => setPeriod(p)}
                      className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-xs font-medium transition-all active:scale-95 ${
                        period === p 
                          ? "bg-cyan-600 text-white shadow-md" 
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* SUMMARY CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 mb-6 md:mb-8">
          <Card 
            title="Total Sales" 
            value={formatCurrency(summary?.totalSales || 0)}
            icon=""
            color="blue"
          />
          <Card 
            title="Transactions" 
            value={summary?.totalTransactions || 0}
            icon=""
            color="green"
          />
          <Card 
            title="Gross Profit" 
            value={formatCurrency(summary?.grossProfit || 0)}
            icon=""
            color="purple"
          />
          <Card 
            title="Gross Margin" 
            value={`${Math.round(summary?.grossMargin || 0)}%`}
            icon=""
            color="orange"
          />
        </div>

        {/* SALES LINE CHART */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Sales Trend</h2>
          <div className="h-[400px]">
            <Line
              data={{
                labels: dates || [],
                datasets: [
                  {
                    label: "Sales",
                    data: salesData || [],
                    borderColor: "#06B6D4",
                    backgroundColor: "rgba(8,145,178,0.1)",
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: "#06B6D4",
                    pointBorderColor: "#fff",
                    pointBorderWidth: 2,
                  },
                  {
                    label: "Transactions",
                    data: transactionQty || [],
                    borderColor: "#F97316",
                    borderWidth: 2,
                    yAxisID: "y1",
                    fill: false,
                    tension: 0.4,
                    pointRadius: 3,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    display: true,
                    position: "top",
                    labels: {
                      usePointStyle: true,
                      padding: 20,
                      font: { size: 12, weight: "500" },
                    },
                  },
                },
                scales: {
                  y: { 
                    beginAtZero: true,
                    title: { display: true, text: "Sales" },
                    ticks: {
                      callback: (value) => formatCurrency(Number(value || 0)),
                    },
                  },
                  y1: { 
                    position: "right", 
                    beginAtZero: true,
                    title: { display: true, text: "Transaction Count" },
                  },
                },
              }}
            />
          </div>
        </div>

        {/* LOWER CHARTS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          <PieChart title="Tender Split" data={salesByTender || {}} />
          <BarChart title="Sales by Location" data={salesByLocation || {}} borderRadius={1} />
          <div className="content-card">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Top Products</h3>
              <p className="text-sm text-gray-500">Based on completed transactions in the selected range.</p>
            </div>
            <div className="h-[250px] md:h-[300px]">
              <Bar
                data={{
                  labels: (bestSellingProducts || []).map((p) => p[0] || "Unknown"),
                  datasets: [
                    {
                      label: "Units Sold",
                      data: (bestSellingProducts || []).map((p) => p[1]),
                      backgroundColor: [
                        "#3b82f6",
                        "#10b981",
                        "#f59e0b",
                        "#ef4444",
                        "#8b5cf6",
                      ],
                      borderRadius: 4,
                      borderSkipped: false,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  indexAxis: "y",
                  plugins: {
                    legend: { display: false },
                  },
                  scales: {
                    x: { beginAtZero: true },
                  },
                }}
              />
            </div>
          </div>
        </div>

        {/* HOURLY SALES CHART (collapsible) */}
        <div className="bg-white rounded-lg shadow-lg mt-6 md:mt-8 overflow-hidden">
          <button
            onClick={() => setShowHourlyChart(!showHourlyChart)}
            className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
          >
            <div>
              <h2 className="text-xl font-bold text-gray-900">Hourly Sales Distribution</h2>
              <p className="text-sm text-gray-500 mt-0.5">Sales broken down by hour of day across the selected period</p>
            </div>
            {showHourlyChart ? <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />}
          </button>
          {showHourlyChart && (
            <div className="px-6 pb-6">
              <div className="h-[320px]">
                <Bar
                  data={{
                    labels: HOUR_LABELS,
                    datasets: [
                      {
                        label: "Sales",
                        data: hourlyOfDay,
                        backgroundColor: hourlyOfDay.map((v) =>
                          v === Math.max(...hourlyOfDay) ? "#0891b2" : "rgba(8,145,178,0.45)"
                        ),
                        borderRadius: 1,
                        borderSkipped: false,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        callbacks: {
                          label: (ctx) => ` ${formatCurrency(ctx.parsed.y)}`,
                        },
                      },
                    },
                    scales: {
                      x: {
                        title: { display: true, text: "Hour of Day", font: { size: 12 } },
                        grid: { display: false },
                      },
                      y: {
                        beginAtZero: true,
                        title: { display: true, text: "Sales", font: { size: 12 } },
                        ticks: { callback: (v) => formatCurrency(Number(v || 0)) },
                      },
                    },
                  }}
                />
              </div>
              {/* Peak hour callout */}
              {Math.max(...hourlyOfDay) > 0 && (() => {
                const peakHour = hourlyOfDay.indexOf(Math.max(...hourlyOfDay));
                return (
                  <p className="mt-3 text-sm text-gray-500 text-center">
                    Peak hour: <span className="font-semibold text-cyan-700">{HOUR_LABELS[peakHour]}</span>
                    {" — "}{formatCurrency(hourlyOfDay[peakHour])} in sales
                  </p>
                );
              })()}
            </div>
          )}
        </div>

        {/* TIME PERIOD COMPARISON (collapsible) */}
        <div className="bg-white rounded-lg shadow-lg mt-6 md:mt-8 overflow-hidden">
          <button
            onClick={() => setShowComparison(!showComparison)}
            className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
          >
            <div>
              <h2 className="text-xl font-bold text-gray-900">Time Period Comparison</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {getComparisonLabels(timeRange).current} vs {getComparisonLabels(timeRange).previous}
              </p>
            </div>
            {showComparison ? <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />}
          </button>
          {showComparison && (() => {
            const cmpLabels = getComparisonLabels(timeRange);
            const currTotal = summary?.totalSales || 0;
            const diffVal = currTotal - prevTotalSales;
            const diffPct = prevTotalSales > 0 ? ((diffVal / prevTotalSales) * 100).toFixed(1) : null;
            const relativeLabels = dates.map((_, i) => `Point ${i + 1}`);
            return (
              <div className="px-6 pb-6">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                  <div className="bg-sky-50 border border-sky-200 rounded-xl p-4">
                    <p className="text-xs font-medium text-sky-600 mb-1">{cmpLabels.current}</p>
                    <p className="text-xl font-bold text-sky-800">{formatCurrency(currTotal)}</p>
                    <p className="text-xs text-sky-500 mt-1">{summary?.totalTransactions || 0} transactions</p>
                  </div>
                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                    <p className="text-xs font-medium text-purple-600 mb-1">{cmpLabels.previous}</p>
                    <p className="text-xl font-bold text-purple-800">{formatCurrency(prevTotalSales)}</p>
                    <p className="text-xs text-purple-500 mt-1">{prevTotalTransactions} transactions</p>
                  </div>
                  <div className={`border rounded-xl p-4 ${diffVal >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
                    <p className={`text-xs font-medium mb-1 ${diffVal >= 0 ? "text-emerald-600" : "text-red-500"}`}>Difference</p>
                    <p className={`text-xl font-bold ${diffVal >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {diffVal >= 0 ? "+" : ""}{formatCurrency(diffVal)}
                    </p>
                  </div>
                  <div className={`border rounded-xl p-4 ${diffVal >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
                    <p className={`text-xs font-medium mb-1 ${diffVal >= 0 ? "text-emerald-600" : "text-red-500"}`}>Change</p>
                    <p className={`text-xl font-bold ${diffVal >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {diffPct !== null ? `${diffVal >= 0 ? "+" : ""}${diffPct}%` : "N/A"}
                    </p>
                  </div>
                </div>
                {/* Comparison Line Chart */}
                <div className="h-[320px]">
                  <Line
                    data={{
                      labels: relativeLabels,
                      datasets: [
                        {
                          label: cmpLabels.current,
                          data: salesData,
                          borderColor: "#0ea5e9",
                          backgroundColor: "rgba(14,165,233,0.1)",
                          fill: true,
                          tension: 0.4,
                          pointRadius: dates.length <= 31 ? 4 : 2,
                          borderWidth: 2,
                        },
                        {
                          label: cmpLabels.previous,
                          data: comparisonSalesData,
                          borderColor: "#8b5cf6",
                          backgroundColor: "rgba(139,92,246,0.08)",
                          fill: true,
                          tension: 0.4,
                          pointRadius: dates.length <= 31 ? 4 : 2,
                          borderWidth: 2,
                          borderDash: [5, 3],
                        },
                      ],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: "top",
                          labels: { usePointStyle: true, padding: 20, font: { size: 12 } },
                        },
                        tooltip: {
                          callbacks: {
                            label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`,
                            title: (items) => {
                              const i = items[0].dataIndex;
                              const currDate = dates[i] || `Point ${i + 1}`;
                              return currDate;
                            },
                          },
                        },
                      },
                      scales: {
                        y: {
                          beginAtZero: true,
                          ticks: { callback: (v) => formatCurrency(Number(v || 0)) },
                        },
                        x: { grid: { display: false } },
                      },
                    }}
                  />
                </div>
                {/* Comparison Table */}
                {dates.length > 0 && (
                  <div className="mt-6 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-sky-600 uppercase">{cmpLabels.current}</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-purple-600 uppercase">{cmpLabels.previous}</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Δ Change</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {dates.map((date, i) => {
                          const v1 = salesData[i] || 0;
                          const v2 = comparisonSalesData[i] || 0;
                          const d = v1 - v2;
                          const pct = v2 > 0 ? ((d / v2) * 100).toFixed(1) : null;
                          return (
                            <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                              <td className="px-3 py-2 font-medium text-gray-700">{date}</td>
                              <td className="px-3 py-2 text-right text-gray-800">{formatCurrency(v1)}</td>
                              <td className="px-3 py-2 text-right text-gray-600">{formatCurrency(v2)}</td>
                              <td className={`px-3 py-2 text-right font-medium ${d >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                {d >= 0 ? "+" : ""}{formatCurrency(d)}
                                {pct !== null && <span className="ml-1 text-xs opacity-75">({d >= 0 ? "+" : ""}{pct}%)</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
      </div>
    </Layout>
  );
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0) return "12 AM";
  if (i < 12) return `${i} AM`;
  if (i === 12) return "12 PM";
  return `${i - 12} PM`;
});

function getComparisonLabels(timeRange) {
  const map = {
    "Today": { current: "Today", previous: "Yesterday" },
    "Yesterday": { current: "Yesterday", previous: "Day Before" },
    "Last 7 days": { current: "Last 7 Days", previous: "Prev 7 Days" },
    "Last 14 days": { current: "Last 14 Days", previous: "Prev 14 Days" },
    "Last 30 days": { current: "Last 30 Days", previous: "Prev 30 Days" },
    "Last 90 days": { current: "Last 90 Days", previous: "Prev 90 Days" },
    "This week": { current: "This Week", previous: "Last Week" },
    "This month": { current: "This Month", previous: "Last Month" },
    "This year": { current: "This Year", previous: "Last Year" },
    "Last week": { current: "Last Week", previous: "Week Before Last" },
    "Last month": { current: "Last Month", previous: "Month Before Last" },
    "Last year": { current: "Last Year", previous: "Year Before Last" },
  };
  return map[timeRange] || { current: "Current Period", previous: "Previous Period" };
}

function Card({ title, value, icon, color }) {
  const colorClass = {
    blue: "border-l-4 border-sky-600",
    green: "border-l-4 border-emerald-600",
    purple: "border-l-4 border-purple-600",
    orange: "border-l-4 border-orange-600",
  }[color] || "border-l-4 border-gray-600";

  return (
    <div className={`stat-card ${colorClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="stat-card-label">{title}</p>
          <p className="stat-card-value break-words">{value}</p>
        </div>
        <div className="text-2xl md:text-3xl opacity-40 flex-shrink-0">{icon}</div>
      </div>
    </div>
  );
}

function PieChart({ title, data }) {
  let labels = Object.keys(data || {}).filter(Boolean);
  let values = labels.map(l => data[l] || 0);

  // Format labels for display
  const displayLabels = labels.map(l => {
    if (l === "online" || l === "web") return " Web Payment";
    if (l === "cash") return " Cash";
    if (l === "card") return " Card";
    if (l === "transfer") return " Transfer";
    return l.charAt(0).toUpperCase() + l.slice(1);
  });

  return (
    <div className="content-card">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      <div className="h-[250px] md:h-[300px]">
        <Pie 
          data={{ 
            labels: displayLabels.length > 0 ? displayLabels : ["No Data"], 
            datasets: [{ 
              data: values.length > 0 ? values : [1],
              backgroundColor: [
                "#0891B2",
                "#10b981",
                "#f59e0b",
                "#ef4444",
                "#8b5cf6",
                "#ec4899",
              ],
              borderColor: "#fff",
              borderWidth: 2,
            }] 
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: "bottom",
                labels: { padding: 15, font: { size: 11 } },
              },
            },
          }}
        />
      </div>
    </div>
  );
}

function BarChart({ title, data }) {
  let labels = Object.keys(data || {}).filter(Boolean);

  // Sort labels: online first, then others alphabetically
  labels = labels.sort((a, b) => {
    if (a === "online") return -1;
    if (b === "online") return 1;
    return a.localeCompare(b);
  });

  // Format labels for display (capitalize first letter, add emoji for online)
  const displayLabels = labels.map(l => {
    if (l === "online") return " Online";
    return l.charAt(0).toUpperCase() + l.slice(1);
  });

  // Reorder values to match sorted labels
  const sortedValues = labels.map(l => data[l] || 0);

  return (
    <div className="content-card">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      <div className="h-[250px] md:h-[300px]">
        <Bar 
          data={{ 
            labels: displayLabels.length > 0 ? displayLabels : ["No Data"], 
            datasets: [{ 
              label: "Sales",
              data: sortedValues.length > 0 ? sortedValues : [0],
              backgroundColor: "#06B6D4",
              borderRadius: 8,
              borderSkipped: false,
            }] 
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: true, position: "top" },
            },
            scales: {
              y: {
                beginAtZero: true,
                ticks: {
                  callback: (value) => formatCurrency(Number(value || 0)),
                },
              },
            },
          }}
        />
      </div>
    </div>
  );
}

