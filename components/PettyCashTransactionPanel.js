import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";

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

export default function PettyCashTransactionPanel({
  vendors = [],
  currentLocation = "",
  onTransactionChange,
  prefillVendor = null,
  onPrefillConsumed,
}) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("active"); // active | paid
  const [filterVendor, setFilterVendor] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // Order form state
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    vendor: "",
    items: [], // [{productName, quantity, unitPrice, amount}]
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
      const vendorProducts = (prefillVendor.products || []).map(p => ({
        productName: p.productName || p.name || "",
        quantity: 1,
        unitPrice: Number(p.price) || 0,
        amount: Number(p.price) || 0,
      }));
      setFormData({
        vendor: prefillVendor._id,
        items: vendorProducts.length > 0 ? vendorProducts : [{ productName: "", quantity: 1, unitPrice: 0, amount: 0 }],
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

      const { data } = await apiClient.get("/api/petty-cash-transactions", { params });
      setTransactions(data.transactions || []);
    } catch (err) {
      console.error("Failed to load transactions:", err);
    } finally {
      setLoading(false);
    }
  }, [filterVendor, filterStatus, currentLocation]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleItemChange = (index, field, value) => {
    setFormData((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], [field]: field === "productName" ? value : Number(value) || 0 };
      if (field === "quantity" || field === "unitPrice") {
        const qty = field === "quantity" ? (Number(value) || 0) : items[index].quantity;
        const price = field === "unitPrice" ? (Number(value) || 0) : items[index].unitPrice;
        items[index].amount = qty * price;
      }
      return { ...prev, items };
    });
  };

  const addItem = () => {
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, { productName: "", quantity: 1, unitPrice: 0, amount: 0 }],
    }));
  };

  const removeItem = (index) => {
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const orderTotal = formData.items.reduce((s, item) => s + (item.amount || 0), 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validItems = formData.items.filter(it => it.productName?.trim() && it.amount > 0);
    if (!validItems.length) return alert("Add at least one item with a name and price");
    setSubmitting(true);
    try {
      // Submit each item as a separate transaction (or as one combined)
      const purpose = validItems.map(it => `${it.productName} x${it.quantity}`).join(", ");
      await apiClient.post("/api/petty-cash-transactions", {
        vendor: formData.vendor,
        purpose,
        description: formData.description,
        quantity: 1,
        unitPrice: orderTotal,
        amount: orderTotal,
        location: formData.location,
        requestDate: formData.requestDate,
        neededBy: formData.neededBy || undefined,
      });

      // Get vendor info for send dialog
      const vendor = vendors.find(v => v._id === formData.vendor);
      const orderSummary = validItems.map(it => `${it.productName} × ${it.quantity} = ₦${it.amount.toLocaleString()}`).join("\n");

      setShowForm(false);
      setFormData({
        vendor: "",
        items: [{ productName: "", quantity: 1, unitPrice: 0, amount: 0 }],
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
      alert(err.response?.data?.error || `Failed to ${action}`);
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
    const paidTxs = transactions.filter((t) => t.status === "Paid");
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
    a.download = `petty-cash-paid-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeTransactions = transactions.filter((t) => t.status !== "Paid" && t.status !== "Cancelled");
  const paidTransactions = transactions.filter((t) => t.status === "Paid");

  const totalOrdered = activeTransactions.reduce((s, t) => s + t.amount, 0);
  const totalPaid = paidTransactions.reduce((s, t) => s + t.amount, 0);

  const displayList = tab === "active" ? activeTransactions : paidTransactions;

  return (
    <div className="space-y-4">
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
        </div>
        <div className="bg-emerald-50 rounded-lg p-3 border border-emerald-200">
          <p className="text-xs text-emerald-600 font-medium">Total Paid</p>
          <p className="text-lg font-bold text-emerald-800">{formatCurrency(totalPaid)}</p>
        </div>
      </div>

      {/* Filters & Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterVendor}
          onChange={(e) => setFilterVendor(e.target.value)}
          className="border rounded px-2 py-1.5 text-sm"
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
          className="border rounded px-2 py-1.5 text-sm"
        >
          <option value="">All Status</option>
          <option value="Ordered">Ordered</option>
          <option value="Paid">Paid</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <button
          onClick={() => {
            setFormData(prev => ({
              ...prev,
              vendor: "",
              items: [{ productName: "", quantity: 1, unitPrice: 0, amount: 0 }],
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
          Paid ({paidTransactions.length})
        </button>
      </div>

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
                    const vendorProducts = (v?.products || []).map(p => ({
                      productName: p.productName || p.name || "",
                      quantity: 1,
                      unitPrice: Number(p.price) || 0,
                      amount: Number(p.price) || 0,
                    }));
                    setFormData(prev => ({
                      ...prev,
                      vendor: vendorId,
                      items: vendorProducts.length > 0 ? vendorProducts : prev.items,
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
                  <label className="text-sm font-bold text-gray-700">Order Items</label>
                  <button type="button" onClick={addItem} className="text-xs text-blue-600 font-medium hover:underline">+ Add Item</button>
                </div>
                <div className="space-y-2">
                  {formData.items.map((item, i) => (
                    <div key={i} className="flex gap-2 items-start p-2 bg-gray-50 rounded-lg border">
                      <div className="flex-1">
                        <input
                          value={item.productName}
                          onChange={(e) => handleItemChange(i, "productName", e.target.value)}
                          placeholder="Product/Item name"
                          className="w-full border rounded px-2 py-1.5 text-sm"
                          required
                        />
                      </div>
                      <div className="w-16">
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(i, "quantity", e.target.value)}
                          className="w-full border rounded px-2 py-1.5 text-sm text-center"
                          placeholder="Qty"
                        />
                      </div>
                      <div className="w-24">
                        <input
                          type="number"
                          min="0"
                          value={item.unitPrice}
                          onChange={(e) => handleItemChange(i, "unitPrice", e.target.value)}
                          className="w-full border rounded px-2 py-1.5 text-sm"
                          placeholder="Price"
                        />
                      </div>
                      <div className="w-20 text-right">
                        <span className="text-sm font-semibold text-gray-700">₦{(item.amount || 0).toLocaleString()}</span>
                      </div>
                      {formData.items.length > 1 && (
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
                  <input name="location" value={formData.location} onChange={handleFormChange} required placeholder="e.g. Ibile 1" className="w-full border rounded px-2 py-2 text-sm mt-1" />
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
            <h3 className="font-bold text-lg mb-2 text-green-700">✅ Order Submitted!</h3>
            <p className="text-sm text-gray-600 mb-4">Send order details to <strong>{sendDialog.vendorName}</strong>?</p>
            <div className="space-y-2">
              {sendDialog.phone && (
                <button
                  onClick={() => {
                    window.open(`https://wa.me/${sendDialog.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(sendDialog.orderSummary)}`, "_blank");
                    setSendDialog(null);
                  }}
                  className="w-full bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-green-700"
                >
                  📱 Send via WhatsApp
                </button>
              )}
              {sendDialog.phone && (
                <button
                  onClick={() => {
                    window.open(`sms:${sendDialog.phone}?body=${encodeURIComponent(sendDialog.orderSummary)}`, "_blank");
                    setSendDialog(null);
                  }}
                  className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                  💬 Send via SMS
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
                  📧 Send via Email
                </button>
              )}
              <button
                onClick={() => setSendDialog(null)}
                className="w-full border border-gray-300 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Skip / Close
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
          No {tab === "active" ? "active" : "paid"} transactions found.
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
                          onClick={() => runAction(tx._id, "mark-paid")}
                          className="bg-emerald-600 text-white px-2.5 py-1 rounded text-xs font-medium hover:bg-emerald-700"
                        >
                          Mark Paid
                        </button>
                        <button
                          onClick={() => startEditing(tx)}
                          className="border border-blue-300 text-blue-600 px-2.5 py-1 rounded text-xs font-medium hover:bg-blue-50"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (confirm("Cancel this order?"))
                              runAction(tx._id, "cancel");
                          }}
                          className="border border-red-300 text-red-600 px-2.5 py-1 rounded text-xs font-medium hover:bg-red-50"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {(tx.status === "Cancelled" || tx.status === "Rejected") && (
                      <button
                        onClick={() => runAction(tx._id, "reopen")}
                        className="border border-blue-300 text-blue-600 px-2.5 py-1 rounded text-xs font-medium hover:bg-blue-50"
                      >
                        Reopen
                      </button>
                    )}
                  </div>

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
