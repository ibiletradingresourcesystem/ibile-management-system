import { useState, useEffect, useCallback } from "react";
import Layout from "@/components/Layout";
import axios from "axios";
import Link from "next/link";

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

export default function PaymentTrackerPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterVendor, setFilterVendor] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [vendors, setVendors] = useState([]);
  const [page, setPage] = useState(1);
  const [editingPayment, setEditingPayment] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [selectedOrders, setSelectedOrders] = useState([]);
  const perPage = 15;

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: perPage };
      if (filterVendor) params.vendor = filterVendor;
      if (filterStatus) params.status = filterStatus;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;

      const { data } = await axios.get("/api/purchase-orders", { params });
      setOrders(data.orders || data || []);
    } catch (err) {
      console.error("Failed to load orders:", err);
    } finally {
      setLoading(false);
    }
  }, [page, filterVendor, filterStatus, dateFrom, dateTo]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    async function loadVendors() {
      try {
        const { data } = await axios.get("/api/vendors", { params: { active: true, vendorType: "stock" } });
        setVendors(data.vendors || []);
      } catch (err) {
        console.error("Failed to load vendors:", err);
      }
    }
    loadVendors();
  }, []);

  const handlePaymentUpdate = async (orderId) => {
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) return alert("Enter a valid payment amount.");

    try {
      await axios.put(`/api/purchase-orders/${orderId}`, {
        action: "update-payment",
        paymentAmount: amount,
      });
      setEditingPayment(null);
      setPaymentAmount("");
      loadOrders();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update payment");
    }
  };

  const toggleSelect = (id) => {
    setSelectedOrders((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Quick-check totals for selected orders
  const selectedData = orders.filter((o) => selectedOrders.includes(o._id));
  const selectedTotal = selectedData.reduce((s, o) => s + (o.grandTotal || 0), 0);
  const selectedPaid = selectedData.reduce((s, o) => s + (o.paymentMade || 0), 0);
  const selectedBalance = selectedData.reduce((s, o) => s + (o.balance || 0), 0);

  // Summary stats
  const overdue = orders.filter((o) => {
    if (o.status === "Paid") return false;
    const orderDate = new Date(o.date || o.createdAt);
    const daysSince = (Date.now() - orderDate.getTime()) / (1000 * 60 * 60 * 24);
    return daysSince > 14;
  });
  const outstanding = orders.filter((o) => o.status !== "Paid");
  const totalOutstanding = outstanding.reduce((s, o) => s + (o.balance || 0), 0);

  return (
    <Layout>
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Vendor Payment Tracker</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track purchase order payments, generate transfer memos, and manage vendor credits.
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
            <p className="text-xs text-orange-600 font-medium">Overdue ({">"}14 days)</p>
            <p className="text-lg font-bold text-orange-800">{overdue.length}</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
            <p className="text-xs text-blue-600 font-medium">Outstanding</p>
            <p className="text-lg font-bold text-blue-800">{outstanding.length}</p>
          </div>
          <div className="bg-red-50 rounded-lg p-3 border border-red-200">
            <p className="text-xs text-red-600 font-medium">Total Balance</p>
            <p className="text-lg font-bold text-red-800">{formatCurrency(totalOutstanding)}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-3 border border-green-200">
            <p className="text-xs text-green-600 font-medium">Total Orders</p>
            <p className="text-lg font-bold text-green-800">{orders.length}</p>
          </div>
        </div>

        {/* Quick-Check Totals */}
        {selectedOrders.length > 0 && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 mb-4 flex flex-wrap gap-4 items-center">
            <span className="text-sm font-medium text-indigo-700">
              {selectedOrders.length} selected:
            </span>
            <span className="text-sm">Total: <strong>{formatCurrency(selectedTotal)}</strong></span>
            <span className="text-sm">Paid: <strong>{formatCurrency(selectedPaid)}</strong></span>
            <span className="text-sm">Balance: <strong className="text-red-600">{formatCurrency(selectedBalance)}</strong></span>
            <button
              onClick={() => setSelectedOrders([])}
              className="text-xs text-indigo-600 hover:underline ml-auto"
            >
              Clear
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <select
            value={filterVendor}
            onChange={(e) => { setFilterVendor(e.target.value); setPage(1); }}
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="">All Vendors</option>
            {vendors.map((v) => (
              <option key={v._id} value={v._id}>{v.companyName}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
            className="border rounded px-3 py-2 text-sm"
          >
            <option value="">All Status</option>
            <option value="Not Paid">Not Paid</option>
            <option value="Partly Paid">Partly Paid</option>
            <option value="Paid">Paid</option>
            <option value="Credit">Credit</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            className="border rounded px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            className="border rounded px-3 py-2 text-sm"
          />
        </div>

        {/* Orders Table */}
        {loading ? (
          <p className="text-center text-gray-500 py-8">Loading...</p>
        ) : orders.length === 0 ? (
          <p className="text-center text-gray-400 py-8">No orders found.</p>
        ) : (
          <>
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2.5 w-8">
                      <input
                        type="checkbox"
                        checked={selectedOrders.length === orders.length}
                        onChange={() =>
                          setSelectedOrders(
                            selectedOrders.length === orders.length
                              ? []
                              : orders.map((o) => o._id)
                          )
                        }
                        className="rounded"
                      />
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium text-gray-600">Date</th>
                    <th className="px-3 py-2.5 text-left font-medium text-gray-600">Vendor</th>
                    <th className="px-3 py-2.5 text-right font-medium text-gray-600">Total</th>
                    <th className="px-3 py-2.5 text-right font-medium text-gray-600">Paid</th>
                    <th className="px-3 py-2.5 text-right font-medium text-gray-600">Balance</th>
                    <th className="px-3 py-2.5 text-center font-medium text-gray-600">Status</th>
                    <th className="px-3 py-2.5 text-center font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const isOverdue =
                      order.status !== "Paid" &&
                      (Date.now() - new Date(order.date || order.createdAt).getTime()) / 86400000 > 14;

                    return (
                      <tr
                        key={order._id}
                        className={`border-t hover:bg-gray-50 ${isOverdue ? "bg-orange-50/50" : ""}`}
                      >
                        <td className="px-2 py-2.5">
                          <input
                            type="checkbox"
                            checked={selectedOrders.includes(order._id)}
                            onChange={() => toggleSelect(order._id)}
                            className="rounded"
                          />
                        </td>
                        <td className="px-3 py-2.5">{formatDate(order.date)}</td>
                        <td className="px-3 py-2.5 font-medium">
                          {order.vendorName || order.supplier || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right">{formatCurrency(order.grandTotal)}</td>
                        <td className="px-3 py-2.5 text-right text-green-600">
                          {editingPayment === order._id ? (
                            <div className="flex items-center gap-1 justify-end">
                              <input
                                type="number"
                                value={paymentAmount}
                                onChange={(e) => setPaymentAmount(e.target.value)}
                                className="w-20 border rounded px-1 py-0.5 text-sm text-right"
                                placeholder="Amount"
                              />
                              <button
                                onClick={() => handlePaymentUpdate(order._id)}
                                className="text-green-600 text-xs font-medium"
                              >
                                ✓
                              </button>
                              <button
                                onClick={() => setEditingPayment(null)}
                                className="text-gray-400 text-xs"
                              >
                                ×
                              </button>
                            </div>
                          ) : (
                            formatCurrency(order.paymentMade)
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-red-600">
                          {formatCurrency(order.balance)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              order.status === "Paid"
                                ? "bg-green-100 text-green-700"
                                : order.status === "Partly Paid"
                                  ? "bg-yellow-100 text-yellow-700"
                                  : order.status === "Credit"
                                    ? "bg-purple-100 text-purple-700"
                                    : "bg-red-100 text-red-700"
                            }`}
                          >
                            {order.status}
                            {isOverdue && " ⚠️"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="flex gap-1 justify-center flex-wrap">
                            {order.status !== "Paid" && (
                              <button
                                onClick={() => {
                                  setEditingPayment(order._id);
                                  setPaymentAmount("");
                                }}
                                className="text-blue-600 text-xs font-medium hover:underline"
                              >
                                Pay
                              </button>
                            )}
                            <Link
                              href={`/memo/${order._id}`}
                              className="text-indigo-600 text-xs font-medium hover:underline"
                            >
                              Memo
                            </Link>
                            <Link
                              href={`/memo/order?id=${order._id}`}
                              className="text-gray-500 text-xs font-medium hover:underline"
                            >
                              Order
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex justify-center gap-2 mt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="border rounded px-3 py-1 text-sm disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="px-3 py-1 text-sm text-gray-600">Page {page}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={orders.length < perPage}
                className="border rounded px-3 py-1 text-sm disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
