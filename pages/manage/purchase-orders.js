"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import useProgress from "@/lib/useProgress";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";
import {
  Plus, Search, X, ChevronDown, ChevronUp, Package,
  CreditCard, CheckCircle, Truck, Trash2, Filter,
} from "lucide-react";

function getDateRangeFromPeriod(period) {
  const today = new Date();
  const iso = (date) => date.toISOString().split("T")[0];
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay());
  const endOfLastWeek = new Date(startOfWeek);
  endOfLastWeek.setDate(startOfWeek.getDate() - 1);
  const startOfLastWeek = new Date(endOfLastWeek);
  startOfLastWeek.setDate(endOfLastWeek.getDate() - 6);
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
  const startOfLastMonth = new Date(endOfLastMonth.getFullYear(), endOfLastMonth.getMonth(), 1);

  switch (period) {
    case "today": return { selectedDate: iso(today), startDate: "", endDate: "" };
    case "yesterday": { const y = new Date(today); y.setDate(today.getDate() - 1); return { selectedDate: iso(y), startDate: "", endDate: "" }; }
    case "thisWeek": return { selectedDate: "", startDate: iso(startOfWeek), endDate: new Date(today.setHours(23, 59, 59, 999)).toISOString() };
    case "lastWeek": return { selectedDate: "", startDate: iso(startOfLastWeek), endDate: iso(endOfLastWeek) };
    case "thisMonth": return { selectedDate: "", startDate: iso(startOfMonth), endDate: new Date(new Date().setHours(23, 59, 59, 999)).toISOString() };
    case "lastMonth": return { selectedDate: "", startDate: iso(startOfLastMonth), endDate: iso(endOfLastMonth) };
    default: return { selectedDate: "", startDate: "", endDate: "" };
  }
}

const STATUS_COLORS = {
  "Not Paid": "bg-red-100 text-red-700",
  "Partly Paid": "bg-yellow-100 text-yellow-700",
  "Paid": "bg-green-100 text-green-700",
  "Paid / Completed": "bg-green-100 text-green-700",
  "Credit": "bg-purple-100 text-purple-700",
};
const RECEIVED_COLORS = {
  Pending: "bg-gray-100 text-gray-600",
  "Partially Received": "bg-orange-100 text-orange-700",
  Received: "bg-green-100 text-green-700",
  Completed: "bg-green-100 text-green-700",
};

export default function PurchaseOrdersPage() {
  const { progress, start, complete } = useProgress();
  const router = useRouter();
  const [orders, setOrders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const { isAdmin } = useAuth();
  const [tableFilter, setTableFilter] = useState("all");
  const [paidFilter, setPaidFilter] = useState("tillDate");
  const [currentPage, setCurrentPage] = useState(1);
  const entriesPerPage = 10;

  // Period filter state
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [periodDates, setPeriodDates] = useState({ selectedDate: "", startDate: "", endDate: "" });
  const [vendorFilter, setVendorFilter] = useState("");

  // Inline edit state
  const [editIndex, setEditIndex] = useState(null);
  const [editedPayment, setEditedPayment] = useState("");
  const [editedPaymentDate, setEditedPaymentDate] = useState("");
  const [editedTotal, setEditedTotal] = useState("");
  const [editedDate, setEditedDate] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const emptyForm = {
    vendor: "", reason: "Restock", notes: "", payBeforeSupply: false,
    products: [{ name: "", quantity: 1, price: 0 }],
  };
  const [form, setForm] = useState(emptyForm);

  // Quick entry state
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [quickForm, setQuickForm] = useState({
    vendor: "", amount: "", paymentDate: new Date().toISOString().split("T")[0], notes: "", products: "",
  });
  const [savingQuick, setSavingQuick] = useState(false);

  const outstandingCheck = ["not paid", "partly paid"];

  const toNumber = (v) => {
    const n = Number(String(v ?? 0).replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const getNormalizedStatus = (order) => String(order?.status || "").trim().toLowerCase();
  const isCreditOrder = (order) => getNormalizedStatus(order) === "credit";
  const isCompletedOrder = (order) => getNormalizedStatus(order) === "paid" && order?.receivedStatus === "Received";
  const getDisplayStatus = (order) => (isCompletedOrder(order) ? "Paid / Completed" : order?.status || "Not Paid");
  const getDisplayReceivedStatus = (order) => (isCompletedOrder(order) ? "Completed" : order?.receivedStatus || "Pending");

  useEffect(() => {
    fetchOrders();
    fetchVendors();
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      start();
      const res = await apiClient.get("/api/purchase-orders?limit=500");
      const list = res.data?.orders || res.data;
      setOrders(Array.isArray(list) ? list : []);
      complete();
    } catch { complete(); } finally { setLoading(false); }
  }, []);

  async function fetchVendors() {
    try {
      const res = await apiClient.get("/api/vendors?active=true");
      const list = res.data?.vendors || res.data;
      setVendors(Array.isArray(list) ? list : []);
    } catch {}
  }

  function addProductRow() {
    setForm({ ...form, products: [...form.products, { name: "", quantity: 1, price: 0 }] });
  }

  function removeProductRow(idx) {
    const p = [...form.products];
    p.splice(idx, 1);
    setForm({ ...form, products: p });
  }

  function updateProduct(idx, field, value) {
    const p = [...form.products];
    p[idx] = { ...p[idx], [field]: value };
    setForm({ ...form, products: p });
  }

  function getGrandTotal() {
    return form.products.reduce((sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.price) || 0), 0);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.vendor) {
      await showAlertDialog({
        title: "Vendor required",
        message: "Please select a vendor.",
        tone: "warning",
      });
      return;
    }
    if (form.products.some((p) => !p.name)) {
      await showAlertDialog({
        title: "Incomplete products",
        message: "All products must have a name.",
        tone: "warning",
      });
      return;
    }
    setSaving(true);
    try {
      const vendor = vendors.find((v) => v._id === form.vendor);
      const payload = {
        vendor: form.vendor,
        vendorName: vendor?.companyName || "",
        contact: vendor?.repPhone || "",
        reason: form.reason,
        notes: form.notes,
        payBeforeSupply: form.payBeforeSupply,
        products: form.products.map((p) => ({
          name: p.name,
          quantity: Number(p.quantity) || 0,
          price: Number(p.price) || 0,
          total: (Number(p.quantity) || 0) * (Number(p.price) || 0),
        })),
        grandTotal: getGrandTotal(),
      };
      await apiClient.post("/api/purchase-orders", payload);
      setShowForm(false);
      setForm(emptyForm);
      fetchOrders();
    } catch (err) {
      await showAlertDialog({
        title: "Create order failed",
        message: err.response?.data?.error || "Failed to create order",
        tone: "danger",
      });
    } finally { setSaving(false); }
  }

  async function handlePayment(orderId) {
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) return;
    try {
      await apiClient.put(`/api/purchase-orders/${orderId}`, {
        action: "update-payment",
        paymentMade: amount,
        paymentDate: paymentDate || new Date().toISOString(),
      });
      setShowPaymentModal(null);
      setPaymentAmount("");
      setPaymentDate("");
      fetchOrders();
    } catch (err) {
      await showAlertDialog({
        title: "Payment update failed",
        message: err.response?.data?.error || "Payment update failed",
        tone: "danger",
      });
    }
  }

  function handleConfirmReceived(orderId) {
    router.push(`/stock/add?poId=${orderId}`);
  }

  async function handleDelete(id) {
    try {
      await apiClient.delete(`/api/purchase-orders/${id}`);
      setDeleteConfirm(null);
      fetchOrders();
    } catch (err) {
      await showAlertDialog({
        title: "Delete failed",
        message: err.response?.data?.error || "Failed to delete",
        tone: "danger",
      });
    }
  }

  async function handleQuickEntrySubmit(e) {
    e.preventDefault();
    if (!quickForm.vendor || !quickForm.amount) {
      await showAlertDialog({
        title: "Missing quick entry fields",
        message: "Vendor and amount are required.",
        tone: "warning",
      });
      return;
    }
    setSavingQuick(true);
    try {
      const vendor = vendors.find((v) => v._id === quickForm.vendor);
      const payload = {
        vendor: quickForm.vendor,
        vendorName: vendor?.companyName || "",
        contact: vendor?.repPhone || "",
        reason: "Quick Entry",
        notes: quickForm.notes,
        payBeforeSupply: true,
        date: quickForm.paymentDate,
        products: quickForm.products
          ? quickForm.products.split(",").map((p) => ({
              name: p.trim(),
              quantity: 1,
              price: Number(quickForm.amount),
              total: Number(quickForm.amount),
            }))
          : [{ name: "Payment Entry", quantity: 1, price: Number(quickForm.amount), total: Number(quickForm.amount) }],
        grandTotal: Number(quickForm.amount),
        paymentMade: Number(quickForm.amount),
        paymentDate: quickForm.paymentDate,
      };
      await apiClient.post("/api/purchase-orders", payload);
      setShowQuickEntry(false);
      setQuickForm({ vendor: "", amount: "", paymentDate: new Date().toISOString().split("T")[0], notes: "", products: "" });
      fetchOrders();
    } catch (err) {
      await showAlertDialog({
        title: "Quick entry failed",
        message: err.response?.data?.error || "Failed to create quick entry",
        tone: "danger",
      });
    } finally {
      setSavingQuick(false);
    }
  }

  // Inline edit handlers
  function handleEdit(idx) {
    const order = paginatedOrders[idx];
    if (!order) return;
    setEditIndex(idx);
    setEditedPayment(String(order.paymentMade ?? ""));
    setEditedPaymentDate(order.paymentDate ? new Date(order.paymentDate).toISOString().slice(0, 10) : "");
    setEditedTotal(String(order.grandTotal ?? ""));
    setEditedDate(order.date ? new Date(order.date).toISOString().slice(0, 10) : "");
  }

  function handleCancelEdit() {
    setEditIndex(null);
    setEditedPayment("");
    setEditedTotal("");
    setEditedDate("");
    setEditedPaymentDate("");
  }

  async function handleSaveEdit(idx) {
    const order = paginatedOrders[idx];
    if (!order) return;
    const payNum = editedPayment !== "" ? Number(editedPayment) : Number(order.paymentMade || 0);
    const totalNum = editedTotal !== "" ? Number(editedTotal) : Number(order.grandTotal || 0);
    if (!Number.isFinite(payNum) || payNum < 0) return;
    if (!Number.isFinite(totalNum) || totalNum < 0) return;

    setIsBusy(true);
    try {
      await apiClient.put(`/api/purchase-orders/${order._id}`, {
        action: "update-payment",
        paymentMade: payNum,
        paymentDate: editedPaymentDate || order.paymentDate || new Date().toISOString(),
      });
      handleCancelEdit();
      fetchOrders();
    } catch (err) {
      await showAlertDialog({
        title: "Save payment failed",
        message: "Failed to save payment.",
        tone: "danger",
      });
    } finally { setIsBusy(false); }
  }

  async function handleTogglePayBeforeSupply(orderId, currentValue) {
    setIsBusy(true);
    try {
      await apiClient.put(`/api/purchase-orders/${orderId}`, {
        payBeforeSupply: !currentValue,
      });
      fetchOrders();
    } catch { } finally { setIsBusy(false); }
  }

  // Derived data
  const startOfDay = (d) => {
    const dt = new Date(d);
    if (isNaN(dt)) return null;
    dt.setHours(0, 0, 0, 0);
    return dt;
  };

  const getOrderDate = (o) => o?.date || o?.createdAt || o?.paymentDate || null;

  const overdueOrders = useMemo(() => {
    const today = startOfDay(new Date());
    if (!today) return [];
    return orders.filter((order) => {
      const dStr = getOrderDate(order);
      if (!dStr) return false;
      const date = new Date(dStr);
      if (isNaN(date)) return false;
      const dueDate = startOfDay(date);
      if (!dueDate) return false;
      dueDate.setDate(dueDate.getDate() + 14);
      const status = getNormalizedStatus(order);
      return !["paid", "credit"].includes(status) && dueDate < today;
    });
  }, [orders]);

  const outstandingOrders = useMemo(() =>
    orders.filter((o) => outstandingCheck.includes(o?.status?.toLowerCase()) && !o.payBeforeSupply),
  [orders]);

  const creditOrders = useMemo(() =>
    orders.filter((o) => isCreditOrder(o)),
  [orders]);

  const totalOverdueValue = useMemo(() =>
    overdueOrders.reduce((sum, o) => sum + toNumber(o.balance ?? o.grandTotal ?? 0), 0),
  [overdueOrders]);

  const totalOutstanding = useMemo(() =>
    outstandingOrders.reduce((sum, o) => sum + toNumber(o.balance ?? o.grandTotal ?? 0), 0),
  [outstandingOrders]);

  const totalCreditValue = useMemo(() =>
    creditOrders.reduce((sum, o) => sum + toNumber(o.paymentMade || o.grandTotal || 0), 0),
  [creditOrders]);

  const totalPaid = useMemo(() => {
    const validStatuses = ["paid", "partly paid"];
    let filtered = orders.filter((o) => validStatuses.includes(o.status?.toLowerCase()));

    // Apply period filter to totalPaid calculation
    if (periodDates.startDate && periodDates.endDate) {
      const start = new Date(periodDates.startDate); start.setHours(0, 0, 0, 0);
      const end = new Date(periodDates.endDate); end.setHours(23, 59, 59, 999);
      filtered = filtered.filter((o) => {
        const d = new Date(o.paymentDate || o.date || o.createdAt);
        return d >= start && d <= end;
      });
    } else if (periodDates.selectedDate) {
      filtered = filtered.filter((o) => {
        const dStr = new Date(o.paymentDate || o.date || o.createdAt).toISOString().split("T")[0];
        return dStr === periodDates.selectedDate;
      });
    }

    // Apply vendor filter to totalPaid
    if (vendorFilter) {
      filtered = filtered.filter((o) => o.vendorName === vendorFilter);
    }

    return filtered.reduce((sum, o) => sum + toNumber(o.paymentMade), 0);
  }, [orders, periodDates, vendorFilter]);

  // Unique vendor names for filter dropdown
  const vendorNames = useMemo(() => {
    return [...new Set(orders.map((o) => o.vendorName).filter(Boolean))].sort();
  }, [orders]);

  const filteredOrdersForTable = useMemo(() => {
    let list = orders;
    if (tableFilter === "overdue") list = overdueOrders;
    else if (tableFilter === "outstanding") list = outstandingOrders;
    else if (tableFilter === "paid") list = orders.filter((o) => isCompletedOrder(o));

    if (search) {
      const s = search.toLowerCase();
      list = list.filter((o) =>
        o.orderRef?.toLowerCase().includes(s) ||
        o.vendorName?.toLowerCase().includes(s)
      );
    }
    if (statusFilter) {
      list = list.filter((o) => o.status === statusFilter);
    }

    // Period filter
    if (periodDates.startDate && periodDates.endDate) {
      const start = new Date(periodDates.startDate); start.setHours(0, 0, 0, 0);
      const end = new Date(periodDates.endDate); end.setHours(23, 59, 59, 999);
      list = list.filter((o) => {
        const d = new Date(o.date || o.createdAt);
        return d >= start && d <= end;
      });
    } else if (periodDates.selectedDate) {
      list = list.filter((o) => {
        const dStr = new Date(o.date || o.createdAt).toISOString().split("T")[0];
        return dStr === periodDates.selectedDate;
      });
    }

    // Vendor filter
    if (vendorFilter) {
      list = list.filter((o) => o.vendorName === vendorFilter);
    }

    return [...list].sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
  }, [orders, tableFilter, overdueOrders, outstandingOrders, search, statusFilter, periodDates, vendorFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredOrdersForTable.length / entriesPerPage));
  const paginatedOrders = filteredOrdersForTable.slice((currentPage - 1) * entriesPerPage, currentPage * entriesPerPage);

  useEffect(() => { setCurrentPage(1); setEditIndex(null); }, [tableFilter, search, statusFilter]);

  if (loading) return <Layout><Loader /></Layout>;

  return (
    <Layout>
      <div className="min-h-screen bg-gray-100 p-3 sm:p-4 md:p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold theme-section-title">
              Vendor Payment Tracker
            </h1>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowQuickEntry(true)}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium transition shadow-sm"
              >
                <Plus size={16} /> Quick Entry
              </button>
              <p className="text-sm text-gray-500">Orders are placed from the <Link href="/manage/vendors" className="font-medium theme-accent-text hover:underline">Vendor page</Link></p>
            </div>
          </div>

          {/* Dashboard Layout */}
          <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 w-full">
            {/* Left Side: Overdue + Credit */}
            <div className="w-full lg:w-1/2 flex flex-col gap-4">
              {/* Overdue Orders Alert */}
              {overdueOrders.length > 0 ? (
                <div className="bg-red-50 border border-red-200 text-red-800 p-3 sm:p-5 rounded-xl shadow-md">
                  <div className="font-semibold mb-3 text-sm md:text-base">
                    {overdueOrders.length} Overdue Order{overdueOrders.length > 1 ? "s" : ""}
                  </div>
                  <div className="flex flex-wrap gap-8">
                    {Array.from({ length: Math.ceil(overdueOrders.length / 5) }).map((_, colIndex) => (
                      <ul key={colIndex} className="list-disc pl-5 space-y-1">
                        {overdueOrders.slice(colIndex * 5, colIndex * 5 + 5).map((order, i) => {
                          const date = new Date(getOrderDate(order));
                          const dueDate = new Date(date); dueDate.setDate(dueDate.getDate() + 14);
                          const daysOverdue = Math.floor((startOfDay(new Date()) - startOfDay(dueDate)) / (1000 * 60 * 60 * 24));
                          return (
                            <li key={order._id ?? i} className="text-xs md:text-sm">
                              <span className="font-medium">{order.vendorName || "Unknown"}</span> —{" "}
                              {date && !isNaN(date) ? date.toLocaleDateString() : "No Date"}{" "}
                              <span className="text-red-500 font-medium">({daysOverdue} days overdue)</span>
                            </li>
                          );
                        })}
                      </ul>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 text-green-800 p-5 rounded-xl shadow-md text-sm">
                  No overdue outstanding vendor payments.
                </div>
              )}

              {/* Credit Orders */}
              {creditOrders.length > 0 && (
                <div className="theme-note-primary p-4 sm:p-5 rounded-xl shadow-md">
                  <div className="font-semibold mb-3 text-sm md:text-base flex items-center justify-between">
                    <span>{creditOrders.length} Credit Order{creditOrders.length > 1 ? "s" : ""}</span>
                    <span className="theme-badge-soft text-xs sm:text-sm px-2 py-1 rounded-full font-bold">{formatCurrency(totalCreditValue)}</span>
                  </div>
                  <p className="text-xs theme-accent-text opacity-80 mb-3">These orders are fully prepaid but still waiting for stock to be received.</p>
                  <div className="space-y-2">
                    {creditOrders.map((order, i) => (
                      <div key={order._id ?? i} className="theme-border-soft flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm bg-white px-3 py-2 rounded-lg border">
                        <div>
                          <span className="font-medium">{order.vendorName || "Unknown"}</span>
                          <span className="text-gray-400 ml-2">{order.date ? new Date(order.date).toLocaleDateString() : ""}</span>
                        </div>
                        <div className="flex gap-3">
                          <span className="text-gray-600">Total: {formatCurrency(order.grandTotal)}</span>
                          <span className="text-green-700 font-medium">Paid: {formatCurrency(order.paymentMade)}</span>
                          <span className="theme-accent-text font-bold">Credit Held: {formatCurrency(toNumber(order.paymentMade || order.grandTotal || 0))}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Side: Stats Cards */}
            <div className="w-full lg:w-1/2 flex flex-col gap-3 sm:gap-6">
              {/* Total Paid Card */}
              <div className="bg-emerald-600 border border-emerald-700 text-white p-4 sm:p-5 rounded-2xl shadow-lg text-center">
                <div className="text-xs uppercase tracking-wide font-semibold opacity-90 mb-1">Total Paid</div>
                <div className="text-2xl sm:text-3xl font-bold">{formatCurrency(totalPaid)}</div>
                <div className="text-xs opacity-80 mt-1">Excludes prepaid credit awaiting supply</div>
              </div>

              <button onClick={() => { setTableFilter("all"); setStatusFilter(""); }}
                className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium px-5 py-2 rounded-xl shadow-md transition-all duration-300 w-full">
                Full Table
              </button>

              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div onClick={() => setTableFilter("overdue")} role="button" tabIndex={0}
                  className="cursor-pointer bg-red-600 border border-red-700 text-white p-3 sm:p-4 rounded-2xl shadow-lg flex flex-col justify-center items-center transform hover:scale-[1.03] transition-all duration-300 min-h-[120px]">
                  <span className="text-[11px] sm:text-xs uppercase tracking-wide text-center pb-1 font-semibold opacity-90 w-full border-b border-gray-300">Overdue</span>
                  <span className="text-xs sm:text-sm text-gray-200 font-medium mt-1">{overdueOrders.length} orders</span>
                  <span className="mt-auto text-lg sm:text-2xl font-bold drop-shadow-sm text-center">{formatCurrency(totalOverdueValue)}</span>
                </div>
                <div onClick={() => setTableFilter("outstanding")} role="button" tabIndex={0}
                  className="cursor-pointer bg-amber-400 border border-amber-500 text-gray-900 p-3 sm:p-4 rounded-2xl shadow-lg flex flex-col justify-center items-center transform hover:scale-[1.03] transition-all duration-300 min-h-[120px]">
                  <span className="text-[11px] sm:text-xs uppercase tracking-wide text-center pb-1 font-semibold opacity-90 w-full border-b border-gray-400">Outstanding</span>
                  <span className="text-xs sm:text-sm text-gray-700 font-medium mt-1">{outstandingOrders.length} orders</span>
                  <span className="mt-auto text-lg sm:text-2xl font-bold drop-shadow-sm text-center">{formatCurrency(totalOutstanding)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 mt-6 mb-4">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Search by reference or vendor..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white" />
            </div>
            <div className="relative">
              <Filter size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="pl-8 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 appearance-none">
                <option value="">All Statuses</option>
                <option value="Not Paid">Not Paid</option>
                <option value="Partly Paid">Partly Paid</option>
                <option value="Paid">Paid</option>
                <option value="Credit">Credit</option>
              </select>
            </div>
            <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500">
              <option value="">All Vendors</option>
              {vendorNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          {/* Period Filter */}
          <div className="flex flex-wrap gap-3 mb-4 items-end">
            <select
              value={selectedPeriod}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedPeriod(val);
                if (val && val !== "custom" && val !== "specific") {
                  setPeriodDates(getDateRangeFromPeriod(val));
                } else if (!val) {
                  setPeriodDates({ selectedDate: "", startDate: "", endDate: "" });
                }
              }}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm bg-white focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Filter by period</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="thisWeek">This Week</option>
              <option value="lastWeek">Last Week</option>
              <option value="thisMonth">This Month</option>
              <option value="lastMonth">Last Month</option>
              <option value="specific">Specific Date</option>
              <option value="custom">Custom Range</option>
            </select>
            {selectedPeriod === "specific" && (
              <div>
                <label className="block text-xs text-gray-600 mb-1">Select Date</label>
                <input type="date" onChange={(e) => setPeriodDates({ selectedDate: e.target.value, startDate: "", endDate: "" })} className="px-4 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
            )}
            {selectedPeriod === "custom" && (
              <>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Start Date</label>
                  <input type="date" onChange={(e) => setPeriodDates((prev) => ({ ...prev, startDate: e.target.value }))} className="px-4 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">End Date</label>
                  <input type="date" onChange={(e) => setPeriodDates((prev) => ({ ...prev, endDate: e.target.value }))} className="px-4 py-2 border border-gray-300 rounded-lg text-sm" />
                </div>
              </>
            )}
            {selectedPeriod && (
              <button onClick={() => { setSelectedPeriod(""); setPeriodDates({ selectedDate: "", startDate: "", endDate: "" }); }} className="text-xs text-red-600 hover:text-red-700 px-3 py-2 bg-red-50 rounded-lg">
                Clear Period
              </button>
            )}
          </div>

          {/* Desktop Table */}
          <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-300 text-sm select-none">
              <thead className="text-white font-semibold uppercase tracking-wide" style={{ backgroundColor: "var(--table-header-bg)", borderBottom: "1px solid var(--table-header-border)" }}>
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Ref</th>
                  <th className="px-4 py-3 text-left">Vendor</th>
                  <th className="px-4 py-3 text-left">Main Product</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-left">Pay Date</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-center">Type</th>
                  <th className="px-4 py-3 text-center">Received</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {paginatedOrders.map((order, idx) => (
                  <tr key={order._id ?? idx} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      {editIndex === idx ? (
                        <input type="date" className="border border-gray-300 px-2 py-1 rounded text-sm" value={editedDate} onChange={(e) => setEditedDate(e.target.value)} />
                      ) : (
                        order.date ? new Date(order.date).toLocaleDateString() : order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "—"
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{order.orderRef || "—"}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{order.vendorName || "—"}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {order.products?.[0]?.name || "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editIndex === idx ? (
                        <input type="number" className="w-24 border border-gray-300 px-2 py-1 rounded text-sm text-right" value={editedTotal} onChange={(e) => setEditedTotal(e.target.value)} />
                      ) : formatCurrency(order.grandTotal)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editIndex === idx ? (
                        <div className="flex flex-col gap-1 items-end">
                          <input type="number" min={0} className="border border-gray-300 rounded px-2 py-1 w-24 text-right text-sm" value={editedPayment} onChange={(e) => setEditedPayment(e.target.value)} />
                          <div className="flex gap-1">
                            <button disabled={isBusy} onClick={() => handleSaveEdit(idx)} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-medium transition">Save</button>
                            <button onClick={handleCancelEdit} className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-xs font-medium transition">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-sm font-medium">{formatCurrency(order.paymentMade)}</span>
                          <button disabled={isBusy} onClick={() => handleEdit(idx)} className="btn-action-primary px-2 py-1 text-xs font-medium transition">Edit</button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {editIndex === idx ? (
                        <input type="date" className="border border-gray-300 px-2 py-1 rounded text-sm" value={editedPaymentDate} onChange={(e) => setEditedPaymentDate(e.target.value)} />
                      ) : (
                        order.paymentDate ? new Date(order.paymentDate).toLocaleDateString() : "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{formatCurrency(order.balance ?? (toNumber(order.grandTotal) - toNumber(order.paymentMade)))}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold shadow-sm ${STATUS_COLORS[getDisplayStatus(order)] || STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}>
                        {getDisplayStatus(order)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button disabled={isBusy} onClick={() => handleTogglePayBeforeSupply(order._id, order.payBeforeSupply)}
                        className={`inline-block px-2 py-1 rounded-full text-[10px] font-semibold transition ${order.payBeforeSupply ? "bg-purple-100 text-purple-700 hover:bg-purple-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                        {order.payBeforeSupply ? "Pre-Pay" : "Outstanding"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-1 rounded-full text-[10px] font-semibold ${RECEIVED_COLORS[getDisplayReceivedStatus(order)] || RECEIVED_COLORS[order.receivedStatus] || "bg-gray-100 text-gray-600"}`}>
                        {getDisplayReceivedStatus(order)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {order.receivedStatus !== "Received" && (
                          <button onClick={() => handleConfirmReceived(order._id)} className="px-2 py-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded transition">Received</button>
                        )}
                        {order.receivedStatus !== "Received" && isAdmin && (
                          <button onClick={() => setDeleteConfirm(order._id)} className="px-2 py-1 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded transition">Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {paginatedOrders.length === 0 && (
                  <tr><td colSpan="12" className="text-center py-8 text-gray-400">No orders found</td></tr>
                )}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 my-4">
                <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 text-sm">Prev</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button key={page} onClick={() => { setCurrentPage(page); setEditIndex(null); }} className={`px-3 py-1 rounded text-sm border ${page === currentPage ? "theme-toggle-active" : "theme-toggle-neutral"}`}>{page}</button>
                ))}
                <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 text-sm">Next</button>
              </div>
            )}
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-4 mt-4">
            {paginatedOrders.map((order, idx) => (
              <div key={order._id ?? idx} className="bg-white p-4 rounded-2xl shadow border border-gray-200 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-gray-800">{order.vendorName || "Unknown"}</h3>
                    <p className="text-xs text-gray-500">{order.orderRef} — {order.date ? new Date(order.date).toLocaleDateString() : "—"}</p>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[getDisplayStatus(order)] || STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}>{getDisplayStatus(order)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm text-gray-700 border-t border-gray-100 pt-2">
                  <div><strong>Total:</strong> <div>{formatCurrency(order.grandTotal)}</div></div>
                  <div><strong>Balance:</strong> <div>{formatCurrency(order.balance ?? 0)}</div></div>
                  <div><strong>Paid:</strong>
                    {editIndex === idx ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        <input type="number" className="border px-2 py-1 rounded w-20 text-sm" value={editedPayment} onChange={(e) => setEditedPayment(e.target.value)} />
                        <button disabled={isBusy} onClick={() => handleSaveEdit(idx)} className="bg-green-600 text-white px-2 py-1 rounded text-xs">Save</button>
                        <button onClick={handleCancelEdit} className="bg-red-500 text-white px-2 py-1 rounded text-xs">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <span>{formatCurrency(order.paymentMade)}</span>
                        <button onClick={() => handleEdit(idx)} className="btn-action-primary px-2 py-1 text-xs">Edit</button>
                      </div>
                    )}
                  </div>
                  <div><strong>Received:</strong> <div><span className={`px-2 py-0.5 rounded-full text-xs ${RECEIVED_COLORS[getDisplayReceivedStatus(order)] || RECEIVED_COLORS[order.receivedStatus] || "bg-gray-100 text-gray-600"}`}>{getDisplayReceivedStatus(order)}</span></div></div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  {order.receivedStatus !== "Received" && (
                    <>
                      <button onClick={() => handleConfirmReceived(order._id)} className="bg-green-100 text-green-700 px-3 py-1.5 rounded text-xs hover:bg-green-200">Received</button>
                      {isAdmin && <button onClick={() => setDeleteConfirm(order._id)} className="bg-red-100 text-red-600 px-3 py-1.5 rounded text-xs hover:bg-red-200">Delete</button>}
                    </>
                  )}
                </div>
              </div>
            ))}
            {paginatedOrders.length === 0 && (
              <div className="text-center py-8 text-gray-400">No orders found</div>
            )}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 mt-4">
                <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50 text-sm">Prev</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <button key={page} onClick={() => setCurrentPage(page)} className={`px-3 py-1 rounded text-sm border ${page === currentPage ? "theme-toggle-active" : "theme-toggle-neutral"}`}>{page}</button>
                ))}
                <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50 text-sm">Next</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirm Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-6 shadow-2xl max-w-sm mx-4">
            <p className="text-sm text-gray-700 mb-4">Are you sure you want to delete this order?</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Entry Modal */}
      {showQuickEntry && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowQuickEntry(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800">Quick Payment Entry</h2>
              <button onClick={() => setShowQuickEntry(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
            </div>
            <form onSubmit={handleQuickEntrySubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor *</label>
                <select
                  value={quickForm.vendor}
                  onChange={(e) => {
                    const vendorId = e.target.value;
                    const vendor = vendors.find((v) => v._id === vendorId);
                    setQuickForm({ ...quickForm, vendor: vendorId, products: vendor?.mainProduct || "" });
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                >
                  <option value="">Select vendor</option>
                  {vendors.map((v) => (
                    <option key={v._id} value={v._id}>{v.companyName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount *</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={quickForm.amount}
                  onChange={(e) => setQuickForm({ ...quickForm, amount: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter amount"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
                <input
                  type="date"
                  value={quickForm.paymentDate}
                  onChange={(e) => setQuickForm({ ...quickForm, paymentDate: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Main Product</label>
                <input
                  type="text"
                  value={quickForm.products}
                  onChange={(e) => setQuickForm({ ...quickForm, products: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g. Rice"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={quickForm.notes}
                  onChange={(e) => setQuickForm({ ...quickForm, notes: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  rows={2}
                  placeholder="Any additional notes about this payment..."
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowQuickEntry(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={savingQuick} className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white transition ${savingQuick ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700"}`}>
                  {savingQuick ? "Saving..." : "Save Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
