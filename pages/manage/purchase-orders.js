"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import Layout from "@/components/Layout";
import { Loader } from "@/components/ui";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";
import { Plus, X, RefreshCw } from "lucide-react";

const STATUS_COLORS = {
  "Not Paid": "bg-red-100 text-red-700",
  "Partly Paid": "bg-yellow-100 text-yellow-700",
  Paid: "bg-green-100 text-green-700",
  Credit: "bg-purple-100 text-purple-700",
};

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const { isAdmin } = useAuth();

  // Filters
  const [tableFilter, setTableFilter] = useState("all");
  const [paidFilter, setPaidFilter] = useState("tillDate");
  const [vendorFilter, setVendorFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedOrders, setSelectedOrders] = useState(new Set());

  // Quick Entry
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [quickForm, setQuickForm] = useState({
    vendor: "", amount: "", paymentDate: new Date().toISOString().split("T")[0], notes: "", products: "", purpose: "stock-purchase",
  });
  const [savingQuick, setSavingQuick] = useState(false);

  // Inline edit
  const [editIndex, setEditIndex] = useState(null);
  const [editedPayment, setEditedPayment] = useState("");
  const [editedPaymentDate, setEditedPaymentDate] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const entriesPerPage = 15;

  // Sync stock orders
  const [syncingStock, setSyncingStock] = useState(false);

  const toNumber = (v) => {
    const n = Number(String(v ?? 0).replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const getOrderDate = (o) => o?.date || o?.createdAt || o?.paymentDate || null;
  const startOfDay = (d) => { const dt = new Date(d); if (isNaN(dt)) return null; dt.setHours(0, 0, 0, 0); return dt; };

  useEffect(() => { fetchOrders(); fetchVendors(); }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/purchase-orders?limit=500");
      const list = res.data?.orders || res.data;
      setOrders(Array.isArray(list) ? list : []);
    } catch {} finally { setLoading(false); }
  }, []);

  async function fetchVendors() {
    try {
      const res = await apiClient.get("/api/vendors?active=true");
      const data = res.data?.vendors || res.data;
      setVendors(Array.isArray(data) ? data : []);
    } catch {}
  }

  // Derived data
  const overdueOrders = useMemo(() => {
    const today = startOfDay(new Date());
    if (!today) return [];
    return orders.filter((o) => {
      const dStr = getOrderDate(o);
      if (!dStr) return false;
      const dueDate = startOfDay(new Date(dStr));
      if (!dueDate) return false;
      dueDate.setDate(dueDate.getDate() + 14);
      return !["paid", "credit"].includes((o.status || "").toLowerCase()) && dueDate < today;
    });
  }, [orders]);

  const outstandingOrders = useMemo(() =>
    orders.filter((o) => ["not paid", "partly paid"].includes((o.status || "").toLowerCase()) && !o.payBeforeSupply),
  [orders]);

  const creditOrders = useMemo(() =>
    orders.filter((o) => (o.status || "").toLowerCase() === "credit"),
  [orders]);

  const totalOverdueValue = useMemo(() => overdueOrders.reduce((s, o) => s + toNumber(o.balance ?? o.grandTotal), 0), [overdueOrders]);
  const totalOutstanding = useMemo(() => outstandingOrders.reduce((s, o) => s + toNumber(o.balance ?? o.grandTotal), 0), [outstandingOrders]);
  const totalCreditValue = useMemo(() => creditOrders.reduce((s, o) => s + toNumber(Math.abs(o.balance ?? 0)), 0), [creditOrders]);

  const totalPaid = useMemo(() => {
    const valid = ["paid", "partly paid", "credit"];
    let filtered = orders.filter((o) => valid.includes((o.status || "").toLowerCase()));

    // Apply paid filter period
    const now = new Date();
    const todayStart = startOfDay(now);
    if (paidFilter !== "tillDate") {
      filtered = filtered.filter((o) => {
        const d = startOfDay(new Date(getOrderDate(o)));
        if (!d) return false;
        if (paidFilter === "thisWeek") { const ws = new Date(todayStart); ws.setDate(ws.getDate() - ws.getDay()); return d >= ws; }
        if (paidFilter === "lastWeek") { const ws = new Date(todayStart); ws.setDate(ws.getDate() - ws.getDay() - 7); const we = new Date(ws); we.setDate(we.getDate() + 7); return d >= ws && d < we; }
        if (paidFilter === "thisMonth") { return d >= new Date(now.getFullYear(), now.getMonth(), 1); }
        if (paidFilter === "lastMonth") { const ms = new Date(now.getFullYear(), now.getMonth() - 1, 1); const me = new Date(now.getFullYear(), now.getMonth(), 0); return d >= ms && d <= me; }
        return true;
      });
    }
    return filtered.reduce((s, o) => s + toNumber(o.paymentMade), 0);
  }, [orders, paidFilter]);

  const vendorNames = useMemo(() => [...new Set(orders.map((o) => o.vendorName).filter(Boolean))].sort(), [orders]);

  const filteredOrdersForTable = useMemo(() => {
    let list = orders;
    if (tableFilter === "overdue") list = overdueOrders;
    else if (tableFilter === "outstanding") list = outstandingOrders;
    else if (tableFilter === "paid") list = orders.filter((o) => ["paid", "partly paid", "credit"].includes((o.status || "").toLowerCase()));
    if (vendorFilter) list = list.filter((o) => o.vendorName === vendorFilter);
    if (search) { const s = search.toLowerCase(); list = list.filter((o) => o.vendorName?.toLowerCase().includes(s) || o.orderRef?.toLowerCase().includes(s) || (o.products || []).some(p => (p.name || "").toLowerCase().includes(s))); }
    return [...list].sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
  }, [orders, tableFilter, overdueOrders, outstandingOrders, vendorFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredOrdersForTable.length / entriesPerPage));
  const paginatedOrders = filteredOrdersForTable.slice((currentPage - 1) * entriesPerPage, currentPage * entriesPerPage);
  useEffect(() => { setCurrentPage(1); setEditIndex(null); }, [tableFilter, search, vendorFilter]);

  // Quick check total for selected
  const selectedTotal = useMemo(() => {
    return orders.filter((o) => selectedOrders.has(o._id)).reduce((s, o) => s + toNumber(o.grandTotal), 0);
  }, [orders, selectedOrders]);
  const selectedPaidTotal = useMemo(() => {
    return orders.filter((o) => selectedOrders.has(o._id)).reduce((s, o) => s + toNumber(o.paymentMade), 0);
  }, [orders, selectedOrders]);

  // Handlers
  async function handleQuickEntrySubmit(e) {
    e.preventDefault();
    if (!quickForm.vendor || !quickForm.amount) return;
    setSavingQuick(true);
    try {
      const vendor = vendors.find((v) => v._id === quickForm.vendor);
      await apiClient.post("/api/purchase-orders", {
        vendor: quickForm.vendor, vendorName: vendor?.companyName || "", contact: vendor?.repPhone || "",
        reason: quickForm.purpose || "Quick Entry", notes: quickForm.notes, payBeforeSupply: true, date: quickForm.paymentDate,
        purpose: quickForm.purpose,
        products: quickForm.products ? quickForm.products.split(",").map((p) => ({ name: p.trim(), quantity: 1, price: Number(quickForm.amount), total: Number(quickForm.amount) })) : [{ name: quickForm.purpose === "stock-purchase" ? "Stock Purchase" : "Payment Entry", quantity: 1, price: Number(quickForm.amount), total: Number(quickForm.amount) }],
        grandTotal: Number(quickForm.amount), paymentMade: Number(quickForm.amount), paymentDate: quickForm.paymentDate,
      });
      setShowQuickEntry(false);
      setQuickForm({ vendor: "", amount: "", paymentDate: new Date().toISOString().split("T")[0], notes: "", products: "", purpose: "stock-purchase" });
      fetchOrders();
    } catch (err) {
      await showAlertDialog({ title: "Quick entry failed", message: err.response?.data?.error || "Failed", tone: "danger" });
    } finally { setSavingQuick(false); }
  }

  function handleEdit(idx) {
    const order = paginatedOrders[idx];
    setEditIndex(idx);
    setEditedPayment(String(order.paymentMade ?? ""));
    setEditedPaymentDate(order.paymentDate ? new Date(order.paymentDate).toISOString().slice(0, 10) : "");
  }

  async function handleSaveEdit(idx) {
    const order = paginatedOrders[idx];
    const payNum = Number(editedPayment);
    if (!Number.isFinite(payNum) || payNum < 0) return;
    setIsBusy(true);
    try {
      await apiClient.put(`/api/purchase-orders/${order._id}`, {
        action: "update-payment", paymentMade: payNum, paymentDate: editedPaymentDate || new Date().toISOString(),
      });
      setEditIndex(null);
      fetchOrders();
    } catch {} finally { setIsBusy(false); }
  }

  async function handleDelete(id) {
    const confirmed = await showAlertDialog({ title: "Delete Order", message: "Are you sure?", tone: "danger", confirm: "Delete" });
    if (!confirmed) return;
    try { await apiClient.delete(`/api/purchase-orders/${id}`); fetchOrders(); } catch {}
  }

  async function handleSyncStockOrders() {
    setSyncingStock(true);
    try {
      const res = await apiClient.post("/api/purchase-orders/sync-stock-orders");
      const msg = res.data?.message || `Synced ${res.data?.synced || 0} orders`;
      await showAlertDialog({ title: "Sync Complete", message: msg, tone: "info", confirm: "OK" });
      if (res.data?.synced > 0) fetchOrders();
    } catch (err) {
      await showAlertDialog({ title: "Sync Failed", message: err.response?.data?.error || "Failed to sync", tone: "danger" });
    } finally {
      setSyncingStock(false);
    }
  }

  if (loading) return <Layout><Loader /></Layout>;

  return (
    <Layout>
      <div className="page-container">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
            <h1 className="page-title">Vendor Payment Tracker</h1>
            <div className="flex items-center gap-3">
              <button onClick={() => setShowQuickEntry(true)} className="btn-action-primary flex items-center gap-2 text-sm">
                <Plus size={16} /> Quick Entry
              </button>
              <button onClick={handleSyncStockOrders} disabled={syncingStock} className="border border-blue-600 text-blue-600 px-4 py-2 rounded text-sm font-medium hover:bg-blue-50 flex items-center gap-2 disabled:opacity-50">
                <RefreshCw size={16} className={syncingStock ? "animate-spin" : ""} /> {syncingStock ? "Syncing..." : "Sync Stock Orders"}
              </button>
            </div>
          </div>

          {/* Dashboard Cards */}
          <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 w-full mb-6">
            {/* Left: Overdue + Credit */}
            <div className="w-full lg:w-1/2 flex flex-col gap-4">
              {overdueOrders.length > 0 ? (
                <div className="content-card border-l-4 border-red-500">
                  <p className="font-semibold text-red-700 mb-2">⚠️ {overdueOrders.length} Overdue Order{overdueOrders.length > 1 ? "s" : ""}</p>
                  <ul className="list-disc pl-5 space-y-1 mb-3">
                    {overdueOrders.slice(0, 8).map((o, i) => {
                      const d = new Date(getOrderDate(o));
                      const due = new Date(d); due.setDate(due.getDate() + 14);
                      const days = Math.floor((startOfDay(new Date()) - startOfDay(due)) / 86400000);
                      return <li key={o._id ?? i} className="text-xs text-gray-700">{o.vendorName} — {d.toLocaleDateString()} <span className="text-red-600 font-medium">({days} days overdue)</span></li>;
                    })}
                  </ul>
                  <button onClick={() => {
                    const msg = overdueOrders.map(o => `${o.vendorName} — Balance: ${formatCurrency(o.balance ?? o.grandTotal)}`).join("\n");
                    window.open(`https://wa.me/?text=${encodeURIComponent("Payment Reminder:\n\n" + msg)}`, "_blank");
                  }} className="btn-action-primary text-xs px-4 py-2">📨 Send Vendor Reminder</button>
                </div>
              ) : (
                <div className="content-card border-l-4 border-green-500">
                  <p className="text-green-700 text-sm font-medium">✅ No overdue outstanding vendor payments.</p>
                </div>
              )}

              {/* Credit Section - Always show */}
              <div className="content-card border-l-4 border-blue-500">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-semibold text-blue-700">💳 Credit Orders</p>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-bold">
                    {creditOrders.length > 0 ? formatCurrency(totalCreditValue) : "₦0.00"}
                  </span>
                </div>
                {creditOrders.length > 0 ? (
                  <div className="space-y-2">
                    {creditOrders.map((o, i) => (
                      <div key={o._id ?? i} className="flex flex-wrap items-center justify-between text-xs bg-gray-50 px-3 py-2 rounded-lg border">
                        <div><span className="font-medium">{o.vendorName}</span> <span className="text-gray-400 ml-1">{o.date ? new Date(o.date).toLocaleDateString() : ""}</span></div>
                        <div className="flex gap-3">
                          <span>Total: {formatCurrency(o.grandTotal)}</span>
                          <span className="text-green-700">Paid: {formatCurrency(o.paymentMade)}</span>
                          <span className="text-blue-700 font-bold">Credit: {formatCurrency(Math.abs(toNumber(o.balance)))}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-gray-500">No credit orders yet</p>
                    <button onClick={() => setShowQuickEntry(true)} className="text-xs text-blue-600 hover:underline mt-2">+ Add Entry</button>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Stats */}
            <div className="w-full lg:w-1/2 flex flex-col gap-4">
              <div className="bg-emerald-600 text-white p-5 rounded-2xl shadow-lg text-center relative">
                <select value={paidFilter} onChange={(e) => { setPaidFilter(e.target.value); setTableFilter("paid"); }}
                  className="absolute top-3 right-3 text-xs bg-white/20 text-white border border-white/30 rounded-lg px-3 py-1.5 appearance-none cursor-pointer backdrop-blur-sm">
                  <option value="tillDate" className="text-gray-900">Till Date</option>
                  <option value="thisWeek" className="text-gray-900">This Week</option>
                  <option value="lastWeek" className="text-gray-900">Last Week</option>
                  <option value="thisMonth" className="text-gray-900">This Month</option>
                  <option value="lastMonth" className="text-gray-900">Last Month</option>
                </select>
                <p className="text-xs uppercase tracking-wide font-semibold opacity-90 mb-1">Total Paid</p>
                <p className="text-3xl font-bold">{formatCurrency(totalPaid)}</p>
              </div>

              <button onClick={() => { setTableFilter("all"); setVendorFilter(""); setSearch(""); }}
                className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium px-5 py-2.5 rounded-xl shadow transition w-full">Full Table</button>

              <div className="grid grid-cols-2 gap-4">
                <div onClick={() => setTableFilter("overdue")} className="cursor-pointer bg-red-600 text-white p-4 rounded-2xl shadow-lg flex flex-col items-center justify-center min-h-[120px] hover:scale-[1.02] transition">
                  <span className="text-[10px] uppercase tracking-wide opacity-90 border-b border-white/30 pb-1 w-full text-center font-semibold">Overdue</span>
                  <span className="text-xs text-red-200 mt-1">{overdueOrders.length} orders</span>
                  <span className="text-xl font-bold mt-auto">{formatCurrency(totalOverdueValue)}</span>
                </div>
                <div onClick={() => setTableFilter("outstanding")} className="cursor-pointer bg-amber-400 text-gray-900 p-4 rounded-2xl shadow-lg flex flex-col items-center justify-center min-h-[120px] hover:scale-[1.02] transition">
                  <span className="text-[10px] uppercase tracking-wide opacity-90 border-b border-gray-400/30 pb-1 w-full text-center font-semibold">Outstanding</span>
                  <span className="text-xs text-gray-700 mt-1">{outstandingOrders.length} orders</span>
                  <span className="text-xl font-bold mt-auto">{formatCurrency(totalOutstanding)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Selected Quick Check */}
          {selectedOrders.size > 0 && (
            <div className="content-card mb-4 flex flex-wrap items-center gap-4">
              <span className="text-sm font-medium text-gray-700">{selectedOrders.size} selected</span>
              <span className="text-sm">Total: <strong>{formatCurrency(selectedTotal)}</strong></span>
              <span className="text-sm">Paid: <strong className="text-green-700">{formatCurrency(selectedPaidTotal)}</strong></span>
              <button onClick={() => setSelectedOrders(new Set())} className="text-xs text-red-600 hover:underline ml-auto">Clear selection</button>
            </div>
          )}

          {/* Vendor Filter + Search */}
          <div className="content-card mb-4">
            <div className="flex flex-wrap gap-3 items-center">
              <label className="text-sm font-medium text-gray-700">Vendor:</label>
              <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} className="form-select text-sm w-auto">
                <option value="">All vendors</option>
                {vendorNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendor, ref or product..." className="form-input text-sm flex-1 min-w-[180px]" />
            </div>
          </div>

          {/* Table */}
          <div className="content-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-600 text-xs uppercase">
                  <th className="py-3 px-2 w-8">
                    <input type="checkbox" checked={selectedOrders.size === paginatedOrders.length && paginatedOrders.length > 0}
                      onChange={(e) => { if (e.target.checked) setSelectedOrders(new Set(paginatedOrders.map(o => o._id))); else setSelectedOrders(new Set()); }} />
                  </th>
                  <th className="py-3 px-3 text-left">Date</th>
                  <th className="py-3 px-3 text-left">Vendor</th>
                  <th className="py-3 px-3 text-left">Contact</th>
                  <th className="py-3 px-3 text-left">Products</th>
                  <th className="py-3 px-3 text-right">Total</th>
                  <th className="py-3 px-3 text-right">Paid</th>
                  <th className="py-3 px-3 text-left">Pay Date</th>
                  <th className="py-3 px-3 text-right">Balance</th>
                  <th className="py-3 px-3 text-left">Status</th>
                  <th className="py-3 px-3 text-center">Type</th>
                  <th className="py-3 px-3 text-center">Memo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paginatedOrders.map((order, idx) => (
                  <tr key={order._id ?? idx} className="hover:bg-gray-50 transition">
                    <td className="py-3 px-2">
                      <input type="checkbox" checked={selectedOrders.has(order._id)}
                        onChange={(e) => { const n = new Set(selectedOrders); if (e.target.checked) n.add(order._id); else n.delete(order._id); setSelectedOrders(n); }} />
                    </td>
                    <td className="py-3 px-3 text-gray-700 whitespace-nowrap">{order.date ? new Date(order.date).toLocaleDateString() : order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "—"}</td>
                    <td className="py-3 px-3 font-medium text-gray-800">{order.vendorName || "—"}</td>
                    <td className="py-3 px-3 text-xs text-gray-500">{order.contact || "—"}</td>
                    <td className="py-3 px-3 text-xs text-gray-600">{order.products?.[0]?.name || "—"}</td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">{formatCurrency(order.grandTotal)}</td>
                    <td className="py-3 px-3 text-right">
                      {editIndex === idx ? (
                        <div className="flex flex-col items-end gap-1">
                          <input type="number" value={editedPayment} onChange={(e) => setEditedPayment(e.target.value)} className="form-input text-sm w-24 text-right" />
                          <div className="flex gap-1">
                            <button disabled={isBusy} onClick={() => handleSaveEdit(idx)} className="text-[10px] bg-green-600 text-white px-2 py-0.5 rounded">Save</button>
                            <button onClick={() => setEditIndex(null)} className="text-[10px] bg-gray-400 text-white px-2 py-0.5 rounded">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          {formatCurrency(order.paymentMade)}
                          <button onClick={() => handleEdit(idx)} className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded hover:bg-blue-700">Edit</button>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs whitespace-nowrap">
                      {editIndex === idx ? <input type="date" value={editedPaymentDate} onChange={(e) => setEditedPaymentDate(e.target.value)} className="form-input text-xs w-28" /> : (order.paymentDate ? new Date(order.paymentDate).toLocaleDateString() : "—")}
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">{formatCurrency(toNumber(order.grandTotal) - toNumber(order.paymentMade))}</td>
                    <td className="py-3 px-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}>{order.status || "Not Paid"}</span></td>
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={async () => {
                          setIsBusy(true);
                          try {
                            await apiClient.put(`/api/purchase-orders/${order._id}`, { action: "toggle-type", payBeforeSupply: !order.payBeforeSupply });
                            fetchOrders();
                          } catch {} finally { setIsBusy(false); }
                        }}
                        disabled={isBusy}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer hover:opacity-80 transition disabled:opacity-50 ${order.payBeforeSupply ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-500"}`}
                      >
                        {order.payBeforeSupply ? "Pre-Pay" : "Outstanding"}
                      </button>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <a href={`/memo/${order._id}`} target="_blank" rel="noopener noreferrer" className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full hover:bg-blue-200 font-medium">Memo</a>
                    </td>
                  </tr>
                ))}
                {paginatedOrders.length === 0 && <tr><td colSpan="12" className="text-center py-8 text-gray-400">No orders found</td></tr>}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 mt-4 pt-4 border-t border-gray-100">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="px-3 py-1 bg-gray-200 rounded text-sm disabled:opacity-50">Prev</button>
                <span className="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="px-3 py-1 bg-gray-200 rounded text-sm disabled:opacity-50">Next</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Entry Modal */}
      {showQuickEntry && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowQuickEntry(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b"><h2 className="text-lg font-bold">Quick Payment Entry</h2><button onClick={() => setShowQuickEntry(false)}><X size={20} /></button></div>
            <form onSubmit={handleQuickEntrySubmit} className="p-5 space-y-4">
              <div><label className="form-label">Vendor *</label>
                <select value={quickForm.vendor} onChange={(e) => { const v = vendors.find(v => v._id === e.target.value); setQuickForm({ ...quickForm, vendor: e.target.value, products: v?.mainProduct || "" }); }} className="form-select" required>
                  <option value="">Select vendor</option>{vendors.map(v => <option key={v._id} value={v._id}>{v.companyName}</option>)}
                </select></div>
              <div><label className="form-label">Purpose *</label>
                <select value={quickForm.purpose} onChange={(e) => setQuickForm({ ...quickForm, purpose: e.target.value })} className="form-select" required>
                  <option value="stock-purchase">Stock Purchase</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="services">Services</option>
                  <option value="season-greetings">Season Greetings / Packages</option>
                  <option value="dues">Dues / Levies</option>
                  <option value="utilities">Utilities</option>
                  <option value="logistics">Logistics / Delivery</option>
                  <option value="other-expense">Other Expense</option>
                </select></div>
              <div><label className="form-label">Amount *</label><input type="number" value={quickForm.amount} onChange={(e) => setQuickForm({ ...quickForm, amount: e.target.value })} className="form-input" required /></div>
              <div><label className="form-label">Payment Date</label><input type="date" value={quickForm.paymentDate} onChange={(e) => setQuickForm({ ...quickForm, paymentDate: e.target.value })} className="form-input" /></div>
              <div><label className="form-label">Products</label><input type="text" value={quickForm.products} onChange={(e) => setQuickForm({ ...quickForm, products: e.target.value })} className="form-input" placeholder="e.g. Rice, Beans" /></div>
              <div><label className="form-label">Notes</label><textarea value={quickForm.notes} onChange={(e) => setQuickForm({ ...quickForm, notes: e.target.value })} className="form-input" rows={2} /></div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowQuickEntry(false)} className="flex-1 px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button type="submit" disabled={savingQuick} className="flex-1 btn-action-primary">{savingQuick ? "Saving..." : "Save Entry"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
