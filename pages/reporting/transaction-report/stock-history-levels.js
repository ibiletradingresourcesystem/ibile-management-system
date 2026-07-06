import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import { formatCurrency } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";

const PERIODS = [
  { value: "monthly", label: "Monthly" },
  { value: "daily", label: "Daily" },
  { value: "hourly", label: "Hourly" },
  { value: "half-hourly", label: "Half hourly" },
];

const PAGE_SIZE = 50;

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getInitialRange() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  return { startDate: formatDateKey(start), endDate: formatDateKey(today) };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatQty(value) {
  return Number(value || 0).toLocaleString("en-NG", { maximumFractionDigits: 4 });
}

export default function StockHistoryLevelsReport() {
  const initialRange = useMemo(() => getInitialRange(), []);
  const [filters, setFilters] = useState({
    period: "daily",
    startDate: initialRange.startDate,
    endDate: initialRange.endDate,
    location: "",
    category: "",
    productId: "",
    search: "",
  });
  const [report, setReport] = useState({ rows: [], summary: {}, products: [], categories: [], locations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const fetchReport = async () => {
    setLoading(true);
    setError("");
    setVisibleCount(PAGE_SIZE);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== "" && value !== null && value !== undefined) params.set(key, value);
      });

      const response = await fetch(`/api/reporting/stock-history-levels?${params.toString()}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Unable to load stock history report");
      }
      setReport(data);
    } catch (err) {
      console.error("Stock history report error:", err);
      setError(err.message || "Unable to load stock history report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  const updateFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const applyQuickRange = (range) => {
    const today = new Date();
    let start = new Date(today);
    let end = new Date(today);

    if (range === "today") {
      start = new Date(today);
    } else if (range === "this-month") {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (range === "last-month") {
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (range === "last-7") {
      start = new Date(today);
      start.setDate(start.getDate() - 6);
    } else if (range === "last-30") {
      start = new Date(today);
      start.setDate(start.getDate() - 29);
    }

    setFilters((prev) => ({ ...prev, startDate: formatDateKey(start), endDate: formatDateKey(end) }));
  };

  const exportCsv = () => {
    const headers = [
      "Period",
      "Product",
      "Category",
      "Location",
      "Opening Stock",
      "Stock In",
      "Stock Out",
      "Paid Units Sold",
      "Credit Units Sold",
      "Refunded Units",
      "Adjustments/Loss",
      "Closing Stock",
      "Opening Cost Value",
      "Closing Cost Value",
      "Opening Sale Value",
      "Closing Sale Value",
    ];
    const rows = (report.rows || []).map((row) => [
      row.periodLabel,
      row.productName,
      row.category,
      row.location,
      row.openingStock,
      row.stockIn,
      row.stockOut,
      row.paidUnitsSold,
      row.creditUnitsSold,
      row.refundedUnits,
      row.adjustments,
      row.closingStock,
      row.openingCostValue,
      row.closingCostValue,
      row.openingSaleValue,
      row.closingSaleValue,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `stock-history-levels-${filters.startDate}-to-${filters.endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const summary = report.summary || {};

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content space-y-6">
          <div className="page-header">
            <h1 className="page-title">Stock History / Levels</h1>
            <p className="page-subtitle">Review opening and closing stock movements by month, day, hour, or half-hour.</p>
          </div>

          <div className="content-card space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Period</label>
                <select
                  value={filters.period}
                  onChange={(event) => updateFilter("period", event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  {PERIODS.map((period) => (
                    <option key={period.value} value={period.value}>{period.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Start Date</label>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(event) => updateFilter("startDate", event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">End Date</label>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(event) => updateFilter("endDate", event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div className="flex items-end gap-2">
                <button
                  onClick={fetchReport}
                  className="btn-action-primary w-full flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Apply
                </button>
                <button
                  onClick={exportCsv}
                  disabled={!report.rows?.length}
                  className="btn-action-secondary min-w-[180px] flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
                >
                  <Download className="w-4 h-4" /> Download Stock Levels
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                ["today", "Today"],
                ["last-7", "Last 7 days"],
                ["this-month", "This month"],
                ["last-month", "Last month"],
                ["last-30", "Last 30 days"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => applyQuickRange(key)}
                  className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-gray-100 hover:bg-blue-50 hover:text-blue-700 border border-gray-200"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Location</label>
                <select
                  value={filters.location}
                  onChange={(event) => updateFilter("location", event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">All locations</option>
                  {(report.locations || []).map((location) => (
                    <option key={location} value={location}>{location}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Category</label>
                <select
                  value={filters.category}
                  onChange={(event) => updateFilter("category", event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">All categories</option>
                  {(report.categories || []).map((category) => {
                    const value = typeof category === "string" ? category : category.value;
                    const label = typeof category === "string" ? category : category.label;
                    return <option key={value} value={value}>{label}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Product</label>
                <select
                  value={filters.productId}
                  onChange={(event) => updateFilter("productId", event.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">All products</option>
                  {(report.products || []).map((product) => (
                    <option key={product._id} value={product._id}>{product.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Search</label>
                <input
                  type="search"
                  value={filters.search}
                  onChange={(event) => updateFilter("search", event.target.value)}
                  placeholder="Product or barcode"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="content-card border-l-4 border-blue-500">
              <p className="text-xs font-semibold text-gray-500 uppercase">Opening Stock</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{formatQty(summary.openingStock)}</p>
            </div>
            <div className="content-card border-l-4 border-green-500">
              <p className="text-xs font-semibold text-gray-500 uppercase">Stock In</p>
              <p className="mt-1 text-2xl font-bold text-green-700">{formatQty(summary.stockIn)}</p>
            </div>
            <div className="content-card border-l-4 border-amber-500">
              <p className="text-xs font-semibold text-gray-500 uppercase">Paid / Credit Sold</p>
              <p className="mt-1 text-2xl font-bold text-amber-700">{formatQty(summary.paidUnitsSold)} / {formatQty(summary.creditUnitsSold)}</p>
            </div>
            <div className="content-card border-l-4 border-purple-500">
              <p className="text-xs font-semibold text-gray-500 uppercase">Closing Stock Value</p>
              <p className="mt-1 text-2xl font-bold text-purple-700">{formatCurrency(summary.closingSaleValue || 0)}</p>
            </div>
          </div>

          <div className="content-card overflow-hidden">
            {loading ? (
              <Loader text="Loading stock history..." />
            ) : error ? (
              <div className="p-6 text-red-600 font-semibold">{error}</div>
            ) : !report.rows?.length ? (
              <div className="p-6 text-gray-500">No stock movements found for this filter set.</div>
            ) : (
              <>
              <div className="overflow-x-auto">
                <table className="data-table min-w-[1200px]">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Product</th>
                      <th>Category</th>
                      <th className="text-right">Opening</th>
                      <th className="text-right">In</th>
                      <th className="text-right">Out</th>
                      <th className="text-right">Paid Sold</th>
                      <th className="text-right">Credit Sold</th>
                      <th className="text-right">Refunded</th>
                      <th className="text-right">Adjust/Loss</th>
                      <th className="text-right">Closing</th>
                      <th className="text-right">Closing Cost</th>
                      <th className="text-right">Closing Sale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.slice(0, visibleCount).map((row) => (
                      <tr key={row.key}>
                        <td className="font-semibold text-gray-700">{row.periodLabel}</td>
                        <td>
                          <div className="font-semibold text-gray-900">{row.productName}</div>
                          {row.barcode && <div className="text-xs text-gray-500">{row.barcode}</div>}
                        </td>
                        <td>{row.category}</td>
                        <td className="text-right">{formatQty(row.openingStock)}</td>
                        <td className="text-right text-green-700 font-semibold">{formatQty(row.stockIn)}</td>
                        <td className="text-right text-red-700 font-semibold">{formatQty(row.stockOut)}</td>
                        <td className="text-right">{formatQty(row.paidUnitsSold)}</td>
                        <td className="text-right text-amber-700 font-semibold">{formatQty(row.creditUnitsSold)}</td>
                        <td className="text-right">{formatQty(row.refundedUnits)}</td>
                        <td className="text-right">{formatQty(row.adjustments)}</td>
                        <td className="text-right font-bold text-gray-900">{formatQty(row.closingStock)}</td>
                        <td className="text-right">{formatCurrency(row.closingCostValue || 0)}</td>
                        <td className="text-right font-semibold text-purple-700">{formatCurrency(row.closingSaleValue || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Load More + row count */}
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
                <p className="text-sm text-gray-600">
                  Showing <span className="font-semibold">{Math.min(visibleCount, report.rows.length)}</span> of <span className="font-semibold">{report.rows.length}</span> rows
                </p>
                {visibleCount < report.rows.length && (
                  <button
                    onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                    className="btn-action btn-action-primary min-w-[160px]"
                  >
                    Load More
                  </button>
                )}
              </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}