// pages/stock/stock-take-report.js
"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/router";
import Layout from "@/components/Layout";
import { Loader } from "@/components/ui";
import useProgress from "@/lib/useProgress";
import { formatCurrency } from "@/lib/format";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChartBar,
  faDownload,
  faSearch,
  faCalendarAlt,
  faExclamationTriangle,
  faCheckCircle,
  faArrowDown,
  faArrowUp,
  faMinus,
  faEye,
  faBalanceScale,
} from "@fortawesome/free-solid-svg-icons";

const STATUS_COLORS = {
  draft: "bg-gray-100 text-gray-700",
  "in-progress": "theme-badge-soft",
  completed: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

export default function StockTakeReport() {
  const router = useRouter();
  const { progress, start, onFetch, onProcess, complete } = useProgress();

  const [stockTakes, setStockTakes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      start();
      onFetch();
      const params = new URLSearchParams({ limit: "200" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/stock-take?${params}`);
      const data = await res.json();
      onProcess();
      if (data.success) {
        setStockTakes(data.stockTakes || []);
      }
    } catch (err) {
      console.error("Failed to load stock take data", err);
    } finally {
      complete();
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter by date range and search term
  const filteredData = useMemo(() => {
    return stockTakes.filter((st) => {
      if (dateFrom && new Date(st.createdAt) < new Date(dateFrom)) return false;
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        if (new Date(st.createdAt) > endDate) return false;
      }
      if (searchTerm) {
        const t = searchTerm.toLowerCase();
        return (
          st.title?.toLowerCase().includes(t) ||
          st.reference?.toLowerCase().includes(t) ||
          st.locationName?.toLowerCase().includes(t)
        );
      }
      return true;
    });
  }, [stockTakes, dateFrom, dateTo, searchTerm]);

  // Aggregate stats across all filtered data
  const aggregateStats = useMemo(() => {
    const completed = filteredData.filter((st) => ["completed", "approved"].includes(st.status));
    const totalVarianceValue = completed.reduce((s, st) => s + (st.totalVarianceValue || 0), 0);
    const totalPositiveVariance = completed.reduce((s, st) => s + (st.positiveVariance || 0), 0);
    const totalNegativeVariance = completed.reduce((s, st) => s + (st.negativeVariance || 0), 0);
    const avgAccuracy = completed.length
      ? (completed.reduce((s, st) => s + (st.accuracyRate || 0), 0) / completed.length).toFixed(1)
      : 0;
    const totalItemsCounted = completed.reduce((s, st) => s + (st.countedItems || 0), 0);
    const adjustedCount = completed.filter((st) => st.adjustmentApplied).length;

    return {
      totalCount: filteredData.length,
      completedCount: completed.length,
      totalVarianceValue,
      totalPositiveVariance,
      totalNegativeVariance,
      avgAccuracy,
      totalItemsCounted,
      adjustedCount,
    };
  }, [filteredData]);

  // Items with largest discrepancies from all stock takes
  const topDiscrepancies = useMemo(() => {
    const itemMap = new Map();
    filteredData
      .filter((st) => ["completed", "approved"].includes(st.status))
      .forEach((st) => {
        (st.items || []).forEach((item) => {
          if (item.countedQty === null || item.countedQty === undefined) return;
          const key = item.productId?.toString() || item.productName;
          const existing = itemMap.get(key);
          if (!existing || Math.abs(item.variance) > Math.abs(existing.variance)) {
            itemMap.set(key, { ...item, stockTakeRef: st.reference, stockTakeDate: st.createdAt });
          }
        });
      });
    return [...itemMap.values()]
      .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
      .slice(0, 15);
  }, [filteredData]);

  const exportCSV = () => {
    const header = "Reference,Title,Location,Status,Type,Date,Total Items,Counted,Accuracy %,Total Variance,Variance Value,Adjustments Applied\n";
    const rows = filteredData.map((st) =>
      [
        st.reference,
        `"${st.title}"`,
        `"${st.locationName}"`,
        st.status,
        st.type,
        new Date(st.createdAt).toLocaleDateString(),
        st.totalItems,
        st.countedItems,
        st.accuracyRate,
        st.totalVariance,
        st.totalVarianceValue?.toFixed(2),
        st.adjustmentApplied ? "Yes" : "No",
      ].join(",")
    );
    const csv = header + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-take-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader size="lg" text="Loading reports..." progress={progress} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <div>
              <h1 className="page-title">
                Stock Take Report
              </h1>
              <p className="text-sm text-gray-500 mt-1">Analyze inventory reconciliation history and variance trends</p>
            </div>
            <button onClick={exportCSV} className="btn-action flex items-center gap-2 text-sm self-start">
              <FontAwesomeIcon icon={faDownload} className="w-3.5 h-3.5" />
              Export Report
            </button>
          </div>

          {/* Filters */}
          <div className="content-card mb-6">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <FontAwesomeIcon icon={faSearch} className="absolute gap-2 left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search by title, reference, or location..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="form-input pl-10"
                />
              </div>
              <div className="flex gap-2 items-center">
                <FontAwesomeIcon icon={faCalendarAlt} className="text-gray-400 w-4 h-4" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="form-input w-36 text-sm"
                  title="From date"
                />
                <span className="text-gray-400 text-sm">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="form-input w-36 text-sm"
                  title="To date"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="form-select w-full md:w-40"
              >
                <option value="all">All Status</option>
                <option value="completed">Completed</option>
                <option value="approved">Approved</option>
                <option value="in-progress">In Progress</option>
                <option value="draft">Draft</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Aggregate Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="content-card !p-4 text-center">
              <div className="text-2xl font-bold text-gray-900">{aggregateStats.totalCount}</div>
              <div className="text-xs text-gray-500 mt-1">Total Stock Takes</div>
            </div>
            <div className="content-card !p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{aggregateStats.avgAccuracy}%</div>
              <div className="text-xs text-gray-500 mt-1">Avg. Accuracy</div>
            </div>
            <div className="content-card !p-4 text-center">
              <div className={`text-2xl font-bold ${aggregateStats.totalVarianceValue < 0 ? "text-red-600" : aggregateStats.totalVarianceValue > 0 ? "text-green-600" : "text-gray-700"}`}>
                {formatCurrency(Math.abs(aggregateStats.totalVarianceValue))}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Net Variance Value {aggregateStats.totalVarianceValue < 0 ? "(Loss)" : aggregateStats.totalVarianceValue > 0 ? "(Surplus)" : ""}
              </div>
            </div>
            <div className="content-card !p-4 text-center">
              <div className="text-2xl font-bold theme-accent-text">{aggregateStats.adjustedCount}</div>
              <div className="text-xs text-gray-500 mt-1">Adjustments Applied</div>
            </div>
          </div>

          {/* Variance Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="content-card !p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <FontAwesomeIcon icon={faArrowUp} className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <div className="text-lg font-bold text-green-600">+{aggregateStats.totalPositiveVariance}</div>
                <div className="text-xs text-gray-500">Total Surplus (units)</div>
              </div>
            </div>
            <div className="content-card !p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                <FontAwesomeIcon icon={faArrowDown} className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <div className="text-lg font-bold text-red-600">{aggregateStats.totalNegativeVariance}</div>
                <div className="text-xs text-gray-500">Total Shortage (units)</div>
              </div>
            </div>
            <div className="content-card !p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg theme-note-primary flex items-center justify-center">
                <FontAwesomeIcon icon={faBalanceScale} className="w-4 h-4 theme-accent-text" />
              </div>
              <div>
                <div className="text-lg font-bold text-gray-900">{aggregateStats.totalItemsCounted.toLocaleString()}</div>
                <div className="text-xs text-gray-500">Total Items Counted</div>
              </div>
            </div>
          </div>

          {/* Top Discrepancies */}
          {topDiscrepancies.length > 0 && (
            <div className="content-card mb-6">
              <h2 className="font-semibold theme-section-title mb-3 flex items-center gap-2">
                <FontAwesomeIcon icon={faExclamationTriangle} className="w-4 h-4 text-orange-500" />
                Highest Variance Items
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="table-header-gradient">
                    <tr className="text-left">
                      <th className="py-2 px-2 font-semibold text-white">Product</th>
                      <th className="py-2 px-2 font-semibold text-white hidden md:table-cell">Barcode</th>
                      <th className="py-2 px-2 font-semibold text-white text-center">System</th>
                      <th className="py-2 px-2 font-semibold text-white text-center">Counted</th>
                      <th className="py-2 px-2 font-semibold text-white text-center">Variance</th>
                      <th className="py-2 px-2 font-semibold text-white text-right hidden lg:table-cell">Value</th>
                      <th className="py-2 px-2 font-semibold text-white hidden md:table-cell">Stock Take</th>
                      <th className="py-2 px-2 font-semibold text-white hidden md:table-cell">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topDiscrepancies.map((item, i) => (
                      <tr key={i} className={`border-b border-gray-100 ${item.variance < 0 ? "bg-red-50/30" : item.variance > 0 ? "bg-green-50/30" : ""}`}>
                        <td className="py-2 px-2 font-medium text-gray-900">{item.productName}</td>
                        <td className="py-2 px-2 font-mono text-xs text-gray-500 hidden md:table-cell">{item.barcode || "—"}</td>
                        <td className="py-2 px-2 text-center text-gray-700">{item.systemQty}</td>
                        <td className="py-2 px-2 text-center text-gray-700">{item.countedQty}</td>
                        <td className="py-2 px-2 text-center">
                          <span className={`font-bold ${item.variance > 0 ? "text-green-600" : item.variance < 0 ? "text-red-600" : "text-gray-500"}`}>
                            {item.variance > 0 ? "+" : ""}{item.variance}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right hidden lg:table-cell">
                          <span className={item.varianceValue > 0 ? "text-green-600" : item.varianceValue < 0 ? "text-red-600" : ""}>
                            {formatCurrency(Math.abs(item.varianceValue || 0))}
                          </span>
                        </td>
                        <td className="py-2 px-2 hidden md:table-cell">
                          <span className="font-mono text-xs theme-accent-text">{item.stockTakeRef}</span>
                        </td>
                        <td className="py-2 px-2 hidden md:table-cell text-xs text-gray-500">
                          {new Date(item.stockTakeDate).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Stock Take History Table */}
          <div className="content-card">
            <h2 className="font-semibold theme-section-title mb-3">Stock Take History</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="table-header-gradient">
                  <tr className="text-left">
                    <th className="py-2 px-2 font-semibold text-white">Reference</th>
                    <th className="py-2 px-2 font-semibold text-white">Title</th>
                    <th className="py-2 px-2 font-semibold text-white hidden md:table-cell">Location</th>
                    <th className="py-2 px-2 font-semibold text-white text-center">Status</th>
                    <th className="py-2 px-2 font-semibold text-white text-center">Accuracy</th>
                    <th className="py-2 px-2 font-semibold text-white text-center">Items</th>
                    <th className="py-2 px-2 font-semibold text-white text-center">Variance</th>
                    <th className="py-2 px-2 font-semibold text-white text-right hidden lg:table-cell">Variance Value</th>
                    <th className="py-2 px-2 font-semibold text-white">Date</th>
                    <th className="py-2 px-2 font-semibold text-white text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((st) => (
                    <tr key={st._id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="py-2 px-2">
                        <span className="font-mono text-xs theme-accent-text">{st.reference}</span>
                      </td>
                      <td className="py-2 px-2 font-medium text-gray-900">{st.title}</td>
                      <td className="py-2 px-2 text-gray-500 hidden md:table-cell">{st.locationName}</td>
                      <td className="py-2 px-2 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[st.status]}`}>
                          {st.status}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-center">
                        {st.accuracyRate !== null && st.accuracyRate !== undefined ? (
                          <span className={`font-medium ${st.accuracyRate >= 98 ? "text-green-600" : st.accuracyRate >= 95 ? "text-yellow-600" : "text-red-600"}`}>
                            {st.accuracyRate}%
                          </span>
                        ) : "—"}
                      </td>
                      <td className="py-2 px-2 text-center text-gray-700">
                        {st.countedItems}/{st.totalItems}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span className={`font-bold ${st.totalVariance > 0 ? "text-green-600" : st.totalVariance < 0 ? "text-red-600" : "text-gray-500"}`}>
                          {st.totalVariance > 0 ? "+" : ""}{st.totalVariance || 0}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right hidden lg:table-cell">
                        {st.totalVarianceValue ? (
                          <span className={st.totalVarianceValue > 0 ? "text-green-600" : st.totalVarianceValue < 0 ? "text-red-600" : ""}>
                            {formatCurrency(Math.abs(st.totalVarianceValue))}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="py-2 px-2 text-xs text-gray-500">{new Date(st.createdAt).toLocaleDateString()}</td>
                      <td className="py-2 px-2 text-center">
                        <button
                          onClick={() => router.push(`/stock/stock-take/${st._id}`)}
                          className="theme-accent-text p-1 hover:opacity-80"
                          title="View Details"
                        >
                          <FontAwesomeIcon icon={faEye} className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredData.length === 0 && (
                <div className="text-center py-16 text-gray-400">
                  <FontAwesomeIcon icon={faChartBar} className="w-10 h-10 mb-3" />
                  <p>No stock take records found</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
