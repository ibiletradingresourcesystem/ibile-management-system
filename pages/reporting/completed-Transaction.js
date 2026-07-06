// SalesReport.js
import Layout from "@/components/Layout";
import React, { useEffect, useState, useCallback } from "react";
import { saveAs } from "file-saver";
import { formatCurrency, formatNumber } from "@/lib/format";
import { getDateKey, parseDateKey, REPORT_TIME_ZONE } from "@/lib/dateFilter";

export default function SalesReport() {
  const [transactions, setTransactions] = useState([]);
  const [expandedTxId, setExpandedTxId] = useState(null);
  const [locationFilter, setLocationFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("completed");
  const [locations, setLocations] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showBarcode, setShowBarcode] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());

  const fetchTransactions = useCallback(async () => {
  try {
    const res = await fetch("/api/transactions/transactions");
    if (!res.ok) throw new Error("Failed to fetch transactions");
    const data = await res.json();
    let filtered = data.transactions || [];

    // Extract unique locations (now as strings from API)
    const locationSet = new Set();
    filtered.forEach((tx) => {
      if (tx.location) {
        locationSet.add(tx.location);
      }
    });
    // Sort locations: "online" first, then others alphabetically
    const uniqueLocations = Array.from(locationSet)
      .sort((a, b) => {
        if (a === "online") return -1;
        if (b === "online") return 1;
        return a.localeCompare(b);
      })
      .map((name) => ({ id: name, name }));
    setLocations(uniqueLocations);

    // Filter by status
    if (statusFilter) {
      filtered = filtered.filter((tx) => tx.status === statusFilter);
    }

    // Filter by location (location is a string from API)
    if (locationFilter) {
      filtered = filtered.filter((tx) => tx.location === locationFilter);
    }

    // Filter by selected date
    if (selectedDate) {
      const target = parseDateKey(selectedDate);

      if (target) {
        filtered = filtered.filter((tx) => getDateKey(tx.createdAt) === target.key);
      }
    }

    setTransactions(filtered);
  } catch (err) {
    console.error(err);
  }
  }, [locationFilter, statusFilter, selectedDate]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const toggleDetails = (id) => {
    setExpandedTxId(expandedTxId === id ? null : id);
  };

  const exportCSV = () => {
    const headers = [
      "Staff,Location,Device,Date,Customer,Discount,DiscountReason,Total,Tender,Change",
    ];
    const rows = transactions.map((tx) =>
      [
        tx.staff?.name || tx.staff || "N/A",
        tx.location || "N/A",
        tx.device,
        new Date(tx.createdAt).toLocaleString("en-NG", { timeZone: REPORT_TIME_ZONE }),
        tx.customerName || "N/A",
        tx.discount,
        tx.discountReason,
        tx.total,
        tx.tenderType,
        tx.change,
      ].join(",")
    );
    const csv = headers.concat(rows).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    saveAs(blob, "transactions.csv");
  };

  const handlePrint = () => window.print();

  const formatTenderLabel = (value) => {
    if (!value) return "Unknown";
    const cleaned = String(value).replace(/[_-]+/g, " ").trim();
    return cleaned.replace(/\s+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const getTenderBadgeClass = (value) => {
    const normalized = String(value || "").toLowerCase();
    if (normalized.includes("cash")) return "badge-success";
    if (normalized.includes("card") || normalized.includes("pos")) return "badge-primary";
    if (normalized.includes("transfer") || normalized.includes("bank")) return "badge-warning";
    if (normalized.includes("online")) return "badge-secondary";
    return "badge";
  };

  const getTenderDisplay = (tx) => {
    const hasSplit = Array.isArray(tx.tenderPayments) && tx.tenderPayments.length > 1;
    if (hasSplit) {
      const details = tx.tenderPayments
        .map((payment) => {
          const name = formatTenderLabel(payment?.tenderName || payment?.tenderType || "Tender");
          return `${name}: ${formatCurrency(payment?.amount || 0)}`;
        })
        .join(" | ");
      return {
        label: "Split",
        title: details,
        className: "badge-secondary",
      };
    }

    const tenderName =
      Array.isArray(tx.tenderPayments) && tx.tenderPayments.length === 1
        ? tx.tenderPayments[0]?.tenderName || tx.tenderPayments[0]?.tenderType
        : tx.tenderType;

    const label = formatTenderLabel(tenderName || "Unknown");
    return {
      label,
      title: label,
      className: getTenderBadgeClass(tenderName),
    };
  };

  // Calendar utility functions
  const getDaysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  
  const getFirstDayOfMonth = (date) => (new Date(date.getFullYear(), date.getMonth(), 1).getDay() + 6) % 7;

  const getCalendarDays = () => {
    const days = [];
    const daysInMonth = getDaysInMonth(calendarMonth);
    const firstDay = getFirstDayOfMonth(calendarMonth);
    const prevMonthDays = getDaysInMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1));

    // Previous month days (greyed out)
    for (let i = firstDay - 1; i >= 0; i--) {
      days.push({
        day: prevMonthDays - i,
        isCurrentMonth: false,
      });
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        day: i,
        isCurrentMonth: true,
      });
    }

    // Next month days (greyed out)
    const remainingDays = 42 - days.length; // 6 rows x 7 days
    for (let i = 1; i <= remainingDays; i++) {
      days.push({
        day: i,
        isCurrentMonth: false,
      });
    }

    return days;
  };

  const handlePrevMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1));
  };

  const handleNextMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1));
  };

  const formatMonthYear = (date) => {
    return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  const handleDateSelect = (day) => {
    const year = calendarMonth.getFullYear();
    const month = String(calendarMonth.getMonth() + 1).padStart(2, "0");
    const dayStr = String(day).padStart(2, "0");
    setSelectedDate(`${year}-${month}-${dayStr}`);
  };

  return (
    <Layout title="Completed Transactions">
      <div className="page-container">
        <div className="page-content">
          <div className="page-header">
            <h1 className="page-title">Completed Transactions</h1>
            <p className="page-subtitle">View and manage transaction records with advanced filtering</p>
          </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
          {/* Calendar Filter */}
          <div className="content-card h-fit">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={handlePrevMonth}
                  className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                  aria-label="Previous month"
                >
                  <span className="text-lg">{"<"}</span>
                </button>
                <h2 className="text-sm font-semibold text-gray-800">
                  {formatMonthYear(calendarMonth)}
                </h2>
                <button
                  onClick={handleNextMonth}
                  className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                  aria-label="Next month"
                >
                  <span className="text-lg">{">"}</span>
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-1">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="text-center text-xs font-semibold text-gray-600 py-1">
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {getCalendarDays().map((item, idx) => {
                  const dateStr = `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, "0")}-${String(item.day).padStart(2, "0")}`;
                  const isSelected = selectedDate === dateStr;

                  return (
                    <button
                      key={idx}
                      onClick={() => handleDateSelect(item.day)}
                      className={`py-2 rounded text-xs font-medium transition-all ${
                        !item.isCurrentMonth
                          ? "text-gray-300 cursor-default"
                          : isSelected
                            ? "theme-toggle-active"
                          : "text-gray-700 hover:bg-gray-100"
                      }`}
                      disabled={!item.isCurrentMonth}
                    >
                      {item.day}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => setSelectedDate(null)}
              className="w-full text-xs font-medium text-cyan-600 hover:text-cyan-700 py-2 px-3 rounded-lg hover:bg-cyan-50 transition-colors"
            >
              Clear Date Filter
            </button>
          </div>

          {/* Filters Panel */}
          <div className="lg:col-span-3 space-y-4">
            {/* Location Filter */}
            <div className="content-card">
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                <span className="w-1 h-4 bg-emerald-500 rounded"></span>
                Location Filter
              </label>
              <select
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                className="form-select"
              >
                <option value="">All Locations</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className="content-card">
              <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
                <span className="w-1 h-4 bg-amber-500 rounded"></span>
                Transaction Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="form-select"
              >
                <option value="">All Status</option>
                <option value="completed">Completed</option>
                <option value="held">Held</option>
                <option value="refunded">Refunded</option>
              </select>
            </div>

            {/* Filter Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setLocationFilter("");
                  setStatusFilter("completed");
                  setSelectedDate(null);
                }}
                className="flex-1 btn-action btn-action-secondary flex items-center justify-center gap-2"
              >
                Reset All Filters
              </button>
              <button
                onClick={() => setLocationFilter("")}
                className="flex-1 btn-action btn-action-secondary"
              >
                All Locations
              </button>
            </div>
          </div>
        </div>

        {/* Export and Results Summary */}
        <div className="content-card mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Results Summary</p>
              <p className="text-2xl font-bold text-cyan-600">
                {formatNumber(transactions.length)}
                <span className="text-sm font-normal text-gray-600 ml-2">transactions found</span>
              </p>
              <p className="text-lg font-bold text-green-600 mt-1">
                {formatCurrency(transactions.filter(tx => tx.status !== "held").reduce((sum, tx) => sum + (tx.total || 0), 0))}
                <span className="text-sm font-normal text-gray-600 ml-2">total sales</span>
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-2">Export Options</p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={exportCSV}
                  className="btn-action btn-action-primary"
                >
                   Export CSV
                </button>
                <button
                  className="btn-action btn-action-secondary"
                >
                   Export Word
                </button>
                <button
                  className="btn-action btn-action-secondary"
                >
                   Export Excel
                </button>
                <button
                  onClick={handlePrint}
                  className="btn-action btn-action-success"
                >
                   Print
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div id="print-section" className="data-table-container">
          {transactions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead className="sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Staff</th>
                    <th className="px-4 py-3 text-left font-semibold">Held By</th>
                    <th className="px-4 py-3 text-left font-semibold">Location</th>
                    <th className="px-4 py-3 text-left font-semibold">Device</th>
                    <th className="px-4 py-3 text-left font-semibold">Date/Time</th>
                    <th className="px-4 py-3 text-left font-semibold">Customer</th>
                    <th className="px-4 py-3 text-right font-semibold">Discount</th>
                    <th className="px-4 py-3 text-left font-semibold">Reason</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-left font-semibold">Tender</th>
                    <th className="px-4 py-3 text-right font-semibold">Change</th>
                    <th className="px-4 py-3 text-center font-semibold">Items</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {transactions.map((tx, idx) => (
                    <React.Fragment key={tx._id}>
                      <tr className={`transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-gray-50"} hover:bg-gray-100`}>
                        <td className="px-4 py-3 font-medium text-gray-800">{tx.staff?.name || tx.staff || "N/A"}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{tx.heldByStaffName || "-"}</td>
                        <td className="px-4 py-3">
                          <span className="badge badge-success">
                            {tx.location || "N/A"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{tx.device || "Till 1"}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{new Date(tx.createdAt).toLocaleString("en-NG", { timeZone: REPORT_TIME_ZONE })}</td>
                        <td className="px-4 py-3 text-gray-800">{tx.customerName || "Walk-in"}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-800">{formatCurrency(tx.discount || 0)}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{tx.discountReason || "-"}</td>
                        <td className="px-4 py-3 text-right font-bold text-cyan-600">{formatCurrency(tx.total || 0)}</td>
                        <td className="px-4 py-3">
                          {(() => {
                            const tenderInfo = getTenderDisplay(tx);
                            return (
                              <span className={`badge ${tenderInfo.className}`} title={tenderInfo.title}>
                                {tenderInfo.label}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-800">{formatCurrency(tx.change || 0)}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            className="btn-action btn-action-success btn-sm"
                            onClick={() => toggleDetails(tx._id)}
                          >
                            {expandedTxId === tx._id ? "Hide" : "Show"}
                          </button>
                        </td>
                      </tr>
                      {expandedTxId === tx._id && (
                        <tr className="bg-gray-100">
                          <td colSpan={12} className="px-6 py-4">
                            <div className="bg-white rounded-lg p-4 border border-gray-200">
                              <p className="text-sm font-semibold text-gray-700 mb-3">Order Items ({tx.items?.length || 0} items)</p>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead className="bg-cyan-50 border-b border-gray-300">
                                    <tr>
                                      <th className="px-3 py-2 text-left font-semibold text-gray-700">Product Name</th>
                                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Qty</th>
                                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Unit Price</th>
                                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Total</th>
                                      {showBarcode && <th className="px-3 py-2 text-right font-semibold text-gray-700">Barcode</th>}
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-200">
                                    {tx.items?.map((item, idx) => (
                                      <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                                        <td className="px-3 py-2 font-medium text-gray-800">{item.name}</td>
                                        <td className="px-3 py-2 text-right font-medium">{formatNumber(item.qty || 0)}</td>
                                        <td className="px-3 py-2 text-right text-gray-600">{formatCurrency(item.salePriceIncTax || 0)}</td>
                                        <td className="px-3 py-2 text-right font-semibold text-cyan-600">{formatCurrency((item.qty || 0) * (item.salePriceIncTax || 0))}</td>
                                        {showBarcode && <td className="px-3 py-2 text-right text-gray-600">{item.barcode || "-"}</td>}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center">
              <p className="text-gray-500 text-lg font-medium">No transactions found</p>
              <p className="text-gray-400 text-sm mt-1">Try adjusting your filters to see results</p>
            </div>
          )}
        </div>
        </div>
      </div>
    </Layout>
  );
}


