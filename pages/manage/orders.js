"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Search, Trash2 } from "lucide-react";
import clsx from "clsx";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import useProgress from "@/lib/useProgress";
import { formatCurrency } from "@/lib/format";
import { apiClient } from "@/lib/api-client";
import { showConfirmDialog } from "@/lib/dialogs";
import { useAuth } from "@/lib/useAuth";
import { getCachedSetup } from "@/lib/setupCache";

const STATUS_OPTIONS = [
  "Pending Payment",
  "Inventory Reserved",
  "Pending",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled",
];

const STATUS_CLASS = {
  "Pending Payment": "bg-amber-100 text-amber-700",
  "Inventory Reserved": "bg-blue-100 text-blue-700",
  Pending: "bg-cyan-100 text-cyan-700",
  Processing: "bg-yellow-100 text-yellow-700",
  Shipped: "theme-badge-soft",
  Delivered: "bg-green-100 text-green-700",
  Cancelled: "bg-red-100 text-red-700",
  "Reservation Expired": "bg-gray-100 text-gray-700",
};

const SITE_LABELS = {
  store: "Store",
  hotel: "Hotel",
};

const NOTICE_CLASS = {
  success: "bg-green-50 border-green-200 text-green-700",
  warning: "bg-amber-50 border-amber-200 text-amber-700",
  error: "bg-red-50 border-red-200 text-red-700",
};

function createNotice(type, title, text) {
  return { type, title, text };
}

function getOrderReference(order) {
  const orderId = order?._id ? String(order._id) : "";
  return orderId ? `Order ${orderId.slice(-8)}` : "This order";
}

function getApiErrorMessage(error) {
  return String(
    error?.response?.data?.error || error?.response?.data?.message || ""
  ).trim();
}

function getOrderErrorNotice({ error, action, order, nextStatus }) {
  const apiError = getApiErrorMessage(error);
  const orderRef = getOrderReference(order);

  if (action === "load") {
    if (apiError === "Insufficient permissions") {
      return createNotice(
        "error",
        "Orders unavailable",
        "You do not have permission to view orders from this page."
      );
    }

    return createNotice(
      "error",
      "Couldn't load orders",
      "We couldn't load the order list right now. Refresh the page and try again."
    );
  }

  if (action === "status") {
    if (apiError === "Order not found") {
      return createNotice(
        "error",
        "Order not found",
        `${orderRef} could not be found. Refresh the list and try again.`
      );
    }

    if (apiError === "Status is required") {
      return createNotice(
        "error",
        "Status not selected",
        "Choose a valid order status before saving."
      );
    }

    if (apiError.startsWith("Invalid status:")) {
      return createNotice(
        "error",
        "Invalid status",
        "The selected order status is not supported. Refresh the page and try again."
      );
    }

    if (apiError === "Order already marked as Delivered") {
      return createNotice(
        "warning",
        "Order already delivered",
        `${orderRef} is already marked as Delivered.`
      );
    }

    if (apiError === "Insufficient permissions") {
      return createNotice(
        "error",
        "Status update blocked",
        "You do not have permission to update this order."
      );
    }

    return createNotice(
      "error",
      "Status update failed",
      `We couldn't change ${orderRef} to ${nextStatus}. Please try again.`
    );
  }

  if (action === "delete") {
    if (apiError === "Order not found") {
      return createNotice(
        "error",
        "Order not found",
        `${orderRef} no longer exists. Refresh the list to see the latest orders.`
      );
    }

    if (apiError === "Admin access required") {
      return createNotice(
        "error",
        "Delete blocked",
        "Only admins can delete cancelled orders."
      );
    }

    if (apiError === "Only cancelled orders can be deleted") {
      return createNotice(
        "warning",
        "Delete blocked",
        `${orderRef} must be cancelled before it can be deleted.`
      );
    }

    return createNotice(
      "error",
      "Delete failed",
      `We couldn't delete ${orderRef}. Please try again.`
    );
  }

  if (action === "location") {
    if (apiError === "Order not found") {
      return createNotice(
        "error",
        "Order not found",
        `${orderRef} could not be found. Refresh the list and try again.`
      );
    }

    if (apiError === "Insufficient permissions") {
      return createNotice(
        "error",
        "Location update blocked",
        "You do not have permission to update this order."
      );
    }

    return createNotice(
      "error",
      "Location update failed",
      `We couldn't update the location for ${orderRef}. Please try again.`
    );
  }

  return createNotice(
    "error",
    "Order action failed",
    "Please try again."
  );
}

function getStatusSuccessNotice({ order, newStatus, emailState = "skipped" }) {
  const orderRef = getOrderReference(order);
  const details = [`${orderRef} is now ${newStatus}.`];

  if (newStatus === "Delivered") {
    details.push("Inventory and sales records were updated.");
  }

  if (newStatus === "Cancelled") {
    details.push("This order can now be deleted if needed.");
  }

  if (emailState === "sent") {
    details.push("A status email was sent to the customer.");
  }

  if (emailState === "failed") {
    details.push("The order was updated, but the customer email could not be sent.");
  }

  if (emailState === "skipped" && ["Processing", "Shipped", "Delivered", "Cancelled"].includes(newStatus)) {
    details.push("The order was updated, but customer notification was skipped.");
  }

  return createNotice(
    emailState === "failed" || emailState === "skipped" ? "warning" : "success",
    emailState === "failed"
      ? "Order updated, email not sent"
      : emailState === "skipped"
      ? "Order updated, email skipped"
      : "Order updated",
    details.join(" ")
  );
}

function getOrderCustomerDetails(order) {
  const customer = order?.customer || {};
  const customerSnapshot = order?.customerSnapshot || {};
  const shippingDetails = order?.shippingDetails || {};

  return {
    name: customer?.name || customerSnapshot?.name || shippingDetails?.name || "N/A",
    email: customer?.email || customerSnapshot?.email || shippingDetails?.email || "N/A",
    phone: shippingDetails?.phone || customerSnapshot?.phone || customer?.phone || "N/A",
    address: shippingDetails?.address || customerSnapshot?.address || customer?.address || "No address",
    city:
      shippingDetails?.city ||
      customerSnapshot?.city ||
      customer?.city ||
      order?.deliveryDetails?.city ||
      order?.deliveryPerson?.city ||
      "N/A",
  };
}

function getOrderSourceLabel(order) {
  return SITE_LABELS[String(order?.siteKey || "store").trim().toLowerCase()] || "Store";
}

function getOrderLocationLabel(order) {
  if (order?.locationName) {
    return order.locationName;
  }

  const source = getOrderSourceLabel(order);
  return `Unassigned (${source})`;
}

export default function OrderInventoryPage() {
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const { isAdmin } = useAuth();
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [busyOrderId, setBusyOrderId] = useState(null);
  const [message, setMessage] = useState(null);
  const [locations, setLocations] = useState([]);

  const entriesPerPage = 10;

  useEffect(() => {
    if (!message?.text) return undefined;

    const timeoutId = window.setTimeout(() => {
      setMessage(null);
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    let isActive = true;

    async function loadLocations() {
      try {
        const setup = await getCachedSetup();
        if (!isActive) return;
        setLocations(Array.isArray(setup?.store?.locations) ? setup.store.locations : []);
      } catch (error) {
        console.error("Failed to load locations:", error);
        if (isActive) setLocations([]);
      }
    }

    loadLocations();

    return () => {
      isActive = false;
    };
  }, []);

  const fetchOrders = useCallback(async (page = 1, searchTerm = "") => {
    setLoading(true);
    start();
    onFetch();
    try {
      const { data } = await apiClient.get("/api/orders", {
        params: { page, limit: entriesPerPage, search: searchTerm },
      });
      onProcess();
      setOrders(data.orders || []);
      setTotalPages(data.totalPages || 1);
    } catch (error) {
      console.error("Failed to fetch orders:", error);
      setOrders([]);
      setTotalPages(1);
      setMessage(getOrderErrorNotice({ error, action: "load" }));
    } finally {
      setLoading(false);
      setInitialLoad(false);
      complete();
    }
  }, [complete, onFetch, onProcess, start]);

  useEffect(() => {
    fetchOrders(currentPage, search);
  }, [currentPage, search, fetchOrders]);

  useEffect(() => {
    const handleVisibilityRefresh = () => {
      if (document.visibilityState === "visible") {
        fetchOrders(currentPage, search);
      }
    };

    const handleWindowFocus = () => {
      fetchOrders(currentPage, search);
    };

    document.addEventListener("visibilitychange", handleVisibilityRefresh);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityRefresh);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [currentPage, fetchOrders, search]);

  const handleStatusChange = async (order, newStatus) => {
    if (!order?._id || order.status === newStatus) return;

    setBusyOrderId(order._id);
    setMessage(null);

    try {
      const { data } = await apiClient.put(`/api/orders/${order._id}`, {
        status: newStatus,
      });

      const updatedOrder = data?.order || data;
      const emailState = data?.emailState || "skipped";

      setOrders((prev) =>
        prev.map((currentOrder) =>
          currentOrder._id === order._id ? { ...currentOrder, ...updatedOrder } : currentOrder
        )
      );

      if (newStatus === "Cancelled") {
        setExpandedOrderId(order._id);
      }

      setMessage(
        getStatusSuccessNotice({
          order: { ...order, ...updatedOrder },
          newStatus,
          emailState,
        })
      );
    } catch (error) {
      console.error("Failed to update status:", error);
      setMessage(getOrderErrorNotice({
        error,
        action: "status",
        order,
        nextStatus: newStatus,
      }));
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleDeleteOrder = async (order) => {
    if (!order?._id) return;
    const shouldDelete = await showConfirmDialog({
      title: `Delete order ${order._id.slice(-8)}?`,
      message: "This cancelled order will be deleted permanently.",
      tone: "danger",
      confirmLabel: "Delete order",
      cancelLabel: "Keep order",
    });
    if (!shouldDelete) return;

    setBusyOrderId(order._id);
    setMessage(null);

    try {
      await apiClient.delete(`/api/orders/${order._id}`);
      const isLastOrderOnPage = orders.length === 1 && currentPage > 1;
      setExpandedOrderId((prev) => (prev === order._id ? null : prev));
      await fetchOrders(isLastOrderOnPage ? currentPage - 1 : currentPage, search);
      if (isLastOrderOnPage) {
        setCurrentPage((prev) => Math.max(1, prev - 1));
      }
      setMessage(
        createNotice(
          "success",
          "Order deleted",
          `${getOrderReference(order)} was deleted successfully.`
        )
      );
    } catch (error) {
      console.error("Failed to delete order:", error);
      setMessage(getOrderErrorNotice({ error, action: "delete", order }));
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleLocationChange = async (order, nextLocationId) => {
    if (!order?._id) return;

    const selectedLocation = locations.find(
      (location) => String(location?._id || "") === String(nextLocationId || "")
    );
    const normalizedLocationId = selectedLocation?._id || null;
    const normalizedLocationName = selectedLocation?.name || "";

    if (
      String(order.locationId || "") === String(normalizedLocationId || "") &&
      String(order.locationName || "") === normalizedLocationName
    ) {
      return;
    }

    setBusyOrderId(order._id);
    setMessage(null);

    try {
      const { data } = await apiClient.put(`/api/orders/${order._id}`, {
        locationId: normalizedLocationId,
        locationName: normalizedLocationName,
      });

      const updatedOrder = data?.order || data;

      setOrders((prev) =>
        prev.map((currentOrder) =>
          currentOrder._id === order._id ? { ...currentOrder, ...updatedOrder } : currentOrder
        )
      );

      setMessage(
        createNotice(
          "success",
          "Order location updated",
          `${getOrderReference(order)} is now assigned to ${normalizedLocationName || "no location"}.`
        )
      );
    } catch (error) {
      console.error("Failed to update location:", error);
      setMessage(getOrderErrorNotice({ error, action: "location", order }));
    } finally {
      setBusyOrderId(null);
    }
  };

  return (
    <Layout>
      {initialLoad && loading ? (
        <div className="min-h-screen flex items-center justify-center">
          <Loader size="lg" text="Loading orders..." progress={progress} />
        </div>
      ) : (
        <div className="page-container">
          <div className="page-content">
            <div className="page-header">
              <h1 className="page-title">Order Management</h1>
              <p className="page-subtitle">Manage customer orders and review order details inline.</p>
            </div>

            {message?.text && (
              <div className={clsx("mb-6 rounded-lg border px-4 py-3", NOTICE_CLASS[message.type] || NOTICE_CLASS.success)}>
                {message?.title ? <p className="text-sm font-semibold">{message.title}</p> : null}
                <p className={clsx("text-sm", message?.title ? "mt-1" : "font-medium")}>{message.text}</p>
              </div>
            )}

            <div className="mb-6">
              <div className="search-input-wrapper max-w-md">
                <Search className="search-input-icon" />
                <input
                  type="search"
                  placeholder="Search by customer or order ID"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="search-input"
                />
              </div>
            </div>

            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    {["Order ID", "Customer", "Location", "Total", "Status", "Date"].map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-gray-500 italic">Loading orders...</td>
                    </tr>
                  ) : orders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 italic text-gray-400">No orders found.</td>
                    </tr>
                  ) : (
                    orders.map((order, idx) => {
                      const isExpanded = expandedOrderId === order._id;
                      const customerDetails = getOrderCustomerDetails(order);
                      const products = Array.isArray(order.cartProducts) && order.cartProducts.length > 0
                        ? order.cartProducts
                        : order.items || [];

                      return (
                        <Fragment key={order._id}>
                          <tr
                            className={clsx(
                              idx % 2 === 0 ? "bg-white" : "bg-gray-50",
                              "cursor-pointer hover:bg-cyan-50 transition"
                            )}
                            onClick={() => setExpandedOrderId(isExpanded ? null : order._id)}
                          >
                            <td className="font-mono theme-accent-text font-semibold">
                              <div className="flex items-center gap-2">
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                {order._id.slice(-8)}
                              </div>
                            </td>
                            <td className="text-gray-900">{customerDetails.name}</td>
                            <td className="text-gray-700">{getOrderLocationLabel(order)}</td>
                            <td className="font-bold text-gray-900">{formatCurrency(order.total || 0)}</td>
                            <td>
                              <select
                                value={order.status}
                                disabled={busyOrderId === order._id || order.status === "Delivered"}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => handleStatusChange(order, e.target.value)}
                                className={clsx(
                                  "px-2 sm:px-3 py-1.5 rounded-full text-xs font-bold transition cursor-pointer",
                                  STATUS_CLASS[order.status] || "bg-gray-100 text-gray-600",
                                  order.status === "Delivered" && "opacity-60 cursor-not-allowed"
                                )}
                              >
                                {STATUS_OPTIONS.map((status) => (
                                  <option key={status} value={status}>{status}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 md:px-6 py-3 md:py-4 text-gray-700 text-xs md:text-sm">
                              {new Date(order.createdAt).toLocaleDateString("en-NG")}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-cyan-50/40">
                              <td colSpan={6} className="px-4 py-4">
                                <div className="overflow-hidden rounded-xl border border-cyan-100 bg-white p-4 shadow-sm transition-all duration-200">
                                  <div className="grid gap-4 lg:grid-cols-3">
                                    <div className="space-y-2 text-sm text-gray-700">
                                      <h3 className="font-semibold text-gray-900">Customer Details</h3>
                                      <p><strong>Name:</strong> {customerDetails.name}</p>
                                      <p><strong>Email:</strong> {customerDetails.email}</p>
                                      <p><strong>Phone:</strong> {customerDetails.phone}</p>
                                      <p><strong>Address:</strong> {customerDetails.address}</p>
                                      <p><strong>City:</strong> {customerDetails.city}</p>
                                      <p><strong>Order source:</strong> {getOrderSourceLabel(order)}</p>
                                      <p><strong>Payment status:</strong> {order.paymentStatus || "Pending"}</p>
                                      {order.reservationStatus ? (
                                        <p><strong>Reservation:</strong> {order.reservationStatus}</p>
                                      ) : null}
                                      <div className="pt-2">
                                        <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
                                          Fulfilment Location
                                        </label>
                                        <select
                                          value={String(order.locationId || "")}
                                          onChange={(e) => {
                                            e.stopPropagation();
                                            handleLocationChange(order, e.target.value);
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          disabled={busyOrderId === order._id || locations.length === 0}
                                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100 disabled:cursor-not-allowed disabled:bg-gray-100"
                                        >
                                          <option value="">Unassigned</option>
                                          {locations.map((location) => (
                                            <option key={location._id} value={location._id}>
                                              {location.name}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    </div>

                                    <div className="space-y-2 text-sm text-gray-700 lg:col-span-2">
                                      <div className="flex items-center justify-between gap-3">
                                        <h3 className="font-semibold text-gray-900">Order Items</h3>
                                        <span className={clsx("rounded-full px-3 py-1 text-xs font-semibold", STATUS_CLASS[order.status] || "bg-gray-100 text-gray-700")}>
                                          {order.status}
                                        </span>
                                      </div>
                                      <div className="overflow-hidden rounded-lg border border-gray-200">
                                        <table className="min-w-full text-sm">
                                          <thead className="bg-gray-50 text-gray-600">
                                            <tr>
                                              <th className="px-3 py-2 text-left">Item</th>
                                              <th className="px-3 py-2 text-right">Qty</th>
                                              <th className="px-3 py-2 text-right">Price</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {products.map((item, itemIndex) => (
                                              <tr key={`${order._id}-${itemIndex}`} className="border-t border-gray-100 text-gray-700">
                                                <td className="px-3 py-2">{item?.name || "Unnamed item"}</td>
                                                <td className="px-3 py-2 text-right">{Number(item?.quantity || 0)}</td>
                                                <td className="px-3 py-2 text-right">{formatCurrency(Number(item?.price || 0))}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                          <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900">
                                            <tr>
                                              <td className="px-3 py-2 text-right" colSpan={2}>Total</td>
                                              <td className="px-3 py-2 text-right">{formatCurrency(order.total || 0)}</td>
                                            </tr>
                                          </tfoot>
                                        </table>
                                      </div>

                                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                                        <div className="text-xs text-gray-500">
                                          Created {new Date(order.createdAt).toLocaleString("en-NG")}
                                        </div>
                                        {isAdmin && order.status === "Cancelled" && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteOrder(order);
                                            }}
                                            disabled={busyOrderId === order._id}
                                            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                                          >
                                            <Trash2 size={14} />
                                            {busyOrderId === order._id ? "Deleting..." : "Delete Order"}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex justify-between items-center">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((prev) => prev - 1)}
                className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-300 text-white font-bold py-2 px-4 rounded-lg transition"
              >
                Previous
              </button>
              <span className="text-gray-700 font-medium">Page {currentPage} of {totalPages}</span>
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((prev) => prev + 1)}
                className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-300 text-white font-bold py-2 px-4 rounded-lg transition"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

