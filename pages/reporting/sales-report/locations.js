import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import useProgress from "@/lib/useProgress";
import { formatCurrency, formatNumber } from "@/lib/format";
import { isInTimeRange } from "@/lib/dateFilter";
import {
  getReportLocation,
  getTransactionItemQuantity,
  getTransactionNetSales,
  isCompletedSale,
} from "@/lib/sales-report-utils";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Pie, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, BarElement, Title,
} from "chart.js";

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title);

function MetricCard({ title, value, icon, color }) {
  const colors = {
    sky: "bg-sky-50 border-sky-200 text-sky-700",
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

export default function LocationsSales() {
  const [data, setData] = useState(null);
  const [allLocations, setAllLocations] = useState([]);
  const [timeRange, setTimeRange] = useState("last7");
  const [location, setLocation] = useState("All");
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();

  useEffect(() => { fetchAllLocations(); }, []);
  useEffect(() => { fetchData(); }, [timeRange, location]);

  async function fetchAllLocations() {
    try {
      const res = await fetch("/api/transactions/transactions");
      const txRes = await res.json();
      if (txRes.success && txRes.transactions) {
        const locSet = new Set();
        txRes.transactions.forEach((tx) => {
          const txLocation = getReportLocation(tx);
          if (txLocation && txLocation !== "online") locSet.add(txLocation);
        });
        locSet.add("online");
        setAllLocations(Array.from(locSet).sort((a, b) => a === "online" ? -1 : b === "online" ? 1 : a.localeCompare(b)));
      }
    } catch (err) { console.error("Error fetching locations:", err); }
  }

  async function fetchData() {
    try {
      setLoading(true);
      start();
      onFetch();
      const res = await fetch("/api/transactions/transactions");
      const txRes = await res.json();
      if (!txRes.success || !txRes.transactions) { setData(null); setLoading(false); return; }

      const filteredTx = txRes.transactions.filter((tx) => {
        onProcess();
        return isCompletedSale(tx)
          && isInTimeRange(tx.createdAt, timeRange)
          && (location === "All" || getReportLocation(tx) === location);
      });

      const locMap = {};
      filteredTx.forEach((tx) => {
        const loc = getReportLocation(tx);
        if (!locMap[loc]) locMap[loc] = { name: loc, totalSales: 0, transactionCount: 0, itemCount: 0 };
        locMap[loc].totalSales += getTransactionNetSales(tx);
        locMap[loc].transactionCount += 1;
        locMap[loc].itemCount += getTransactionItemQuantity(tx);
      });

      const locationData = Object.values(locMap).sort((a, b) => b.totalSales - a.totalSales);
      setData({
        locations: locationData,
        totalSales: locationData.reduce((s, l) => s + l.totalSales, 0),
        totalTransactions: locationData.reduce((s, l) => s + l.transactionCount, 0),
        totalItems: locationData.reduce((s, l) => s + l.itemCount, 0),
        avgPerLocation: locationData.length > 0 ? locationData.reduce((s, l) => s + l.totalSales, 0) / locationData.length : 0,
      });
    } catch (err) { console.error("Error fetching data:", err); }
    finally { complete(); setLoading(false); }
  }

  const chartColors = [
    "#0ea5e9", "#10b981", "#f59e0b", "#8b5cf6",
    "#ef4444", "#06b6d4", "#ec4899", "#14b8a6",
  ];

  const pieData = data ? {
    labels: data.locations.map((l) => l.name),
    datasets: [{
      data: data.locations.map((l) => l.transactionCount),
      backgroundColor: chartColors.slice(0, data.locations.length),
      borderWidth: 2, borderColor: "#fff",
    }],
  } : null;

  const barData = data ? {
    labels: data.locations.map((l) => l.name),
    datasets: [{
      label: "Sales Value",
      data: data.locations.map((l) => l.totalSales),
      backgroundColor: chartColors.slice(0, data.locations.length),
      borderRadius: { topLeft: 3, topRight: 3, bottomLeft: 0, bottomRight: 0 },
      borderSkipped: "bottom",
    }],
  } : null;

  return (
    <Layout title="Sales By Location">
      <div className="page-container">
        <div className="page-content">
          {/* Breadcrumb */}
          <div className="mb-6 text-sm text-gray-600">
            <Link href="/" className="text-cyan-600 hover:text-cyan-700">Home</Link>
            <span className="mx-2 text-gray-400">{">"}</span>
            <Link href="/reporting" className="text-cyan-600 hover:text-cyan-700">Reporting</Link>
            <span className="mx-2 text-gray-400">{">"}</span>
            <span className="text-gray-800 font-medium">Locations</span>
          </div>

          <div className="page-header">
            <h1 className="page-title">Sales By Location</h1>
            <p className="page-subtitle">Location performance breakdown</p>
          </div>

          {/* Filters */}
          <div className="content-card mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Show data from</label>
                <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="form-select">
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="last7">Last 7 days</option>
                  <option value="last14">Last 14 days</option>
                  <option value="last30">Last 30 days</option>
                  <option value="last60">Last 60 days</option>
                  <option value="last90">Last 90 days</option>
                  <option value="thisWeek">This Week</option>
                  <option value="lastWeek">Last Week</option>
                  <option value="thisMonth">This Month</option>
                  <option value="lastMonth">Last Month</option>
                  <option value="thisYear">This Year</option>
                  <option value="lastYear">Last Year</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
                <select value={location} onChange={(e) => setLocation(e.target.value)} className="form-select">
                  <option value="All">All Locations</option>
                  {allLocations.map((l) => (<option key={l} value={l}>{l}</option>))}
                </select>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="content-card">
              <Loader size="md" text="Loading location data..." progress={progress} />
            </div>
          ) : data ? (
            <>
              {/* Metric Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <MetricCard title="Total Sales" value={formatCurrency(data.totalSales)} icon="💰" color="sky" />
                <MetricCard title="Total Transactions" value={formatNumber(data.totalTransactions)} icon="🧾" color="emerald" />
                <MetricCard title="Total Items Sold" value={formatNumber(data.totalItems)} icon="📦" color="amber" />
                <MetricCard title="Avg Per Location" value={formatCurrency(data.avgPerLocation)} icon="📍" color="purple" />
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="content-card">
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">Sales Distribution</h3>
                  <p className="text-sm text-gray-500 mb-4">Transaction count by location.</p>
                  <div className="flex justify-center" style={{ maxHeight: "320px" }}>
                    {pieData && <Pie data={pieData} options={{ responsive: true, maintainAspectRatio: true, plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: (context) => `${context.label}: ${formatNumber(context.raw || 0)} transactions` } } } }} />}
                  </div>
                </div>
                <div className="content-card">
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">Sales by Location</h3>
                  <p className="text-sm text-gray-500 mb-4">Value volume by total sales.</p>
                  <div style={{ maxHeight: "320px" }}>
                    {barData && <Bar data={barData} options={{ responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => formatCurrency(context.raw || 0) } } }, scales: { y: { beginAtZero: true } } }} />}
                  </div>
                </div>
              </div>

              {/* Rank Table */}
              <div className="data-table-container">
                <table className="data-table">
                  <thead className="sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Rank</th>
                      <th className="px-4 py-3 text-left font-semibold">Location</th>
                      <th className="px-4 py-3 text-right font-semibold">Transactions</th>
                      <th className="px-4 py-3 text-right font-semibold">Items Sold</th>
                      <th className="px-4 py-3 text-right font-semibold">Total Sales</th>
                      <th className="px-4 py-3 text-right font-semibold">% of Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {data.locations.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                        <p className="text-lg font-medium">No location data found</p>
                        <p className="text-sm mt-1">Try adjusting your filters</p>
                      </td></tr>
                    ) : data.locations.map((loc, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="px-4 py-3 font-medium text-gray-800">#{idx + 1}</td>
                        <td className="px-4 py-3 font-medium text-gray-800">{loc.name}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(loc.transactionCount)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(loc.itemCount)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(loc.totalSales)}</td>
                        <td className="px-4 py-3 text-right">
                          {data.totalSales > 0 ? ((loc.totalSales / data.totalSales) * 100).toFixed(1) : "0.0"}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="content-card text-center text-gray-500 py-12">No data available for the selected filters.</div>
          )}
        </div>
      </div>
    </Layout>
  );
}

