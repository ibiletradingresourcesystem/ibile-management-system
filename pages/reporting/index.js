import Layout from "@/components/Layout";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Line } from "react-chartjs-2";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

export default function Reporting() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState("week");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPeriodData();
  }, [period]);

  async function fetchPeriodData() {
    try {
      setLoading(true);
      const res = await fetch(`/api/reporting/reporting-data?location=All&period=${period}&days=30`);
      setData(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return (
    <Layout>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block">
            <svg className="animate-spin h-12 w-12 text-cyan-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <p className="mt-4 text-gray-600 font-medium">Loading reporting dashboard...</p>
        </div>
      </div>
    </Layout>
  );

  const totalSales = data?.summary?.totalSales || 0;
  const avgDaily = data?.dates?.length > 0 ? totalSales / data.dates.length : 0;

  return (
    <Layout title="Reporting">
      <div className="page-container">
        <div className="page-content">
        <div className="mb-6 text-sm">
          <Link href="/" className="theme-accent-text hover:opacity-80">Home</Link>
          <span className="mx-2 text-gray-400"></span>
          <span className="text-gray-600">Reporting</span>
        </div>

        <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="page-title"> Time Period Analysis</h1>
            <p className="page-subtitle">Sales performance across different time periods</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Link 
              href="/reporting/reporting"
              className="btn-action-primary text-center"
            >
               Sales Report
            </Link>
            <Link 
              href="/reporting/end-of-day-report"
              className="btn-action bg-cyan-600 text-white hover:bg-cyan-700 focus:ring-cyan-400 text-center"
            >
               EOD Reports
            </Link>
          </div>
        </div>

        {/* PERIOD SELECTOR */}
        <div className="content-card mb-6">
          <div className="flex flex-wrap gap-3">
            {["day", "week", "month"].map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`btn-action ${
                  period === p 
                    ? "theme-toggle-active" 
                    : "theme-toggle-neutral"
                }`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* SUMMARY CARDS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <MetricCard title="Total Sales" value={`${(totalSales || 0).toLocaleString('en-NG', {maximumFractionDigits: 0})}`} icon="" color="sky" />
          <MetricCard title="Transactions" value={data?.summary?.totalTransactions || 0} icon="" color="emerald" />
          <MetricCard title="Avg/Period" value={`${(avgDaily).toLocaleString('en-NG', {maximumFractionDigits: 0})}`} icon="" color="amber" />
          <MetricCard title="Periods" value={data?.dates?.length || 0} icon="" color="purple" />
        </div>

        {/* TREND CHART */}
        <div className="content-card">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-4">Period Performance Trend</h2>
          <div className="h-[300px] sm:h-[400px]">
            <Line
              data={{
                labels: data?.dates || [],
                datasets: [{
                  label: "Sales ()",
                  data: data?.salesData || [],
                  borderColor: "#06B6D4",
                  backgroundColor: "rgba(6, 182, 212, 0.1)",
                  borderWidth: 3,
                  fill: true,
                  tension: 0.4,
                  pointRadius: 5,
                }]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true } },
                scales: { y: { beginAtZero: true } },
              }}
            />
          </div>
        </div>
        </div>
      </div>
    </Layout>
  );
}

function MetricCard({ title, value, icon, color }) {
  const colorMap = {
    sky: "theme-note-primary",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    purple: "bg-purple-50 border-purple-200 text-purple-700",
  }[color];

  return (
    <div className={`${colorMap} border-2 rounded-xl p-4 sm:p-6 shadow-sm`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs sm:text-sm font-semibold opacity-75">{title}</p>
          <p className="text-lg sm:text-2xl font-bold mt-1 sm:mt-2">{value}</p>
        </div>
        <div className="text-2xl sm:text-4xl opacity-30">{icon}</div>
      </div>
    </div>
  );
}

