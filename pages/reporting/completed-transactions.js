// Completed Transactions Report
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import { saveAs } from "file-saver";
import { formatCurrency, formatNumber } from "@/lib/format";
import useProgress from "@/lib/useProgress";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { useAuth } from "@/lib/useAuth";

const REPORT_TIME_ZONE = "Africa/Lagos";
const reportDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const TRANSACTIONS_PAGE_SIZE = 50;

function parseDateKey(value) {
  if (!value) return null;

  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;

  return {
    year,
    month,
    day,
    key: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function getReportDateKey(value) {
  const parts = reportDateFormatter.formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) return null;

  return `${year}-${month}-${day}`;
}

export default function CompletedTransactions() {
  const { isAdmin } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [allTransactions, setAllTransactions] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalRecords, setTotalRecords] = useState(0);
  const [expandedTxId, setExpandedTxId] = useState(null);
  const [locationFilter, setLocationFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [locations, setLocations] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showBarcode, setShowBarcode] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { progress, start, onFetch, onProcess, complete } = useProgress();

  // Edit/Refund action states
  const [editModalTx, setEditModalTx] = useState(null);
  const [refundModalTx, setRefundModalTx] = useState(null);
  const [actionReason, setActionReason] = useState("");
  const [editForm, setEditForm] = useState({});
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState({ text: "", type: "" });
  const abortRef = useRef(null);

  // Fetch initial page, filter client-side on loaded records
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    fetchTransactions(controller.signal, { page: 1, append: false });
    return () => { controller.abort(); };
  }, []);

  // Apply filters when they change
  useEffect(() => {
    applyFilters();
  }, [locationFilter, statusFilter, selectedDate, startDate, endDate, allTransactions]);

async function fetchTransactions(signal, options = {}) {
  const { page = 1, append = false } = options;
  try {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError("");
    start();
    const res = await apiClient.get("/api/transactions/transactions", {
      signal,
      params: { page, limit: TRANSACTIONS_PAGE_SIZE },
    });
    onFetch();
    if (signal?.aborted) return;
    const data = res?.data || {};
    onProcess();
    const pageTransactions = (Array.isArray(data.transactions) ? data.transactions : []).map((tx) => ({
      ...tx,
      status: tx?.status ? String(tx.status).toLowerCase() : "completed",
      subStatus: tx?.subStatus || "none",
    }));

    const mergedTransactions = append
      ? (() => {
          const seen = new Set(allTransactions.map((tx) => String(tx._id)));
          const next = [...allTransactions];
          pageTransactions.forEach((tx) => {
            const id = String(tx._id);
            if (!seen.has(id)) {
              seen.add(id);
              next.push(tx);
            }
          });
          return next;
        })()
      : pageTransactions;

    const pagination = data.pagination || {};
    setCurrentPage(page);
    setHasMore(Boolean(pagination.hasMore));
    setTotalRecords(Number(pagination.totalRecords) || mergedTransactions.length);

    // Extract unique locations
    const locationSet = new Set();
    mergedTransactions.forEach((tx) => {
      if (tx.location) locationSet.add(tx.location);
    });
    const uniqueLocations = Array.from(locationSet)
      .sort((a, b) => {
        if (a === "online") return -1;
        if (b === "online") return 1;
        return a.localeCompare(b);
      })
      .map((name) => ({ id: name, name }));
    setLocations(uniqueLocations);
    setAllTransactions(mergedTransactions);
    complete();
  } catch (err) {
    if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED" || signal?.aborted) return;
    console.error(err);
    const apiMessage = err?.response?.data?.message || err?.response?.data?.error;
    setError(apiMessage || "Unable to load completed transactions.");
    complete();
  } finally {
    if (!signal?.aborted) {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }
}

  async function handleLoadMore() {
    if (loadingMore || !hasMore) return;
    const controller = new AbortController();
    abortRef.current = controller;
    await fetchTransactions(controller.signal, { page: currentPage + 1, append: true });
  }

function applyFilters() {
    let filtered = [...allTransactions];

    // Filter by status (voided is treated as refunded, edited uses subStatus)
    if (statusFilter) {
      if (statusFilter === "refunded") {
        filtered = filtered.filter((tx) => tx.status === "refunded" || tx.status === "voided");
      } else if (statusFilter === "edited") {
        filtered = filtered.filter(
          (tx) => tx.status === "completed" && tx.subStatus === "edited"
        );
      } else if (statusFilter === "credit-recovered") {
        filtered = filtered.filter((tx) => tx.creditStatus === "paid");
      } else if (statusFilter === "credit") {
        filtered = filtered.filter((tx) => tx.status === "credit" || (tx.creditStatus && tx.creditStatus !== "none" && tx.creditStatus !== "paid"));
      } else {
        filtered = filtered.filter((tx) => tx.status === statusFilter);
      }
    }

    // Filter by location
    if (locationFilter) {
      filtered = filtered.filter((tx) => tx.location === locationFilter);
    }

    // Filter by selected date (calendar)
    if (selectedDate) {
      const target = parseDateKey(selectedDate);

      if (target) {
        filtered = filtered.filter((tx) => getReportDateKey(tx.createdAt) === target.key);
      }
    }

    // Filter by date range
    if (startDate && endDate) {
      const rangeStart = parseDateKey(startDate)?.key;
      const rangeEnd = parseDateKey(endDate)?.key;

      if (rangeStart && rangeEnd) {
        filtered = filtered.filter((tx) => {
          const txDateKey = getReportDateKey(tx.createdAt);
          return txDateKey && txDateKey >= rangeStart && txDateKey <= rangeEnd;
        });
      }
    } else if (startDate) {
      const rangeStart = parseDateKey(startDate)?.key;

      if (rangeStart) {
        filtered = filtered.filter((tx) => {
          const txDateKey = getReportDateKey(tx.createdAt);
          return txDateKey && txDateKey >= rangeStart;
        });
      }
    } else if (endDate) {
      const rangeEnd = parseDateKey(endDate)?.key;

      if (rangeEnd) {
        filtered = filtered.filter((tx) => {
          const txDateKey = getReportDateKey(tx.createdAt);
          return txDateKey && txDateKey <= rangeEnd;
        });
      }
    }

    // Sort by newest first
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    setTransactions(filtered);
}

  // Get display status (voided → Refunded, subStatus for edited/void, credit recovered)
  function getDisplayStatus(status, subStatus, creditStatus) {
    if (creditStatus === "paid") return "Credit Recovered";
    if (creditStatus === "partly_paid") return "Partly Recovered";
    if (creditStatus === "open") return "Credit (Open)";
    if (status === "voided") return "Refunded";
    if (subStatus === "edited") return "Edited";
    if (subStatus === "void") return "Refunded (Void)";
    if (!status) return "Unknown";
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  function getStatusBadgeClass(status, subStatus, creditStatus) {
    if (creditStatus === "paid") return "bg-teal-100 text-teal-800";
    if (creditStatus === "partly_paid") return "bg-orange-100 text-orange-800";
    if (creditStatus === "open") return "bg-yellow-100 text-yellow-800";
    if (subStatus === "edited") return "bg-blue-100 text-blue-800";
    if (subStatus === "void") return "bg-purple-100 text-purple-800";
    switch (status) {
      case "completed": return "bg-emerald-100 text-emerald-800";
      case "held": return "bg-amber-100 text-amber-800";
      case "refunded":
      case "voided": return "bg-red-100 text-red-800";
      case "edited": return "bg-blue-100 text-blue-800";
      case "credit": return "bg-yellow-100 text-yellow-800";
      default: return "bg-gray-100 text-gray-800";
    }
  }

  // Handle void held transaction — sets status to "refunded"
  async function handleVoidTransaction(txId) {
    const shouldVoid = await showConfirmDialog({
      title: "Void held transaction?",
      message: "It will be marked as refunded.",
      tone: "danger",
      confirmLabel: "Void transaction",
      cancelLabel: "Keep transaction",
    });
    if (!shouldVoid) return;
    try {
      const res = await apiClient.put(`/api/transactions/${txId}`, { status: "refunded" });
      if (res.data?.success) {
        setAllTransactions((prev) =>
          prev.map((tx) => tx._id === txId ? { ...tx, status: "refunded" } : tx)
        );
      }
    } catch (err) {
      console.error("Error voiding transaction:", err);
      await showAlertDialog({
        title: "Void failed",
        message: "Failed to void transaction. Please try again.",
        tone: "danger",
      });
    }
  }

  // Open edit modal
  function openEditModal(tx) {
    setEditForm({
      customerName: tx.customerName || "",
      discount: tx.discount || 0,
      discountReason: tx.discountReason || "",
      items: (tx.items || []).map((item) => ({
        ...item,
        qty: item.qty || item.quantity || 0,
        salePriceIncTax: item.salePriceIncTax || item.price || 0,
      })),
    });
    setActionReason("");
    setActionMessage({ text: "", type: "" });
    setEditModalTx(tx);
  }

  // Open refund modal
  function openRefundModal(tx) {
    setActionReason("");
    setActionMessage({ text: "", type: "" });
    setRefundModalTx(tx);
  }

  // Submit edit request → sends email to admin for confirmation
  async function handleEditRequest() {
    if (!editModalTx) return;
    if (!actionReason.trim()) {
      setActionMessage({ text: "Please provide a reason for editing.", type: "error" });
      return;
    }
    setActionLoading(true);
    setActionMessage({ text: "", type: "" });
    try {
      // Recalculate total from edited items
      const itemsTotal = editForm.items.reduce((sum, item) => sum + (item.qty * item.salePriceIncTax), 0);
      const newTotal = itemsTotal - (Number(editForm.discount) || 0);

      const res = await apiClient.post("/api/transactions/request-action", {
        transactionId: editModalTx._id,
        actionType: "edit",
        reason: actionReason,
        editPayload: {
          items: editForm.items,
          total: Math.max(0, newTotal),
          discount: Number(editForm.discount) || 0,
          discountReason: editForm.discountReason,
          customerName: editForm.customerName,
        },
      });

      setActionMessage({
        text: res.data?.message || "Edit request sent to admin for approval.",
        type: "success",
      });
      setTimeout(() => { setEditModalTx(null); setActionMessage({ text: "", type: "" }); }, 3000);
    } catch (err) {
      const msg = err?.response?.data?.message || "Failed to submit edit request.";
      setActionMessage({ text: msg, type: "error" });
    } finally {
      setActionLoading(false);
    }
  }

  // Submit refund request → sends email to admin for confirmation
  async function handleRefundRequest() {
    if (!refundModalTx) return;
    if (!actionReason.trim()) {
      setActionMessage({ text: "Please provide a reason for the refund.", type: "error" });
      return;
    }
    setActionLoading(true);
    setActionMessage({ text: "", type: "" });
    try {
      const res = await apiClient.post("/api/transactions/request-action", {
        transactionId: refundModalTx._id,
        actionType: "refund",
        reason: actionReason,
      });

      setActionMessage({
        text: res.data?.message || "Refund request sent to admin for approval.",
        type: "success",
      });
      setTimeout(() => { setRefundModalTx(null); setActionMessage({ text: "", type: "" }); }, 3000);
    } catch (err) {
      const msg = err?.response?.data?.message || "Failed to submit refund request.";
      setActionMessage({ text: msg, type: "error" });
    } finally {
      setActionLoading(false);
    }
  }

  // Update item in edit form
  function updateEditItem(index, field, value) {
    setEditForm((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], [field]: Number(value) || 0 };
      return { ...prev, items };
    });
  }

  // Direct refund — restocks inventory immediately
  async function handleDirectRefund(tx) {
    const shouldRefund = await showConfirmDialog({
      title: "Refund this transaction?",
      message: `This will refund ${formatCurrency(tx.total)} and restock all ${tx.items?.length || 0} item(s) back to inventory.`,
      tone: "danger",
      confirmLabel: "Refund & Restock",
      cancelLabel: "Cancel",
    });
    if (!shouldRefund) return;

    try {
      const res = await apiClient.put(`/api/transactions/${tx._id}`, {
        status: "refunded",
        refundReason: "Direct refund from admin",
      });
      if (res.data?.success) {
        setAllTransactions((prev) =>
          prev.map((t) => t._id === tx._id ? { ...t, status: "refunded", refundedAt: new Date().toISOString() } : t)
        );
        await showAlertDialog({
          title: "Transaction Refunded",
          message: "Product quantities have been restocked and a refund journal entry has been posted.",
          tone: "success",
        });
      }
    } catch (err) {
      console.error("Error refunding transaction:", err);
      await showAlertDialog({
        title: "Refund Failed",
        message: err?.response?.data?.error || "Failed to refund transaction. Please try again.",
        tone: "danger",
      });
    }
  }

  // Delete refunded transaction — removes from all records
  async function handleDeleteTransaction(tx) {
    const shouldDelete = await showConfirmDialog({
      title: "Permanently delete this transaction?",
      message: "This will remove the transaction and all related accounting/journal entries. This action cannot be undone.",
      tone: "danger",
      confirmLabel: "Delete Permanently",
      cancelLabel: "Cancel",
    });
    if (!shouldDelete) return;

    try {
      const res = await apiClient.delete(`/api/transactions/${tx._id}`);
      if (res.data?.success) {
        setAllTransactions((prev) => prev.filter((t) => t._id !== tx._id));
        setExpandedTxId(null);
        await showAlertDialog({
          title: "Transaction Deleted",
          message: "Transaction and all related records have been permanently removed.",
          tone: "success",
        });
      }
    } catch (err) {
      console.error("Error deleting transaction:", err);
      await showAlertDialog({
        title: "Delete Failed",
        message: err?.response?.data?.error || "Failed to delete transaction. Please try again.",
        tone: "danger",
      });
    }
  }

  // Compute sales total excluding refunded/voided
  function getSalesTotalExcludingRefunded(txList) {
    return txList
      .filter((tx) => !["voided", "refunded", "held", "credit"].includes(tx.status))
      .reduce((sum, tx) => sum + (tx.total || 0), 0);
  }


  const toggleDetails = (id) => {
    setExpandedTxId(expandedTxId === id ? null : id);
  };

  const exportCSV = () => {
    const headers = [
      "Staff,Held By,Location,Device,Date,Customer,Discount,DiscountReason,Total,Tender,Change",
    ];
    const rows = transactions.map((tx) =>
      [
        tx.staff?.name || tx.staffName || tx.staff || "N/A",
        tx.heldByStaffName || "-",
        tx.location || "N/A",
        tx.device,
        new Date(tx.createdAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }),
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
      return {
        isSplit: true,
        payments: tx.tenderPayments.map((payment) => ({
          label: formatTenderLabel(payment?.tenderName || payment?.tenderType || "Tender"),
          amount: payment?.amount || 0,
          className: getTenderBadgeClass(payment?.tenderName || payment?.tenderType),
        })),
      };
    }

    const tenderName =
      Array.isArray(tx.tenderPayments) && tx.tenderPayments.length === 1
        ? tx.tenderPayments[0]?.tenderName || tx.tenderPayments[0]?.tenderType
        : tx.tenderType;

    const label = formatTenderLabel(tenderName || "Unknown");
    return {
      isSplit: false,
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

    // Next month days (greyed out) — cap at 35 cells (5 rows)
    const totalCells = days.length <= 35 ? 35 : 42;
    const remainingDays = totalCells - days.length;
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
          {/* Breadcrumb */}
          <div className="mb-6 text-sm text-gray-600">
            <Link href="/" className="text-cyan-600 hover:text-cyan-700">Home</Link>
            <span className="mx-2 text-gray-400">{">"}</span>
            <span className="text-gray-800 font-medium">Completed Transactions</span>
          </div>

        <div className="page-header">
          <h1 className="page-title">Completed Transactions</h1>
          <p className="page-subtitle">View and manage transaction records with advanced filtering</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 lg:items-stretch">
          {/* Calendar & Date Range Card — compact */}
          <div className="content-card flex flex-col p-3">
            <div className="mb-2">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={handlePrevMonth}
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                  aria-label="Previous month"
                >
                  <span className="text-sm">{"<"}</span>
                </button>
                <h2 className="text-xs font-semibold text-gray-800">
                  {formatMonthYear(calendarMonth)}
                </h2>
                <button
                  onClick={handleNextMonth}
                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                  aria-label="Next month"
                >
                  <span className="text-sm">{">"}</span>
                </button>
              </div>

              <div className="grid grid-cols-7 gap-0.5 mb-0.5">
                {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                  <div key={d} className="text-center text-[10px] font-semibold text-gray-500 py-0.5">
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-0.5">
                {getCalendarDays().map((item, idx) => {
                  const dateStr = `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, "0")}-${String(item.day).padStart(2, "0")}`;
                  const isSelected = selectedDate === dateStr;

                  return (
                    <button
                      key={idx}
                      onClick={() => handleDateSelect(item.day)}
                      className={`py-1 rounded text-[11px] font-medium transition-all ${
                        !item.isCurrentMonth
                          ? "text-gray-300 cursor-default"
                          : isSelected
                            ? "bg-cyan-600 text-white shadow-sm"
                          : "text-gray-700 hover:bg-gray-50"
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
              className="w-full text-[10px] font-medium text-cyan-600 hover:text-cyan-700 py-1 px-2 rounded hover:bg-gray-50 transition-colors mb-2"
            >
              Clear Date Filter
            </button>

            {/* Date Range - same card */}
            <div className="border-t border-gray-200 pt-3 mt-auto">
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 mb-2">
                <span className="w-1 h-3 bg-sky-500 rounded"></span>
                Date Range
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => { setStartDate(e.target.value); setSelectedDate(null); }}
                    className="form-input text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">End Date</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => { setEndDate(e.target.value); setSelectedDate(null); }}
                    className="form-input text-xs"
                  />
                </div>
              </div>
              <button
                onClick={() => { setStartDate(""); setEndDate(""); }}
                className="w-full text-[10px] font-medium text-cyan-600 hover:text-cyan-700 py-1 px-2 rounded hover:bg-gray-50 transition-colors mt-1"
              >
                Clear Date Range
              </button>
            </div>
          </div>

          {/* Filters Panel */}
          <div className="flex flex-col space-y-4">
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
                <option value="edited">Edited</option>
                <option value="credit">Credit (Open/Partial)</option>
                <option value="credit-recovered">Credit Recovered</option>
              </select>
            </div>

            {/* Filter Actions - pushed to bottom */}
            <div className="flex gap-2 mt-auto pt-2">
              <button
                onClick={() => {
                  setLocationFilter("");
                  setStatusFilter("");
                  setSelectedDate(null);
                  setStartDate("");
                  setEndDate("");
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
              <p className="text-xs text-gray-500 mt-1">
                Loaded: {formatNumber(allTransactions.length)} of {formatNumber(totalRecords)} total records
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Sales Total: <span className="font-semibold text-emerald-600">{formatCurrency(getSalesTotalExcludingRefunded(transactions))}</span>
                <span className="text-xs text-gray-400 ml-1">(excl. refunded)</span>
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
          {loading ? (
            <div className="p-8">
              <Loader size="md" text="Loading transactions..." progress={progress} />
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <p className="text-red-600 text-lg font-medium">Failed to load transactions</p>
              <p className="text-gray-500 text-sm mt-1">{error}</p>
              <button
                onClick={() => { const c = new AbortController(); abortRef.current = c; fetchTransactions(c.signal); }}
                className="mt-3 btn-action btn-action-primary"
              >
                Retry
              </button>
            </div>
          ) : transactions.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead className="sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Staff</th>
                      <th className="px-4 py-3 text-left font-semibold">Held By</th>
                      <th className="px-4 py-3 text-left font-semibold">Location</th>
                      <th className="px-4 py-3 text-left font-semibold">Date/Time</th>
                      <th className="px-4 py-3 text-left font-semibold">Customer</th>
                      <th className="px-4 py-3 text-center font-semibold">Status</th>
                      <th className="px-4 py-3 text-right font-semibold">Total</th>
                      <th className="px-4 py-3 text-left font-semibold">Tender</th>
                      <th className="px-4 py-3 text-center font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {transactions.map((tx, idx) => (
                      [
                      <tr key={tx._id} className={`transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-gray-50"} hover:bg-gray-50`}>
                        <td className="px-4 py-3 font-medium text-gray-800">{tx.staff?.name || tx.staffName || tx.staff || "N/A"}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{tx.heldByStaffName || "-"}</td>
                        <td className="px-4 py-3">
                          <span className="badge badge-success">
                            {tx.location || "N/A"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{new Date(tx.createdAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}</td>
                        <td className="px-4 py-3 text-gray-800">{tx.customerName || "Walk-in"}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusBadgeClass(tx.status, tx.subStatus, tx.creditStatus)}`}>
                            {getDisplayStatus(tx.status, tx.subStatus, tx.creditStatus)}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-right font-bold ${(tx.status === "voided" || tx.status === "refunded") ? "text-red-400 line-through" : "text-cyan-600"}`}>
                          {formatCurrency(tx.total || 0)}
                        </td>
                        <td className="px-4 py-3">
                          {(() => {
                            const tenderInfo = getTenderDisplay(tx);
                            if (tenderInfo.isSplit) {
                              return (
                                <div className="flex flex-col gap-1">
                                  {tenderInfo.payments.map((p, i) => (
                                    <span key={i} className={`badge ${p.className} text-xs`}>
                                      {p.label}: {formatCurrency(p.amount)}
                                    </span>
                                  ))}
                                </div>
                              );
                            }
                            return (
                              <span className={`badge ${tenderInfo.className}`} title={tenderInfo.title}>
                                {tenderInfo.label}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              className="btn-action btn-action-success btn-sm"
                              onClick={() => toggleDetails(tx._id)}
                            >
                              {expandedTxId === tx._id ? "Hide" : "View"}
                            </button>
                            {tx.status === "held" && (
                              <button
                                className="btn-action btn-action-danger btn-sm"
                                onClick={() => handleVoidTransaction(tx._id)}
                              >
                                Void
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>,
                      expandedTxId === tx._id ? (
                        <tr key={`${tx._id}-expanded`} className="bg-gray-100">
                          <td colSpan={9} className="px-6 py-4">
                            <div className="bg-white rounded-lg p-4 border border-gray-200">
                              <div className="mb-3 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
                                <div>
                                  <span className="font-semibold text-gray-700">Cashier:</span>{" "}
                                  {tx.staff?.name || tx.staffName || tx.staff || "N/A"}
                                </div>
                                <div>
                                  <span className="font-semibold text-gray-700">Held By:</span>{" "}
                                  {tx.heldByStaffName || "-"}
                                </div>
                              </div>
                              <p className="text-sm font-semibold text-gray-700 mb-3">Order Items ({tx.items?.length || 0} items)</p>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead className="bg-gray-50 border-b border-gray-300">
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

                              {/* Credit Recovery Details */}
                              {tx.creditStatus && tx.creditStatus !== "none" && (
                                <div className="mt-4 pt-3 border-t border-gray-200">
                                  <p className="text-sm font-semibold text-gray-700 mb-2">Credit Recovery Details</p>
                                  <div className="grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
                                    <div>
                                      <span className="font-semibold text-gray-700">Credit Date:</span>{" "}
                                      {tx.createdAt ? new Date(tx.createdAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) : "-"}
                                    </div>
                                    <div>
                                      <span className="font-semibold text-gray-700">Recovery Date:</span>{" "}
                                      {tx.creditPaidAt ? new Date(tx.creditPaidAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) : "Not yet recovered"}
                                    </div>
                                    <div>
                                      <span className="font-semibold text-gray-700">Credit Customer:</span>{" "}
                                      {tx.creditCustomerName || "-"}
                                    </div>
                                    <div>
                                      <span className="font-semibold text-gray-700">Recovery Tender:</span>{" "}
                                      {tx.creditPayments?.length > 0
                                        ? tx.creditPayments.map((p, i) => (
                                            <span key={i} className="inline-block badge badge-primary mr-1 text-xs">
                                              {p.tenderName || p.tenderType || "Unknown"} - {formatCurrency(p.amount)}
                                            </span>
                                          ))
                                        : "No payments recorded"}
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* Action Buttons — Admin Only */}
                              {isAdmin && (
                                <div className="mt-4 pt-3 border-t border-gray-200 flex items-center gap-3">
                                  {tx.status === "completed" && tx.creditStatus !== "paid" && (
                                    <button
                                      className="btn-action btn-action-danger btn-sm"
                                      onClick={() => handleDirectRefund(tx)}
                                    >
                                      Refund & Restock
                                    </button>
                                  )}
                                  {tx.status === "refunded" && (
                                    <button
                                      className="btn-action btn-sm bg-gray-800 text-white hover:bg-gray-900"
                                      onClick={() => handleDeleteTransaction(tx)}
                                    >
                                      Delete Permanently
                                    </button>
                                  )}
                                  {tx.status === "refunded" && tx.refundedAt && (
                                    <span className="text-xs text-gray-500">
                                      Refunded: {new Date(tx.refundedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null,
                      ]
                    ))}
                  </tbody>
                </table>
              </div>

              {(hasMore || loadingMore) && (
                <div className="flex justify-center p-4 border-t border-gray-200 bg-white">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="btn-action btn-action-primary min-w-[180px] disabled:opacity-60"
                  >
                    {loadingMore ? "Loading more..." : "Load More Transactions"}
                  </button>
                </div>
              )}
            </>
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


