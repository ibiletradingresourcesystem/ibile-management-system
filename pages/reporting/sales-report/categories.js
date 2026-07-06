import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import { isInTimeRange, REPORT_TIME_ZONE } from "@/lib/dateFilter";
import useProgress from "@/lib/useProgress";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  getAllocatedLineItems,
  getReportDevice,
  getReportLocation,
  getReportStaffName,
  isCompletedSale,
} from "@/lib/sales-report-utils";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bar, Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

export default function CategoriesSales() {
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [timeRange, setTimeRange] = useState("last30");
  const [location, setLocation] = useState("All");
  const [device, setDevice] = useState("All");
  const [staff, setStaff] = useState("All");
  const [allLocations, setAllLocations] = useState([]);
  const [allStaff, setAllStaff] = useState([]);

  function normalizeId(id) {
    if (!id) return '';
    return (id.toString ? id.toString() : String(id)).trim().toLowerCase();
  }

  function getProductCategory(productId, productMap) {
    if (!productId) return "Uncategorized";
    const nId = normalizeId(productId);
    if (productMap[nId]) return productMap[nId].category;
    for (const [key, prod] of Object.entries(productMap)) {
      if (normalizeId(key) === nId) return prod.category;
    }
    return "Uncategorized";
  }

  useEffect(() => { fetchAllFilters(); }, []);
  useEffect(() => { fetchCategoryData(); }, [timeRange, location, device, staff]);

  async function fetchAllFilters() {
    try {
      const res = await fetch("/api/transactions/transactions");
      const data = await res.json();
      const txs = data.transactions || [];
      const locSet = new Set();
      const staffSet = new Set();
      txs.forEach((tx) => {
        const txLocation = getReportLocation(tx);
        const txStaff = getReportStaffName(tx);
        if (txLocation) locSet.add(txLocation);
        if (txStaff) staffSet.add(txStaff);
      });
      setAllLocations(Array.from(locSet).sort());
      setAllStaff(Array.from(staffSet).sort());
    } catch (err) { console.error(err); }
  }

  async function fetchCategoryData() {
    try {
      setLoading(true);
      start();
      onFetch();
      const [transRes, prodRes, catRes] = await Promise.all([
        fetch("/api/transactions/transactions"),
        fetch("/api/products"),
        fetch("/api/categories"),
      ]);
      const transData = await transRes.json();
      const prodData = await prodRes.json();
      const catData = await catRes.json();

      onProcess();
      let allTx = transData.transactions || [];
      const products = prodData.data || prodData || [];
      const catsRaw = catData.data || catData || [];

      const categoryNameMap = {};
      (Array.isArray(catsRaw) ? catsRaw : []).forEach((cat) => {
        if (cat?._id) categoryNameMap[normalizeId(cat._id)] = cat.name || "Unknown";
      });

      const productMap = {};
      (Array.isArray(products) ? products : []).forEach((prod) => {
        if (!prod?._id) return;
        let category = "Top Level";
        if (prod.category) {
          const catId = normalizeId(prod.category);
          category = categoryNameMap[catId] || String(prod.category) || "Top Level";
        }
        productMap[normalizeId(prod._id)] = { name: prod.name, category, salePriceIncTax: prod.salePriceIncTax || 0 };
      });

      allTx = allTx.filter((tx) => {
        if (!isCompletedSale(tx)) return false;
        if (location !== "All" && getReportLocation(tx) !== location) return false;
        if (device !== "All" && getReportDevice(tx) !== device) return false;
        if (staff !== "All" && getReportStaffName(tx) !== staff) return false;
        return isInTimeRange(tx.createdAt, timeRange);
      });

      const txWithCats = allTx.map((tx) => {
        const breakdown = {};
        let total = 0;
        getAllocatedLineItems(tx).forEach(({ item, quantity, netLineTotal }) => {
          const cat = getProductCategory(item.productId, productMap);
          if (!breakdown[cat]) breakdown[cat] = { category: cat, units: 0, sales: 0 };
          breakdown[cat].units += quantity;
          breakdown[cat].sales += netLineTotal;
          total += netLineTotal;
        });
        return {
          id: tx._id,
          createdAt: tx.createdAt,
          date: new Date(tx.createdAt).toLocaleDateString("en-NG", { timeZone: REPORT_TIME_ZONE }),
          time: new Date(tx.createdAt).toLocaleTimeString("en-NG", { timeZone: REPORT_TIME_ZONE }),
          staff: getReportStaffName(tx),
          location: getReportLocation(tx),
          device: getReportDevice(tx),
          total,
          categories: Object.values(breakdown),
        };
      }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      setTransactions(txWithCats);

      const catMap = {};
      allTx.forEach((tx) => {
        getAllocatedLineItems(tx).forEach(({ item, quantity, netLineTotal }) => {
          const cat = getProductCategory(item.productId, productMap);
          if (!catMap[cat]) catMap[cat] = { name: cat, sales: 0, units: 0 };
          catMap[cat].sales += netLineTotal;
          catMap[cat].units += quantity;
        });
      });
      setCategories(Object.values(catMap).sort((a, b) => b.sales - a.sales));
    } catch (err) { console.error(err); }
    finally { complete(); setLoading(false); }
  }

  if (loading) return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          <Loader size="lg" text="Loading category data..." progress={progress} />
        </div>
      </div>
    </Layout>
  );

  const totalSales = categories.reduce((sum, c) => sum + c.sales, 0);
  const topCategory = categories[0];

  return (
    <Layout title="Sales by Categories">
      <div className="page-container">
        <div className="page-content">
          {/* Breadcrumb */}
          <div className="mb-6 text-sm text-gray-600">
            <Link href="/" className="text-cyan-600 hover:text-cyan-700">Home</Link>
            <span className="mx-2 text-gray-400">{">"}</span>
            <Link href="/reporting" className="text-cyan-600 hover:text-cyan-700">Reporting</Link>
            <span className="mx-2 text-gray-400">{">"}</span>
            <span className="text-gray-800 font-medium">Categories</span>
          </div>

          <div className="page-header">
            <h1 className="page-title">Sales by Categories</h1>
            <p className="page-subtitle">Category-wise performance and trends</p>
          </div>

          {/* Filters */}
          <div className="content-card mb-6">
            <h3 className="text-base font-semibold text-gray-800 mb-4">Filters</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Show data from</label>
                <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="form-select">
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="last7">Last 7 Days</option>
                  <option value="last14">Last 14 Days</option>
                  <option value="last30">Last 30 Days</option>
                  <option value="last60">Last 60 Days</option>
                  <option value="last90">Last 90 Days</option>
                  <option value="thisWeek">This Week</option>
                  <option value="thisMonth">This Month</option>
                  <option value="thisYear">This Year</option>
                  <option value="lastWeek">Last Week</option>
                  <option value="lastMonth">Last Month</option>
                  <option value="lastYear">Last Year</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Location</label>
                <select value={location} onChange={(e) => setLocation(e.target.value)} className="form-select">
                  <option value="All">All Locations</option>
                  {allLocations.map((loc) => (<option key={loc} value={loc}>{loc}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Device</label>
                <select value={device} onChange={(e) => setDevice(e.target.value)} className="form-select">
                  <option value="All">All Devices</option>
                  <option value="POS">POS</option>
                  <option value="Mobile">Mobile</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Staff</label>
                <select value={staff} onChange={(e) => setStaff(e.target.value)} className="form-select">
                  <option value="All">All Staff</option>
                  {allStaff.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <MetricCard title="Total Categories" value={categories.length} color="sky" />
            <MetricCard title="Total Sales" value={formatCurrency(totalSales)} color="emerald" />
            <MetricCard title="Top Category" value={topCategory?.name || "N/A"} color="amber" />
            <MetricCard title="Total Units" value={formatNumber(categories.reduce((sum, c) => sum + c.units, 0))} color="purple" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <div className="content-card">
              <h2 className="text-lg font-bold text-gray-800">Sales Distribution by Category</h2>
              <p className="text-sm text-gray-500 mb-4">Count volume by units sold.</p>
              <div className="h-[350px]">
                <Doughnut
                  data={{
                    labels: categories.map((category) => category.name),
                    datasets: [{
                      label: "Units Sold",
                      data: categories.map((category) => category.units),
                      backgroundColor: ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"],
                      borderColor: "#fff",
                      borderWidth: 2,
                    }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        position: "right",
                        labels: { padding: 20 },
                      },
                      tooltip: {
                        callbacks: {
                          label: (context) => `${context.label}: ${formatNumber(context.raw || 0)} units`,
                        },
                      },
                    },
                  }}
                />
              </div>
            </div>

            <div className="content-card">
              <h2 className="text-lg font-bold text-gray-800">Category Sales Comparison</h2>
              <p className="text-sm text-gray-500 mb-4">Value volume by sales amount.</p>
              <div className="h-[350px]">
                <Bar
                  data={{
                    labels: categories.map((category) => category.name),
                    datasets: [{
                      label: "Sales Value",
                      data: categories.map((category) => category.sales),
                      backgroundColor: "#06B6D4",
                      borderRadius: { topLeft: 0, topRight: 3, bottomLeft: 0, bottomRight: 3 },
                      borderSkipped: "start",
                    }],
                  }}
                  options={{
                    indexAxis: "y",
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        callbacks: {
                          label: (context) => formatCurrency(context.raw || 0),
                        },
                      },
                    },
                    scales: { x: { beginAtZero: true } },
                  }}
                />
              </div>
            </div>
          </div>

          {/* Categories Table */}
          <div className="data-table-container mb-6">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead className="sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Rank</th>
                    <th className="px-4 py-3 text-left font-semibold">Category</th>
                    <th className="px-4 py-3 text-right font-semibold">Total Sales</th>
                    <th className="px-4 py-3 text-right font-semibold">Units Sold</th>
                    <th className="px-4 py-3 text-right font-semibold">% of Total</th>
                    <th className="px-4 py-3 text-right font-semibold">Avg/Unit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {categories.map((cat, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      <td className="px-4 py-3 font-bold text-cyan-600">#{idx + 1}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{cat.name}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(cat.sales)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(cat.units || 0)}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{totalSales > 0 ? ((cat.sales / totalSales) * 100).toFixed(1) : 0}%</td>
                      <td className="px-4 py-3 text-right text-gray-600">{cat.units > 0 ? formatCurrency(cat.sales / cat.units) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Transactions by Category */}
          <div className="data-table-container">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="text-lg font-bold text-gray-800">Transaction Sales by Product Categories</h2>
              <p className="text-gray-600 text-sm mt-1">Breakdown of each transaction showing category-wise product sales</p>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead className="sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Date</th>
                    <th className="px-4 py-3 text-left font-semibold">Staff</th>
                    <th className="px-4 py-3 text-left font-semibold">Location</th>
                    <th className="px-4 py-3 text-left font-semibold">Device</th>
                    <th className="px-4 py-3 text-left font-semibold">Categories & Items</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {transactions.length > 0 ? transactions.map((tx, idx) => (
                    <tr key={tx.id} className={idx % 2 === 0 ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{tx.date}</div>
                        <div className="text-xs text-gray-500">{tx.time}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{tx.staff}</td>
                      <td className="px-4 py-3 text-gray-700">{tx.location}</td>
                      <td className="px-4 py-3"><span className={`badge ${tx.device === 'POS' ? 'badge-primary' : 'badge-secondary'}`}>{tx.device}</span></td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          {tx.categories.map((cat, i) => (
                            <div key={i} className="text-xs">
                              <div className="font-semibold text-gray-800">{cat.category}</div>
                              <div className="text-gray-600">{cat.units} unit{cat.units !== 1 ? 's' : ''} — {formatCurrency(cat.sales)}</div>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-cyan-600">{formatCurrency(tx.total)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan="6" className="px-4 py-8 text-center text-gray-500">No transactions found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function MetricCard({ title, value, color }) {
  const colorMap = {
    sky: "bg-sky-50 border-sky-200 text-sky-700",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    purple: "bg-purple-50 border-purple-200 text-purple-700",
  };
  return (
    <div className={`${colorMap[color] || colorMap.sky} border rounded-xl p-4 shadow-sm`}>
      <p className="text-sm font-semibold opacity-75">{title}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
    </div>
  );
}

