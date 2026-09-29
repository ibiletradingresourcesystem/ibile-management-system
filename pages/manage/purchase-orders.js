"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Layout from "@/components/Layout";
import { Loader } from "@/components/ui";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";
import SeedDataModal from "@/components/SeedDataModal";
import { amountStoreOwes, deriveVendorCredit } from "@/lib/orderPayments";
import { CASH_PURPOSES, describeCashEntry, findPurpose } from "@/lib/cashEntries";
import { Plus, X, Database, Trash2, ChevronDown, AlertTriangle, CheckCircle2, CreditCard, Mail, MessageCircle, ArrowDownLeft, ArrowUpRight } from "lucide-react";

const STATUS_COLORS = {
  "Not Paid": "bg-red-100 text-red-700",
  "Partly Paid": "bg-yellow-100 text-yellow-700",
  Paid: "bg-green-100 text-green-700",
  Credit: "bg-purple-100 text-purple-700",
};

/** The periods the Total Paid card can be read over. */
const PAID_PERIODS = [
  ["thisMonth", "This Month"],
  ["lastMonth", "Last Month"],
  ["thisWeek", "This Week"],
  ["lastWeek", "Last Week"],
  ["tillDate", "Till Date"],
];

/**
 * The period pill on the Total Paid card.
 *
 * A native select cannot be styled through its open state: the browser paints the
 * control with the system background while the list is down, which turned the
 * white label invisible on the green card. The menu is ours, so both states are
 * readable — and it still closes on Escape, on a click outside, and on a choice.
 */
function PeriodPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const label = PAID_PERIODS.find(([key]) => key === value)?.[1] || "This Month";

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((isOpen) => !isOpen)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Period for total paid"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-white/20 hover:bg-white/30 border border-white/40 rounded-full px-3 py-1 transition focus:outline-none focus:ring-2 focus:ring-white/70"
      >
        {label}
        <ChevronDown size={12} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute left-1/2 -translate-x-1/2 mt-1 z-20 w-36 bg-white text-gray-800 rounded-xl shadow-xl border border-gray-200 overflow-hidden py-1"
        >
          {PAID_PERIODS.map(([key, text]) => (
            <li key={key}>
              <button
                type="button"
                role="option"
                aria-selected={key === value}
                onClick={() => { onChange(key); setOpen(false); }}
                className={`w-full text-left text-xs px-3 py-2 transition hover:bg-gray-100 ${
                  key === value ? "bg-emerald-50 text-emerald-700 font-semibold" : ""
                }`}
              >
                {text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const { isAdmin } = useAuth();

  // Filters
  const [tableFilter, setTableFilter] = useState("all");
  // This month is what anyone opening the tracker is asking about; the whole
  // history is one pick away.
  const [paidFilter, setPaidFilter] = useState("thisMonth");
  const [vendorFilter, setVendorFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedOrders, setSelectedOrders] = useState(new Set());

  // Stable toggle handler — avoids glitch from inline Set creation
  const toggleCheck = (id) => {
    setSelectedOrders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Quick Entry
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [quickForm, setQuickForm] = useState({
    vendor: "", party: "", amount: "", paymentDate: new Date().toISOString().split("T")[0], notes: "", products: "", purpose: "vendor-payment",
  });
  // What the money was for decides which way it runs and where it lands.
  const quickPurpose = findPurpose(quickForm.purpose) || CASH_PURPOSES[0];
  const [savingQuick, setSavingQuick] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [cashEntries, setCashEntries] = useState([]);

  // Inline edit
  const [editIndex, setEditIndex] = useState(null);
  const [editedPayment, setEditedPayment] = useState("");
  const [editedPaymentDate, setEditedPaymentDate] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const entriesPerPage = 15;

  // Seeding from the expense app
  const [showSeed, setShowSeed] = useState(false);

  const toNumber = (v) => {
    const n = Number(String(v ?? 0).replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const getOrderDate = (o) => o?.date || o?.createdAt || o?.paymentDate || null;
  // What was paid in a period is dated by the payment, not by when the order was
  // raised: a January order settled in March is March money.
  const getPaymentDate = (o) => o?.paymentDate || o?.date || o?.createdAt || null;
  const startOfDay = (d) => { const dt = new Date(d); if (isNaN(dt)) return null; dt.setHours(0, 0, 0, 0); return dt; };

  useEffect(() => { fetchOrders(); fetchVendors(); fetchCashEntries(); }, []);

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

  // A credit is store money the vendor is holding: an overpayment, or an order
  // settled up front that has not been delivered. The saved figure is used where
  // there is one, and worked out from the order where an older record has none —
  // which is what makes orders written before this rule show up at all.
  const creditOn = (order) => toNumber(order?.vendorCredit) || deriveVendorCredit(order || {});

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

  const creditOrders = useMemo(
    () => orders.filter((o) => creditOn(o) > 0),
    [orders]
  );

  // An order still owed for: what is left to pay, never a credit read as a debt.
  const totalOverdueValue = useMemo(() => overdueOrders.reduce((s, o) => s + amountStoreOwes(o), 0), [overdueOrders]);
  const totalOutstanding = useMemo(() => outstandingOrders.reduce((s, o) => s + amountStoreOwes(o), 0), [outstandingOrders]);
  const totalCreditValue = useMemo(() => creditOrders.reduce((s, o) => s + creditOn(o), 0), [creditOrders]);

  const paidSummary = useMemo(() => {
    // Anything with money against it, whatever the order is labelled.
    let filtered = orders.filter((o) => toNumber(o.paymentMade) > 0);

    // Apply paid filter period
    const now = new Date();
    const todayStart = startOfDay(now);
    if (paidFilter !== "tillDate") {
      filtered = filtered.filter((o) => {
        const d = startOfDay(new Date(getPaymentDate(o)));
        if (!d) return false;
        if (paidFilter === "thisWeek") { const ws = new Date(todayStart); ws.setDate(ws.getDate() - ws.getDay()); return d >= ws; }
        if (paidFilter === "lastWeek") { const ws = new Date(todayStart); ws.setDate(ws.getDate() - ws.getDay() - 7); const we = new Date(ws); we.setDate(we.getDate() + 7); return d >= ws && d < we; }
        if (paidFilter === "thisMonth") { return d >= new Date(now.getFullYear(), now.getMonth(), 1); }
        if (paidFilter === "lastMonth") { const ms = new Date(now.getFullYear(), now.getMonth() - 1, 1); const me = new Date(now.getFullYear(), now.getMonth(), 0); return d >= ms && d <= me; }
        return true;
      });
    }
    return {
      total: filtered.reduce((s, o) => s + toNumber(o.paymentMade), 0),
      count: filtered.length,
      // The very rows that were counted, so the table can show them.
      orders: filtered,
    };
  }, [orders, paidFilter]);

  const vendorNames = useMemo(() => [...new Set(orders.map((o) => o.vendorName).filter(Boolean))].sort(), [orders]);

  const filteredOrdersForTable = useMemo(() => {
    let list = orders;
    if (tableFilter === "overdue") list = overdueOrders;
    else if (tableFilter === "outstanding") list = outstandingOrders;
    else if (tableFilter === "paid") list = paidSummary.orders;
    if (vendorFilter) list = list.filter((o) => o.vendorName === vendorFilter);
    if (search) { const s = search.toLowerCase(); list = list.filter((o) => o.vendorName?.toLowerCase().includes(s) || o.orderRef?.toLowerCase().includes(s) || (o.products || []).some(p => (p.name || "").toLowerCase().includes(s))); }
    return [...list].sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0));
  }, [orders, tableFilter, overdueOrders, outstandingOrders, paidSummary, vendorFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredOrdersForTable.length / entriesPerPage));
  const paginatedOrders = filteredOrdersForTable.slice((currentPage - 1) * entriesPerPage, currentPage * entriesPerPage);
  useEffect(() => { setCurrentPage(1); setEditIndex(null); }, [tableFilter, search, vendorFilter]);

  const allFilteredSelected = filteredOrdersForTable.length > 0 && filteredOrdersForTable.every((o) => selectedOrders.has(o._id));
  const someFilteredSelected = filteredOrdersForTable.some((o) => selectedOrders.has(o._id));

  // Quick check total for selected
  const selectedTotal = useMemo(() => {
    if (selectedOrders.size === 0) return 0;
    return orders.filter((o) => selectedOrders.has(o._id)).reduce((s, o) => s + toNumber(o.grandTotal), 0);
  }, [orders, selectedOrders]);
  const selectedPaidTotal = useMemo(() => {
    if (selectedOrders.size === 0) return 0;
    return orders.filter((o) => selectedOrders.has(o._id)).reduce((s, o) => s + toNumber(o.paymentMade), 0);
  }, [orders, selectedOrders]);
  const selectedBalance = selectedTotal - selectedPaidTotal;

  /** The money in and out that never belonged to a vendor order. */
  const fetchCashEntries = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/cash-entries?limit=12");
      setCashEntries(res.data.entries || []);
    } catch {
      // The tracker is still usable without this list.
    }
  }, []);

  // Handlers
  /** Mail the overdue list to whoever watches the money. */
  async function handleSendReminder() {
    setSendingReminder(true);
    try {
      const { data } = await apiClient.post("/api/purchase-orders/reminder");
      await showAlertDialog({
        title: data.sent ? "Reminder sent" : "Nothing to send",
        message: data.message || "",
        tone: data.sent ? "success" : "info",
      });
    } catch (err) {
      await showAlertDialog({
        title: "Reminder not sent",
        message: err.response?.data?.error || err.message || "The reminder could not be sent.",
        tone: "danger",
      });
    } finally {
      setSendingReminder(false);
    }
  }

  /** The same list, handed to WhatsApp for whoever prefers to send it there. */
  function handleShareReminder() {
    const lines = overdueOrders.map(
      (o) => `• ${o.vendorName} — ${formatCurrency(amountStoreOwes(o) || toNumber(o.grandTotal), { minimumFractionDigits: 0, maximumFractionDigits: 0 })} outstanding`
    );
    const text = ["Vendor payments due", "", ...lines].join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function resetQuickForm() {
    setQuickForm({
      vendor: "", party: "", amount: "", paymentDate: new Date().toISOString().split("T")[0],
      notes: "", products: "", purpose: "vendor-payment",
    });
  }

  async function handleQuickEntrySubmit(e) {
    e.preventDefault();
    if (!quickForm.amount) return;
    if (quickPurpose.needsVendor && !quickForm.vendor) return;

    setSavingQuick(true);
    try {
      if (quickPurpose.needsVendor) {
        // A vendor payment is still an order, paid up front and in full.
        const vendor = vendors.find((v) => v._id === quickForm.vendor);
        const lines = quickForm.products
          ? quickForm.products.split(",").map((name) => ({ name: name.trim(), quantity: 1, price: Number(quickForm.amount), total: Number(quickForm.amount) }))
          : [{ name: "Payment Entry", quantity: 1, price: Number(quickForm.amount), total: Number(quickForm.amount) }];

        await apiClient.post("/api/purchase-orders", {
          vendor: quickForm.vendor, vendorName: vendor?.companyName || "", contact: vendor?.repPhone || "",
          reason: "Quick Entry", notes: quickForm.notes, payBeforeSupply: true, date: quickForm.paymentDate,
          products: lines,
          grandTotal: Number(quickForm.amount), paymentMade: Number(quickForm.amount), paymentDate: quickForm.paymentDate,
        });
        fetchOrders();
      } else {
        // Everything else is money moving on its own account.
        const { data } = await apiClient.post("/api/cash-entries", {
          purpose: quickForm.purpose,
          party: quickForm.party,
          amount: Number(quickForm.amount),
          date: quickForm.paymentDate,
          notes: quickForm.notes,
        });
        fetchCashEntries();
        if (data && data.posted === false) {
          await showAlertDialog({
            title: "Recorded, but not posted",
            message: "The entry was saved. It could not be written to the books — run Sync Accounting once the chart of accounts is set up.",
            tone: "warning",
          });
        }
      }

      setShowQuickEntry(false);
      resetQuickForm();
    } catch (err) {
      await showAlertDialog({ title: "Quick entry failed", message: err.response?.data?.error || "Failed", tone: "danger" });
    } finally { setSavingQuick(false); }
  }

  async function handleDeleteCashEntry(entry) {
    const confirmed = await showConfirmDialog({
      title: "Delete this entry?",
      message: `${describeCashEntry(entry)} — ${formatCurrency(entry.amount)}. The books are corrected with it.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await apiClient.delete(`/api/cash-entries/${entry._id}`);
      fetchCashEntries();
    } catch (err) {
      await showAlertDialog({
        title: "Could not delete",
        message: err.response?.data?.error || "The entry could not be deleted.",
        tone: "danger",
      });
    }
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

  // showAlertDialog only ever returns an acknowledgement, so the old delete here ran
  // whatever the person pressed. A delete has to ask with a confirm dialog.
  async function handleDelete(order) {
    const confirmed = await showConfirmDialog({
      title: "Delete this order?",
      message: `${order.vendorName || "This order"} — ${formatCurrency(order.grandTotal)}${order.receivedStatus === "Received" ? ". It has already been received; the stock it added stays." : "."} This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!confirmed) return;
    setIsBusy(true);
    try {
      await apiClient.delete(`/api/purchase-orders/${order._id}`);
      setSelectedOrders((prev) => { const next = new Set(prev); next.delete(order._id); return next; });
      fetchOrders();
    } catch (err) {
      await showAlertDialog({ title: "Could not delete", message: err.response?.data?.error || "Failed to delete the order.", tone: "danger" });
    } finally { setIsBusy(false); }
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
              <button onClick={() => setShowQuickEntry(true)} className="btn-action btn-action-primary flex items-center gap-2">
                <Plus size={16} /> Quick Entry
              </button>
              {isAdmin && (
                <button onClick={() => setShowSeed(true)} className="btn-action btn-action-secondary flex items-center gap-2">
                  <Database size={16} /> Seed Data
                </button>
              )}
            </div>
          </div>

          {/* Dashboard Cards */}
          <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 w-full mb-6">
            {/* Left: Overdue + Credit */}
            <div className="w-full lg:w-1/2 flex flex-col gap-4">
              {overdueOrders.length > 0 ? (
                <div className="content-card border-l-4 border-red-500">
                  <p className="font-semibold text-red-700 mb-2 flex items-center gap-2">
                    <AlertTriangle size={16} />
                    {overdueOrders.length} Overdue Order{overdueOrders.length > 1 ? "s" : ""}
                  </p>
                  <ul className="list-disc pl-5 space-y-1 mb-3">
                    {overdueOrders.slice(0, 8).map((o, i) => {
                      const d = new Date(getOrderDate(o));
                      const due = new Date(d); due.setDate(due.getDate() + 14);
                      const days = Math.floor((startOfDay(new Date()) - startOfDay(due)) / 86400000);
                      return <li key={o._id ?? i} className="text-xs text-gray-700">{o.vendorName} — {d.toLocaleDateString()} <span className="text-red-600 font-medium">({days} days overdue)</span></li>;
                    })}
                  </ul>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleSendReminder}
                      disabled={sendingReminder}
                      className="btn-action btn-action-primary btn-sm inline-flex items-center gap-2 disabled:opacity-50"
                    >
                      <Mail size={14} />
                      {sendingReminder ? "Sending…" : "Email Vendor Reminder"}
                    </button>
                    <button
                      onClick={handleShareReminder}
                      className="btn-action btn-action-secondary btn-sm inline-flex items-center gap-2"
                      title="Open the same list in WhatsApp"
                    >
                      <MessageCircle size={14} />
                      WhatsApp
                    </button>
                  </div>
                </div>
              ) : (
                <div className="content-card border-l-4 border-green-500">
                  <p className="text-green-700 text-sm font-medium flex items-center gap-2">
                    <CheckCircle2 size={16} />
                    No overdue outstanding vendor payments.
                  </p>
                </div>
              )}

              {/* Credit Section - Always show */}
              <div className="content-card border-l-4 border-blue-500">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-semibold text-blue-700 flex items-center gap-2">
                    <CreditCard size={16} />
                    Credit Orders
                  </p>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-bold">
                    {creditOrders.length > 0 ? formatCurrency(totalCreditValue, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "₦0"}
                  </span>
                </div>
                {creditOrders.length > 0 ? (
                  <div className="space-y-2">
                    {creditOrders.map((o, i) => (
                      <div key={o._id ?? i} className="flex flex-wrap items-center justify-between text-xs bg-gray-50 px-3 py-2 rounded-lg border">
                        <div className="min-w-0">
                          <span className="font-medium">{o.vendorName}</span>
                          <span className="text-gray-400 ml-1">{o.date ? new Date(o.date).toLocaleDateString() : ""}</span>
                        </div>
                        <div className="flex gap-3">
                          <span>Total: {formatCurrency(o.grandTotal)}</span>
                          <span className="text-green-700">Paid: {formatCurrency(o.paymentMade)}</span>
                          <span className="text-blue-700 font-bold" title="The vendor owes the store this much">
                            Credit: {formatCurrency(creditOn(o))}
                          </span>
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
              {/* Period pill on top, the label under it, the figure below — and the
                  figure in whole naira, because tens of millions with kobo on the end
                  ran past the edge of the card. */}
              <div className="bg-gradient-to-br from-emerald-500 to-green-600 text-white p-5 rounded-2xl shadow-lg text-center">
                <PeriodPicker
                  value={paidFilter}
                  onChange={(next) => { setPaidFilter(next); setTableFilter("paid"); }}
                />

                <p className="mt-3 text-xs uppercase tracking-widest font-semibold opacity-90">Total Paid</p>
                <p
                  className="mt-1 font-bold tabular-nums leading-none text-2xl sm:text-3xl"
                  title={formatCurrency(paidSummary.total)}
                >
                  {formatCurrency(paidSummary.total, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </p>
                <p className="mt-2 text-[11px] opacity-80">
                  {paidSummary.count} {paidSummary.count === 1 ? "order" : "orders"}
                </p>
              </div>

              <button onClick={() => { setTableFilter("all"); setVendorFilter(""); setSearch(""); }}
                className="btn-action btn-action-secondary w-full">Full Table</button>

              <div className="grid grid-cols-2 gap-4">
                <div onClick={() => setTableFilter("overdue")} className="cursor-pointer bg-red-600 text-white p-4 rounded-2xl shadow-lg flex flex-col items-center justify-center min-h-[120px] hover:scale-[1.02] transition">
                  <span className="text-[10px] uppercase tracking-wide opacity-90 border-b border-white/30 pb-1 w-full text-center font-semibold">Overdue</span>
                  <span className="text-xs text-red-200 mt-1">{overdueOrders.length} orders</span>
                  <span className="text-lg sm:text-xl font-bold mt-auto tabular-nums" title={formatCurrency(totalOverdueValue)}>{formatCurrency(totalOverdueValue, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                </div>
                <div onClick={() => setTableFilter("outstanding")} className="cursor-pointer bg-amber-400 text-gray-900 p-4 rounded-2xl shadow-lg flex flex-col items-center justify-center min-h-[120px] hover:scale-[1.02] transition">
                  <span className="text-[10px] uppercase tracking-wide opacity-90 border-b border-gray-400/30 pb-1 w-full text-center font-semibold">Outstanding</span>
                  <span className="text-xs text-gray-700 mt-1">{outstandingOrders.length} orders</span>
                  <span className="text-lg sm:text-xl font-bold mt-auto tabular-nums" title={formatCurrency(totalOutstanding)}>{formatCurrency(totalOutstanding, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                </div>
              </div>
            </div>
          </div>

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
          <div className="data-table-container">
            <table className="data-table text-sm">
              <thead>
                <tr>
                  <th className="w-8 text-center">
                    {/* Ticks every order the filters leave, not just the page on screen —
                        the totals below are only useful over the whole set. */}
                    <input type="checkbox" aria-label="Select all matching orders"
                      ref={(el) => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected; }}
                      checked={allFilteredSelected}
                      onChange={(e) => { setSelectedOrders((prev) => { const next = new Set(prev); filteredOrdersForTable.forEach(o => { if (e.target.checked) next.add(o._id); else next.delete(o._id); }); return next; }); }} />
                  </th>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th>Contact</th>
                  <th>Products</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Paid</th>
                  <th>Pay Date</th>
                  <th className="text-right">Balance</th>
                  <th className="text-center">Status</th>
                  <th className="text-center">Type</th>
                  <th className="text-center">Memo</th>
                  <th className="text-center">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paginatedOrders.map((order, idx) => (
                  <tr key={order._id ?? idx} className="align-middle hover:bg-gray-50 transition">
                    <td className="text-center">
                      <input type="checkbox" checked={selectedOrders.has(order._id)}
                        onChange={() => toggleCheck(order._id)} />
                    </td>
                    <td className="text-gray-700 whitespace-nowrap">{order.date ? new Date(order.date).toLocaleDateString() : order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "—"}</td>
                    <td className="font-medium text-gray-800">{order.vendorName || "—"}</td>
                    <td className="text-xs text-gray-500">{order.contact || "—"}</td>
                    <td className="text-xs text-gray-600 max-w-[16rem] truncate" title={order.products?.[0]?.name || ""}>{order.products?.[0]?.name || "—"}</td>
                    <td className="text-right whitespace-nowrap tabular-nums">{formatCurrency(order.grandTotal)}</td>
                    <td className="text-right whitespace-nowrap tabular-nums">
                      {editIndex === idx ? (
                        <div className="flex flex-col items-end gap-1">
                          <input type="number" value={editedPayment} onChange={(e) => setEditedPayment(e.target.value)} className="form-input text-sm w-24 text-right" />
                          <div className="flex gap-2">
                            <button disabled={isBusy} onClick={() => handleSaveEdit(idx)} className="btn-action btn-action-success btn-xs disabled:opacity-50">Save</button>
                            <button onClick={() => setEditIndex(null)} className="btn-action btn-action-secondary btn-xs">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-2">
                          {formatCurrency(order.paymentMade)}
                          <button onClick={() => handleEdit(idx)} className="btn-action btn-action-secondary btn-xs">Edit</button>
                        </span>
                      )}
                    </td>
                    <td className="text-xs whitespace-nowrap">
                      {editIndex === idx ? <input type="date" value={editedPaymentDate} onChange={(e) => setEditedPaymentDate(e.target.value)} className="form-input text-xs w-28" /> : (order.paymentDate ? new Date(order.paymentDate).toLocaleDateString() : "—")}
                    </td>
                    <td className="text-right whitespace-nowrap tabular-nums">
                      {(() => {
                        const credit = creditOn(order);
                        if (credit > 0) {
                          return (
                            <span className="text-blue-700 font-semibold" title="The vendor owes the store this much">
                              Credit {formatCurrency(credit)}
                            </span>
                          );
                        }
                        const owed = amountStoreOwes(order);
                        return owed > 0 ? formatCurrency(owed) : <span className="text-gray-400">—</span>;
                      })()}
                    </td>
                    <td className="text-center"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${STATUS_COLORS[order.status] || "bg-gray-100 text-gray-700"}`}>{order.status || "Not Paid"}</span></td>
                    <td className="text-center">
                      <button
                        onClick={async () => {
                          setIsBusy(true);
                          try {
                            await apiClient.put(`/api/purchase-orders/${order._id}`, { action: "toggle-type", payBeforeSupply: !order.payBeforeSupply });
                            fetchOrders();
                          } catch {} finally { setIsBusy(false); }
                        }}
                        disabled={isBusy}
                        title="Switch between paying the vendor up front and paying after supply"
                        className={`btn-action btn-xs whitespace-nowrap disabled:opacity-50 ${
                          order.payBeforeSupply
                            ? "bg-purple-100 text-purple-700 hover:bg-purple-200 focus:ring-purple-300"
                            : "btn-action-secondary"
                        }`}
                      >
                        {order.payBeforeSupply ? "Pre-Pay" : "Outstanding"}
                      </button>
                    </td>
                    <td className="text-center">
                      <a href={`/memo/${order._id}`} target="_blank" rel="noopener noreferrer" className="btn-action btn-action-secondary btn-xs inline-block">Memo</a>
                    </td>
                    <td className="text-center">
                      <button onClick={() => handleDelete(order)} disabled={isBusy}
                        aria-label={`Delete order for ${order.vendorName || "vendor"}`}
                        className="btn-action btn-action-danger btn-xs inline-flex items-center justify-center disabled:opacity-50">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {paginatedOrders.length === 0 && <tr><td colSpan="13" className="text-center text-gray-400 py-8">No orders found</td></tr>}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 mt-4 pt-4 border-t border-gray-100">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="btn-action btn-action-secondary btn-xs disabled:opacity-40">Prev</button>
                <span className="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="btn-action btn-action-secondary btn-xs disabled:opacity-40">Next</button>
              </div>
            )}

            {/* Floating Selected Summary Pill — fixed at bottom of screen */}
            {selectedOrders.size > 0 && (
              <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-50 bg-white border border-blue-200 rounded-2xl shadow-2xl px-4 sm:px-5 py-3 flex flex-wrap items-center gap-3 sm:gap-5 w-[calc(100vw-1rem)] sm:w-auto max-w-[95vw]" style={{ animation: 'slideUp 0.3s ease-out' }}>
                <div className="text-sm font-medium text-gray-600">
                  <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">{selectedOrders.size}</span>{" "}
                  selected
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <div className="text-center"><div className="text-xs text-gray-400 uppercase">Total</div><div className="font-bold text-blue-700">{formatCurrency(selectedTotal)}</div></div>
                  <div className="text-center"><div className="text-xs text-gray-400 uppercase">Paid</div><div className="font-bold text-green-600">{formatCurrency(selectedPaidTotal)}</div></div>
                  <div className="text-center"><div className="text-xs text-gray-400 uppercase">Balance</div><div className="font-bold text-red-600">{formatCurrency(selectedBalance)}</div></div>
                </div>
                <button onClick={() => setSelectedOrders(new Set())} className="btn-action btn-action-secondary btn-xs">Clear</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showSeed && <SeedDataModal onClose={() => setShowSeed(false)} onImported={fetchOrders} />}

      {/* Quick Entry Modal */}
      {showQuickEntry && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowQuickEntry(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="text-lg font-bold">Quick Money Entry</h2>
              <button onClick={() => setShowQuickEntry(false)} aria-label="Close"><X size={20} /></button>
            </div>
            <form onSubmit={handleQuickEntrySubmit} className="p-5 space-y-4">
              {/* What it was for comes first: it decides which way the money runs,
                  who the entry names, and where it lands in the books. */}
              <div>
                <label className="form-label">What was this for? *</label>
                <select
                  value={quickForm.purpose}
                  onChange={(e) => setQuickForm({ ...quickForm, purpose: e.target.value })}
                  className="form-select"
                  required
                >
                  <optgroup label="Money out">
                    {CASH_PURPOSES.filter((p) => p.direction === "out").map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Money in">
                    {CASH_PURPOSES.filter((p) => p.direction === "in").map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </optgroup>
                </select>
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-gray-500">
                  {quickPurpose.direction === "in"
                    ? <ArrowDownLeft size={13} className="mt-0.5 flex-shrink-0 text-green-600" />
                    : <ArrowUpRight size={13} className="mt-0.5 flex-shrink-0 text-red-500" />}
                  <span>{quickPurpose.hint}</span>
                </p>
              </div>

              {quickPurpose.needsVendor ? (
                <div>
                  <label className="form-label">Vendor *</label>
                  <select
                    value={quickForm.vendor}
                    onChange={(e) => { const v = vendors.find((vendor) => vendor._id === e.target.value); setQuickForm({ ...quickForm, vendor: e.target.value, products: v?.mainProduct || "" }); }}
                    className="form-select"
                    required
                  >
                    <option value="">Select vendor</option>
                    {vendors.map((v) => <option key={v._id} value={v._id}>{v.companyName}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="form-label">{quickPurpose.direction === "in" ? "Received from" : "Paid to"}</label>
                  <input
                    type="text"
                    value={quickForm.party}
                    onChange={(e) => setQuickForm({ ...quickForm, party: e.target.value })}
                    className="form-input"
                    placeholder={quickPurpose.defaultParty || "Name of the person or business"}
                  />
                </div>
              )}

              <div>
                <label className="form-label">Amount *</label>
                <input type="number" min="0" step="0.01" value={quickForm.amount} onChange={(e) => setQuickForm({ ...quickForm, amount: e.target.value })} className="form-input" required />
              </div>
              <div>
                <label className="form-label">Date</label>
                <input type="date" value={quickForm.paymentDate} onChange={(e) => setQuickForm({ ...quickForm, paymentDate: e.target.value })} className="form-input" />
              </div>
              {quickPurpose.needsVendor && (
                <div>
                  <label className="form-label">Products</label>
                  <input type="text" value={quickForm.products} onChange={(e) => setQuickForm({ ...quickForm, products: e.target.value })} className="form-input" placeholder="e.g. Rice, Beans" />
                </div>
              )}
              <div>
                <label className="form-label">Notes</label>
                <textarea value={quickForm.notes} onChange={(e) => setQuickForm({ ...quickForm, notes: e.target.value })} className="form-input" rows={2} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowQuickEntry(false); resetQuickForm(); }} className="flex-1 btn-action btn-action-secondary">Cancel</button>
                <button type="submit" disabled={savingQuick} className="flex-1 btn-action btn-action-primary disabled:opacity-50">{savingQuick ? "Saving..." : "Save Entry"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
