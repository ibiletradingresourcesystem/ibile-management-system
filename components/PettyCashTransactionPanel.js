import { useState, useEffect, useCallback, useMemo } from "react";
import { PERIOD_OPTIONS, periodLabel, periodRange } from "@/lib/periodFilter";
import { apiClient } from "@/lib/api-client";
import { CheckCircle } from "lucide-react";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { useAuth } from "@/lib/useAuth";

function formatCurrency(val) {
  return `₦${Number(val || 0).toLocaleString("en-NG")}`;
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStatusBadgeClass(status) {
  switch (status) {
    case "Ordered":
      return "bg-blue-100 text-blue-800";
    case "Pending Approval":
      return "bg-yellow-100 text-yellow-800";
    case "Approved":
      return "bg-green-100 text-green-800";
    case "Received":
      return "bg-cyan-100 text-cyan-800";
    case "Paid":
      return "bg-emerald-100 text-emerald-800";
    case "Cancelled":
      return "bg-red-100 text-red-700";
    case "Rejected":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function toDateInputValue(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toISOString().split("T")[0];
}

function escapeCsvValue(val) {
  const str = String(val ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * A vendor price-list row as an order line. The link to the catalogue product is
 * carried through, so ordering something the vendor is already linked to reuses that
 * product instead of creating another one under a slightly different name.
 */
function toOrderLine(row) {
  const linked = row?.product?._id || row?.product || row?.productId || "";
  return {
    productId: linked ? String(linked) : "",
    productName: row?.productName || row?.name || "",
    quantity: 1,
    costPrice: Number(row?.price) || 0,
  };
}

export default function PettyCashTransactionPanel({
  vendors = [],
  currentLocation = "",
  locations = [],
  onTransactionChange,
  prefillVendor = null,
  onPrefillConsumed,
}) {
  const { user } = useAuth();
  // Deleting undoes an order, its stock and its expense: managers and admins only, as the API holds
  const canDelete = ["admin", "manager"].includes(String(user?.role || "").toLowerCase());
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("active"); // active | paid | cancelled
  const [filterVendor, setFilterVendor] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  // Paid orders are read a period at a time; this month is what is usually asked for. "custom"
  // takes the two dates below. The server sends only what was paid in the period.
  const [paidPeriod, setPaidPeriod] = useState("thisMonth");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [paidCountAllTime, setPaidCountAllTime] = useState(null);

  // The window paid orders are read over: [from, to), or none for till date
  const paidRange = useMemo(() => {
    if (paidPeriod !== "custom") return periodRange(paidPeriod);
    if (!customFrom && !customTo) return null;
    const from = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
    const to = customTo ? new Date(`${customTo}T00:00:00`) : null;
    if (to) to.setDate(to.getDate() + 1); // the whole of the last day
    return { from, to };
  }, [paidPeriod, customFrom, customTo]);
  const paidRangeLabel =
    paidPeriod !== "custom"
      ? periodLabel(paidPeriod)
      : customFrom || customTo
        ? `${customFrom ? formatDate(customFrom) : "…"} – ${customTo ? formatDate(customTo) : "today"}`
        : "Till Date";

  // Order form state
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    vendor: "",
    products: [], // [{productName, costPrice, quantity}]
    description: "",
    location: currentLocation || "",
    requestDate: new Date().toISOString().split("T")[0],
    neededBy: "",
  });
  const [submitting, setSubmitting] = useState(false);

  // Send to vendor dialog
  const [sendDialog, setSendDialog] = useState(null); // { vendorName, phone, email, orderSummary }

  // Sync location when it becomes available
  useEffect(() => {
    if (currentLocation) {
      setFormData((prev) => prev.location ? prev : { ...prev, location: currentLocation });
    }
  }, [currentLocation]);

  // Auto-open form when prefillVendor is set
  useEffect(() => {
    if (prefillVendor) {
      const vendorProducts = (prefillVendor.products || []).map(toOrderLine);
      setFormData({
        vendor: prefillVendor._id,
        products: vendorProducts.length > 0 ? vendorProducts : [{ productName: "", quantity: 1, costPrice: 0 }],
        description: "",
        location: currentLocation || "",
        requestDate: new Date().toISOString().split("T")[0],
        neededBy: "",
      });
      setShowForm(true);
      onPrefillConsumed?.();
    }
  }, [prefillVendor]);

  // Edit state
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterVendor) params.vendorId = filterVendor;
      if (filterStatus) params.status = filterStatus;
      if (currentLocation) params.location = currentLocation;
      if (paidRange?.from) params.paidFrom = paidRange.from.toISOString();
      if (paidRange?.to) params.paidTo = paidRange.to.toISOString();

      const { data } = await apiClient.get("/api/petty-cash-transactions", { params });
      setTransactions(data.transactions || []);
      setPaidCountAllTime(typeof data.paidCountAllTime === "number" ? data.paidCountAllTime : null);
    } catch (err) {
      console.error("Failed to load transactions:", err);
    } finally {
      setLoading(false);
    }
  }, [filterVendor, filterStatus, currentLocation, paidRange]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index, field, value) => {
    setFormData((prev) => {
      const products = [...prev.products];
      const next = { ...products[index], [field]: field === "productName" ? value : Number(value) || 0 };
      // Renaming a line means it is no longer the product that was picked from the
      // vendor's list, so the link goes with it.
      if (field === "productName" && value !== products[index].productName) next.productId = "";
      products[index] = next;
      return { ...prev, products };
    });
  };

  const addItem = () => {
    setFormData((prev) => ({
      ...prev,
      products: [...prev.products, { productId: "", productName: "", quantity: 1, costPrice: 0 }],
    }));
  };

  const removeItem = (index) => {
    setFormData((prev) => ({
      ...prev,
      products: prev.products.filter((_, i) => i !== index),
    }));
  };

  const calculateOrderAmount = () => {
    return formData.products.reduce((s, product) => s + (Number(product.costPrice || 0) * Number(product.quantity || 1)), 0);
  };

  const orderTotal = calculateOrderAmount();

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validProducts = formData.products.filter(p => p.productName?.trim() && p.costPrice > 0 && p.quantity > 0);
    if (!validProducts.length) return alert("Add at least one product with name, cost price, and quantity");
    setSubmitting(true);
    try {
      const purpose = validProducts.map(p => `${p.productName} x${p.quantity}`).join(", ");
      const payload = {
        vendor: formData.vendor,
        purpose,
        description: formData.description,
        quantity: 1,
        unitPrice: orderTotal,
        amount: orderTotal,
        location: formData.location,
        requestDate: formData.requestDate,
        neededBy: formData.neededBy || undefined,
        products: validProducts, // names, quantities and the links to system products
      };

      try {
        await apiClient.post("/api/petty-cash-transactions", payload);
      } catch (err) {
        const data = err.response?.data;
        // Something on the order is not in the catalogue. An administrator can add it
        // from here; anyone else is told who can.
        if (!data?.unknownProducts?.length) throw err;
        if (!data.canConfirm) {
          await showAlertDialog({
            title: "Product not in the system",
            message: data.error,
            tone: "warning",
          });
          setSubmitting(false);
          return;
        }
        const confirmed = await showConfirmDialog({
          title: `Add ${data.unknownProducts.length} new product${data.unknownProducts.length === 1 ? "" : "s"}?`,
          message:
            `${data.unknownProducts.join(", ")} ${data.unknownProducts.length === 1 ? "is" : "are"} not in the catalogue. ` +
            "Adding creates the product with this cost price and no stock. If it already exists under another name, cancel and link it to the vendor instead.",
          confirmLabel: "Add and order",
        });
        if (!confirmed) {
          setSubmitting(false);
          return;
        }
        await apiClient.post("/api/petty-cash-transactions", { ...payload, confirmNewProducts: true });
      }

      // Get vendor info for send dialog
      const vendor = vendors.find(v => v._id === formData.vendor);
      const orderSummary = validProducts.map(p => `${p.productName} × ${p.quantity} @ ₦${p.costPrice.toLocaleString()} = ₦${(p.costPrice * p.quantity).toLocaleString()}`).join("\n");

      setShowForm(false);
      setFormData({
        vendor: "",
        products: [{ productId: "", productName: "", quantity: 1, costPrice: 0 }],
        description: "",
        location: currentLocation,
        requestDate: new Date().toISOString().split("T")[0],
        neededBy: "",
      });
      loadTransactions();
      onTransactionChange?.();

      // Show send dialog
      if (vendor) {
        setSendDialog({
          vendorName: vendor.companyName,
          phone: vendor.repPhone || "",
          email: vendor.email || "",
          orderSummary: `Order for ${vendor.companyName}:\n${orderSummary}\n\nTotal: ₦${orderTotal.toLocaleString()}\nDate: ${formData.requestDate}`,
        });
      }
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create order");
    } finally {
      setSubmitting(false);
    }
  };

  const runAction = async (id, action, extra = {}) => {
    try {
      await apiClient.put(`/api/petty-cash-transactions/${id}`, { action, ...extra });
      loadTransactions();
      onTransactionChange?.();
    } catch (err) {
      await showAlertDialog({
        title: "Not done",
        message: String(err.response?.data?.error || `Could not ${action.replace(/-/g, " ")} this order.`),
        tone: "danger",
      });
    }
  };

  const cancelOrder = async (tx) => {
    const ok = await showConfirmDialog({
      title: "Cancel this order?",
      message: `"${tx.purpose}" moves to Cancelled. You can reopen or delete it from there.`,
      confirmLabel: "Cancel order",
      cancelLabel: "Keep it",
      tone: "warning",
    });
    if (ok) runAction(tx._id, "cancel");
  };

  // Deleting undoes the order as if it was never entered: the stock its receipt added comes back
  // out and the expense its payment made goes. The person sees exactly what before confirming.
  const deleteOrder = async (tx) => {
    let plan = { stock: [], expenseTotal: 0, expenseCount: 0 };
    if (tx.receivedAt || tx.status === "Received" || tx.status === "Paid") {
      try {
        const { data } = await apiClient.get(`/api/petty-cash-transactions/${tx._id}`, { params: { undo: 1 } });
        plan = data;
      } catch (err) {
        await showAlertDialog({
          title: "Not deleted",
          message: String(err.response?.data?.error || "Could not check what this order changed. Please try again."),
          tone: "danger",
        });
        return;
      }
    }
    const qty = (n) => Number(n).toLocaleString("en-NG", { maximumFractionDigits: 2 });
    const details = [
      ...plan.stock.map((line) => ({
        label: `${line.name}: take ${qty(line.quantity)} back out of stock`,
        value: line.stockNow === null ? "" : `${qty(line.stockNow)} → ${qty(line.stockAfter)}`,
      })),
      ...(plan.expenseCount > 0 ? [{ label: "Expense removed", value: formatCurrency(plan.expenseTotal) }] : []),
    ];
    const goesNegative = plan.stock.some((line) => line.stockAfter !== null && line.stockAfter < 0);
    const undoes = details.length > 0;
    const ok = await showConfirmDialog({
      title: "Delete this order?",
      message:
        `"${tx.purpose}" (${formatCurrency(tx.amount)}) from ${tx.vendorName || "the vendor"} is deleted for good` +
        (undoes ? ", and everything it did is reversed:" : ".") +
        (goesNegative ? " Some of this stock has been sold since, so its count goes below zero." : ""),
      details,
      confirmLabel: undoes ? "Delete and reverse" : "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const { data } = await apiClient.delete(`/api/petty-cash-transactions/${tx._id}`);
      loadTransactions();
      onTransactionChange?.();
      const reversed = [
        data.stockReversed?.length ? `${data.stockReversed.length} product${data.stockReversed.length === 1 ? "" : "s"} taken back out of stock` : "",
        data.expensesRemoved ? "its expense removed" : "",
      ].filter(Boolean);
      await showAlertDialog({
        title: "Order deleted",
        message: reversed.length ? `${tx.purpose}: ${reversed.join(", ")}.` : tx.purpose,
        tone: "success",
      });
    } catch (err) {
      await showAlertDialog({
        title: "Not deleted",
        message: String(err.response?.data?.error || "The order could not be deleted. Nothing was changed."),
        tone: "danger",
      });
    }
  };

  const startEditing = (tx) => {
    setEditingId(tx._id);
    setEditForm({
      vendor: tx.vendor?._id || "",
      purpose: tx.purpose,
      description: tx.description || "",
      quantity: tx.quantity,
      unitPrice: tx.unitPrice,
      amount: tx.amount,
      location: tx.location,
      requestDate: toDateInputValue(tx.requestDate),
      neededBy: toDateInputValue(tx.neededBy),
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await apiClient.put(`/api/petty-cash-transactions/${editingId}`, {
        action: "update-details",
        ...editForm,
      });
      setEditingId(null);
      setEditForm(null);
      loadTransactions();
      onTransactionChange?.();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update");
    }
  };

  const handleExportPaid = () => {
    // What is on screen is what comes down: the period the reader chose.
    const paidTxs = paidTransactions;
    if (!paidTxs.length) return alert("No paid transactions to export.");

    const headers = ["Date", "Vendor", "Purpose", "Qty", "Unit Price", "Amount", "Location", "Paid By", "Method"];
    const rows = paidTxs.map((t) => [
      formatDate(t.paidAt || t.requestDate),
      t.vendorName,
      t.purpose,
      t.quantity,
      t.unitPrice,
      t.amount,
      t.location,
      t.paidBy?.name || "",
      t.paymentMethod || "",
    ]);

    const csv = [headers, ...rows].map((r) => r.map(escapeCsvValue).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const periodSlug = paidRangeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    a.download = `petty-cash-paid-${periodSlug || "all"}-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Anything still open stays in front of the reader, whatever period is chosen.
  const isClosed = (t) => t.status === "Cancelled" || t.status === "Rejected";
  const activeTransactions = transactions.filter((t) => t.status !== "Paid" && !isClosed(t));
  // Cancelled and rejected orders, where they can be reopened or deleted
  const cancelledTransactions = transactions.filter(isClosed);
  const allPaidTransactions = useMemo(
    () => transactions.filter((t) => t.status === "Paid"),
    [transactions]
  );

  // A paid order belongs to the day the money went out, not the day it was raised. The server
  // already sent only the period's paid orders; this keeps the list in step while it reloads.
  const paidTransactions = useMemo(() => {
    if (!paidRange) return allPaidTransactions;
    return allPaidTransactions.filter((t) => {
      const when = new Date(t.paidAt || t.requestDate || t.createdAt);
      return (!paidRange.from || when >= paidRange.from) && (!paidRange.to || when < paidRange.to);
    });
  }, [allPaidTransactions, paidRange]);

  const totalOrdered = activeTransactions.reduce((s, t) => s + t.amount, 0);
  const totalPaid = paidTransactions.reduce((s, t) => s + t.amount, 0);
  const paidTotalAllTimeCount = paidCountAllTime ?? allPaidTransactions.length;

  // Who was paid how much in the period, biggest first, for a quick review
  const paidByVendor = useMemo(() => {
    const rows = new Map();
    for (const t of paidTransactions) {
      const key = t.vendorName || "Unknown vendor";
      const row = rows.get(key) || { vendorName: key, count: 0, total: 0 };
      row.count += 1;
      row.total += Number(t.amount) || 0;
      rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) => b.total - a.total);
  }, [paidTransactions]);

  const displayList =
    tab === "active" ? activeTransactions : tab === "cancelled" ? cancelledTransactions : paidTransactions;

  return (
    <div className="space-y-4">
      {/* The period paid orders and the paid totals are read over — on every tab */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
        <label htmlFor="petty-paid-period" className="text-sm font-medium text-emerald-800">Paid in</label>
        <select
          id="petty-paid-period"
          value={paidPeriod}
          onChange={(e) => setPaidPeriod(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm bg-white !w-auto"
        >
          {PERIOD_OPTIONS.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
          <option value="custom">Custom dates…</option>
        </select>
        {paidPeriod === "custom" && (
          <>
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              aria-label="Paid from"
              className="border rounded px-2 py-1 text-sm bg-white !w-auto"
            />
            <span className="text-sm text-emerald-800">to</span>
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              aria-label="Paid to"
              className="border rounded px-2 py-1 text-sm bg-white !w-auto"
            />
          </>
        )}
        <span className="text-xs text-emerald-700">
          {loading ? "Loading…" : `${paidTransactions.length} paid order${paidTransactions.length === 1 ? "" : "s"} · ${formatCurrency(totalPaid)}`}
        </span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
          <p className="text-xs text-blue-600 font-medium">Active Orders</p>
          <p className="text-lg font-bold text-blue-800">{activeTransactions.length}</p>
        </div>
        <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
          <p className="text-xs text-blue-600 font-medium">Active Total</p>
          <p className="text-lg font-bold text-blue-800">{formatCurrency(totalOrdered)}</p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
          <p className="text-xs text-emerald-600 font-medium">Paid Orders</p>
          <p className="text-lg font-bold text-emerald-800">{paidTransactions.length}</p>
          <p className="text-[10px] text-emerald-600/80">{paidRangeLabel}</p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
          <p className="text-xs text-emerald-600 font-medium">Total Paid</p>
          <p className="text-lg font-bold text-emerald-800">{formatCurrency(totalPaid)}</p>
          <p className="text-[10px] text-emerald-600/80">{paidRangeLabel}</p>
        </div>
      </div>

      {/* Filters & Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterVendor}
          onChange={(e) => setFilterVendor(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm !w-auto"
        >
          <option value="">All Vendors</option>
          {vendors.map((v) => (
            <option key={v._id} value={v._id}>
              {v.companyName}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm !w-auto"
        >
          <option value="">All Status</option>
          <option value="Ordered">Ordered</option>
          <option value="Received">Received</option>
          <option value="Paid">Paid</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <button
          onClick={() => {
            setFormData(prev => ({
              ...prev,
              vendor: "",
              products: [{ productName: "", quantity: 1, costPrice: 0 }],
              description: "",
            }));
            setShowForm(true);
          }}
          className="ml-auto bg-blue-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-blue-700"
        >
          + New Order
        </button>
        {tab === "paid" && (
          <button
            onClick={handleExportPaid}
            className="bg-emerald-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-emerald-700"
          >
            Export CSV
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        <button
          onClick={() => setTab("active")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            tab === "active"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Active ({activeTransactions.length})
        </button>
        <button
          onClick={() => setTab("paid")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            tab === "paid"
              ? "border-emerald-600 text-emerald-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Paid ({paidTransactions.length}{paidRange && paidTotalAllTimeCount !== paidTransactions.length ? ` of ${paidTotalAllTimeCount}` : ""})
        </button>
        <button
          onClick={() => setTab("cancelled")}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${
            tab === "cancelled"
              ? "border-gray-600 text-gray-700"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Cancelled ({cancelledTransactions.length})
        </button>
      </div>

      {/* The period's payments by vendor */}
      {tab === "paid" && paidByVendor.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-white">
          <p className="border-b border-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800">
            Paid by vendor · {paidRangeLabel}
          </p>
          <ul className="divide-y divide-gray-100">
            {paidByVendor.slice(0, 10).map((row) => (
              <li key={row.vendorName} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-gray-800">{row.vendorName}</span>
                <span className="text-xs text-gray-500">{row.count} order{row.count === 1 ? "" : "s"}</span>
                <span className="w-28 text-right font-semibold text-gray-900">{formatCurrency(row.total)}</span>
                <span className="hidden w-12 text-right text-xs text-gray-500 sm:inline">
                  {totalPaid > 0 ? `${Math.round((row.total / totalPaid) * 100)}%` : ""}
                </span>
              </li>
            ))}
          </ul>
          {paidByVendor.length > 10 && (
            <p className="px-3 py-2 text-xs text-gray-500">and {paidByVendor.length - 10} more vendor{paidByVendor.length - 10 === 1 ? "" : "s"}</p>
          )}
        </div>
      )}

      {/* Order Form Modal - Refactored */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
          >
            <h3 className="font-bold text-lg mb-4">New Petty Cash Order</h3>
            <div className="space-y-4">
              {/* Vendor Selection */}
              <div>
                <label className="text-sm font-medium text-gray-700">Vendor *</label>
                <select
                  name="vendor"
                  value={formData.vendor}
                  onChange={(e) => {
                    const vendorId = e.target.value;
                    const v = vendors.find(x => x._id === vendorId);
                    const vendorProducts = (v?.products || []).map(toOrderLine);
                    setFormData(prev => ({
                      ...prev,
                      vendor: vendorId,
                      products: vendorProducts.length > 0 ? vendorProducts : prev.products,
                    }));
                  }}
                  required
                  className="w-full border rounded px-3 py-2 text-sm mt-1"
                >
                  <option value="">Select vendor...</option>
                  {vendors.map((v) => (
                    <option key={v._id} value={v._id}>{v.companyName}</option>
                  ))}
                </select>
              </div>

              {/* Order Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-bold text-gray-700">Products to Order</label>
                  <button type="button" onClick={addItem} className="text-xs text-blue-600 font-medium hover:underline">+ Add Product</button>
                </div>
                <div className="space-y-2">
                  {formData.products.map((product, i) => (
                    <div key={i} className="flex gap-2 items-start p-2 bg-gray-50 rounded-lg border">
                      <div className="flex-1">
                        <input
                          value={product.productName}
                          onChange={(e) => handleItemChange(i, "productName", e.target.value)}
                          placeholder="Product name"
                          className="w-full border rounded px-2 py-1.5 text-sm"
                          required
                        />
                      </div>
                      <div className="w-16">
                        <input
                          type="number"
                          min="1"
                          step="0.01"
                          value={product.quantity}
                          onChange={(e) => handleItemChange(i, "quantity", e.target.value)}
                          className="w-full border rounded px-2 py-1.5 text-sm text-center"
                          placeholder="Qty"
                        />
                      </div>
                      <div className="w-24">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={product.costPrice}
                          onChange={(e) => handleItemChange(i, "costPrice", e.target.value)}
                          className="w-full border rounded px-2 py-1.5 text-sm"
                          placeholder="Cost Price"
                        />
                      </div>
                      <div className="w-24 text-right">
                        <span className="text-sm font-semibold text-gray-700">₦{(Number(product.costPrice || 0) * Number(product.quantity || 1)).toLocaleString()}</span>
                      </div>
                      {formData.products.length > 1 && (
                        <button type="button" onClick={() => removeItem(i)} className="text-red-500 text-lg leading-none mt-1">×</button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mt-2">
                  <span className="text-sm font-bold text-gray-900 bg-blue-50 px-3 py-1 rounded">
                    Total: ₦{orderTotal.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-sm font-medium text-gray-700">Notes / Description</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleFormChange}
                  className="w-full border rounded px-3 py-2 text-sm mt-1"
                  rows={2}
                  placeholder="Any additional notes..."
                />
              </div>

              {/* Date & Location */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-700">Order Date *</label>
                  <input name="requestDate" type="date" value={formData.requestDate} onChange={handleFormChange} required className="w-full border rounded px-2 py-2 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Location *</label>
                  {locations.length > 0 ? (
                    <select name="location" value={formData.location} onChange={handleFormChange} required className="w-full border rounded px-2 py-2 text-sm mt-1">
                      <option value="">Select location</option>
                      {locations.map((loc) => (
                        <option key={loc._id || loc.name} value={loc.name}>
                          {loc.name}{loc.code ? ` (${loc.code})` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input name="location" value={formData.location} onChange={handleFormChange} required placeholder="e.g. Ibile 1" className="w-full border rounded px-2 py-2 text-sm mt-1" />
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700">Needed By</label>
                <input name="neededBy" type="date" value={formData.neededBy} onChange={handleFormChange} className="w-full border rounded px-2 py-2 text-sm mt-1" />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded py-2 text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={submitting} className="flex-1 bg-blue-600 text-white rounded py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {submitting ? "Submitting..." : `Submit Order (₦${orderTotal.toLocaleString()})`}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Send to Vendor Dialog */}
      {sendDialog && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-2 text-gray-900">Send Order</h3>
            <p className="text-sm text-gray-600 mb-4">Send order details to <strong>{sendDialog.vendorName}</strong></p>
            <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs text-gray-700 whitespace-pre-line max-h-32 overflow-y-auto border">
              {sendDialog.orderSummary}
            </div>
            <div className="space-y-2">
              {sendDialog.phone && sendDialog.phone.replace(/[^0-9]/g, "").length >= 10 && (
                <button
                  onClick={() => {
                    const cleanPhone = sendDialog.phone.replace(/[^0-9]/g, "");
                    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(sendDialog.orderSummary)}`, "_blank");
                    setSendDialog(null);
                  }}
                  className="w-full bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-green-700"
                >
                  Send via WhatsApp
                </button>
              )}
              {sendDialog.phone && sendDialog.phone.replace(/[^0-9]/g, "").length >= 10 && (
                <button
                  onClick={() => {
                    window.open(`sms:${sendDialog.phone}?body=${encodeURIComponent(sendDialog.orderSummary)}`, "_blank");
                    setSendDialog(null);
                  }}
                  className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                  Send via SMS
                </button>
              )}
              {sendDialog.email && (
                <button
                  onClick={() => {
                    window.open(`mailto:${sendDialog.email}?subject=New Order&body=${encodeURIComponent(sendDialog.orderSummary)}`, "_blank");
                    setSendDialog(null);
                  }}
                  className="w-full bg-purple-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-purple-700"
                >
                  Send via Email
                </button>
              )}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(sendDialog.orderSummary).then(() => alert("Order details copied!"));
                  setSendDialog(null);
                }}
                className="w-full border border-gray-300 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Copy to Clipboard
              </button>
              <button
                onClick={() => setSendDialog(null)}
                className="w-full text-sm text-gray-400 hover:text-gray-600 py-1"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction List */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : displayList.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          No {tab} transactions found.
        </div>
      ) : (
        <div className="space-y-3">
          {displayList.map((tx) => (
            <div
              key={tx._id}
              className="border rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow"
            >
              {editingId === tx._id ? (
                /* Inline Edit Form */
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={editForm.vendor}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, vendor: e.target.value }))
                      }
                      className="border rounded px-2 py-1 text-sm"
                    >
                      {vendors.map((v) => (
                        <option key={v._id} value={v._id}>
                          {v.companyName}
                        </option>
                      ))}
                    </select>
                    <input
                      value={editForm.purpose}
                      onChange={(e) =>
                        setEditForm((f) => ({ ...f, purpose: e.target.value }))
                      }
                      className="border rounded px-2 py-1 text-sm"
                      placeholder="Purpose"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="number"
                      value={editForm.quantity}
                      onChange={(e) =>
                        setEditForm((f) => {
                          const qty = Number(e.target.value);
                          return { ...f, quantity: qty, amount: qty * f.unitPrice };
                        })
                      }
                      className="border rounded px-2 py-1 text-sm"
                    />
                    <input
                      type="number"
                      value={editForm.unitPrice}
                      onChange={(e) =>
                        setEditForm((f) => {
                          const price = Number(e.target.value);
                          return { ...f, unitPrice: price, amount: f.quantity * price };
                        })
                      }
                      className="border rounded px-2 py-1 text-sm"
                    />
                    <input
                      type="number"
                      value={editForm.amount}
                      readOnly
                      className="border rounded px-2 py-1 text-sm bg-gray-50"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={saveEdit}
                      className="bg-green-600 text-white px-3 py-1 rounded text-xs font-medium"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(null);
                        setEditForm(null);
                      }}
                      className="border px-3 py-1 rounded text-xs font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* Display Mode */
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-sm">{tx.purpose}</p>
                      <p className="text-xs text-gray-500">
                        {tx.vendorName} • {formatDate(tx.requestDate)}
                      </p>
                      {tx.description && (
                        <p className="text-xs text-gray-400 mt-0.5">{tx.description}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-sm">{formatCurrency(tx.amount)}</p>
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${getStatusBadgeClass(tx.status)}`}
                      >
                        {tx.status}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    Qty: {tx.quantity} × {formatCurrency(tx.unitPrice)} • {tx.location}
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-1.5 mt-3 pt-2 border-t">
                    {tx.status === "Ordered" && (
                      <>
                        <button
                          onClick={() => {
                            const vendor = vendors.find(v => v._id === (tx.vendor?._id || tx.vendor));
                            const orderMsg = `Order from ${tx.location}:\n${tx.purpose}\nAmount: ${formatCurrency(tx.amount)}\nDate: ${formatDate(tx.requestDate)}`;
                            setSendDialog({
                              vendorName: vendor?.companyName || tx.vendorName || "Vendor",
                              phone: vendor?.repPhone || "",
                              email: vendor?.email || "",
                              orderSummary: orderMsg,
                            });
                          }}
                          className="bg-green-600 text-white px-2.5 py-1 rounded text-xs font-medium hover:bg-green-700"
                        >
                          Send to Vendor
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Mark items from "${tx.purpose}" as received? This will add the items to inventory.`)) {
                              runAction(tx._id, "mark-received");
                            }
                          }}
                          className="bg-blue-600 text-white px-2.5 py-1 rounded text-xs font-medium hover:bg-blue-700"
                        >
                          Receive Items
                        </button>
                        <button
                          onClick={() => runAction(tx._id, "mark-paid")}
                          className="bg-emerald-600 text-white px-2.5 py-1 rounded text-xs font-medium hover:bg-emerald-700"
                        >
                          Mark as Paid
                        </button>
                        <button
                          onClick={() => startEditing(tx)}
                          className="border border-blue-300 text-blue-600 px-2.5 py-1 rounded text-xs font-medium hover:bg-blue-50"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => cancelOrder(tx)}
                          className="border border-red-300 text-red-600 px-2.5 py-1 rounded text-xs font-medium hover:bg-red-50"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {tx.status === "Received" && (
                      <>
                        <span className="text-xs text-green-600 font-medium px-2.5 py-1 bg-green-50 rounded inline-flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" /> Received on {formatDate(tx.receivedAt)} by {tx.receivedBy?.name || "Unknown"}
                        </span>
                        <button
                          onClick={() => {
                            if (confirm(`Mark payment for "${tx.purpose}" as complete?`)) {
                              runAction(tx._id, "mark-paid", { paymentMethod: "cash" });
                            }
                          }}
                          className="bg-emerald-600 text-white px-2.5 py-1 rounded text-xs font-medium hover:bg-emerald-700"
                        >
                          Mark as Paid
                        </button>
                      </>
                    )}
                    {isClosed(tx) && (
                      <button
                        onClick={() => runAction(tx._id, "reopen")}
                        className="border border-blue-300 text-blue-600 px-2.5 py-1 rounded text-xs font-medium hover:bg-blue-50"
                      >
                        Reopen
                      </button>
                    )}
                    {/* Deleting reverses the order's stock and expense: managers and admins only */}
                    {canDelete && (
                      <button
                        onClick={() => deleteOrder(tx)}
                        className="ml-auto border border-red-300 text-red-700 px-2.5 py-1 rounded text-xs font-medium hover:bg-red-50"
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  {/* Display Products */}
                  {tx.products && tx.products.length > 0 && (
                    <div className="mt-3 pt-2 border-t">
                      <p className="text-xs font-semibold text-gray-600 mb-1">Products:</p>
                      <div className="space-y-1">
                        {tx.products.map((product, idx) => (
                          <div key={idx} className="text-xs text-gray-600">
                            <span className="font-medium">{product.productName}</span>
                            {" - "}
                            <span>Qty: {product.quantity}</span>
                            {" @ "}
                            <span>₦{product.costPrice?.toLocaleString() || 0}</span>
                            {" = "}
                            <span className="font-semibold">₦{(product.costPrice * product.quantity)?.toLocaleString() || 0}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Approval History */}
                  {tx.approvalHistory?.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                        History ({tx.approvalHistory.length})
                      </summary>
                      <div className="mt-1 space-y-1">
                        {tx.approvalHistory.map((h, i) => (
                          <div
                            key={i}
                            className="text-xs text-gray-500 pl-3 border-l-2 border-gray-200"
                          >
                            <span className="font-medium">{h.action}</span>
                            {h.actedBy?.name && ` by ${h.actedBy.name}`}
                            {h.note && ` — ${h.note}`}
                            <span className="text-gray-400 ml-1">
                              {formatDateTime(h.actedAt)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
