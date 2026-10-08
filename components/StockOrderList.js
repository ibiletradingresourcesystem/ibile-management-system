import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Layers, Plus, Trash2, AlertTriangle, PackageCheck } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";
import { Loader } from "@/components/ui";
import { useAuth } from "@/lib/useAuth";
import { isBasicStaffRole } from "@/lib/permission-utils";

/** "08 Oct 2026": the same everywhere, and never read as the 10th of August. */
const formatOrderDate = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Lagos" })
    : "—";

/** Lines that bring stock in: a name and a quantity above 0. */
const receivableCount = (order) =>
  (order.products || []).filter((line) => String(line.name || "").trim() && Number(line.quantity) > 0).length;

/**
 * Orders placed with vendors that have not been received yet.
 *
 * This is the step between placing an order and paying for it: orders wait here, can be
 * merged so a vendor gets one order instead of five, and are received here, which raises
 * the purchase order and takes you to the receive screen to book the stock in. An order
 * stays here until its stock is booked; if the receive screen is left or fails, Receive
 * picks up where it stopped.
 */
export default function StockOrderList({ orders = [], loading = false, onChanged }) {
  const router = useRouter();
  // Receiving, deleting and merging are for a manager; basic staff see and edit orders
  // (lib/permission-utils.js). Without merging there is nothing to tick, so no checkboxes either.
  const { user } = useAuth();
  const canReceive = !isBasicStaffRole(user?.role);
  const canMerge = canReceive;
  const columnCount = canMerge ? 7 : 6;
  const [selected, setSelected] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);
  const [draftLines, setDraftLines] = useState(null); // edits to the expanded order
  const [busyId, setBusyId] = useState("");
  const [merging, setMerging] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState([]);

  const total = useMemo(
    () => orders.reduce((sum, order) => sum + (Number(order.grandTotal) || 0), 0),
    [orders]
  );

  const selectedOrders = useMemo(() => orders.filter((order) => selected.has(order._id)), [orders, selected]);
  const vendorsInSelection = new Set(selectedOrders.map((order) => String(order.vendor?._id || order.vendor || "")));

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = orders.length > 0 && orders.every((order) => selected.has(order._id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(orders.map((order) => order._id)));

  const refresh = () => {
    setSelected(new Set());
    setExpandedId(null);
    setDraftLines(null);
    onChanged?.();
  };

  /* ─── Adding a product to the order being edited ─────────────── */

  useEffect(() => {
    const term = productSearch.trim();
    if (!expandedId || term.length < 2) {
      setProductResults([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data } = await apiClient.get(`/api/products?search=${encodeURIComponent(term)}&limit=8`);
        if (!cancelled) setProductResults(data?.data || (Array.isArray(data) ? data : []));
      } catch {
        if (!cancelled) setProductResults([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [productSearch, expandedId]);

  const addLine = (product) => {
    setDraftLines((prev) => [
      ...(prev || []),
      {
        productId: product._id,
        name: product.name,
        quantity: 1,
        price: Number(product.costPrice) || 0,
        total: Number(product.costPrice) || 0,
        supplyPackSize: 1,
        supplyPackLabel: "",
      },
    ]);
    setProductSearch("");
    setProductResults([]);
  };

  const removeLine = (index) => setDraftLines((prev) => prev.filter((_, i) => i !== index));

  /* ─── Actions ─────────────────────────────────────────────────── */

  const merge = async (scope) => {
    const body = scope === "all" ? { all: true } : { ids: [...selected] };
    if (scope !== "all" && selected.size < 2) {
      await showAlertDialog({ title: "Pick two or more", message: "Select at least two orders to merge.", tone: "warning" });
      return;
    }
    const ok = await showConfirmDialog({
      title: "Merge orders?",
      message:
        scope === "all"
          ? "Every order still on order will be merged into one per vendor. Lines for the same product are added together. Orders already being received are left as they are."
          : `${selected.size} orders will be merged into one per vendor (${vendorsInSelection.size} vendor${vendorsInSelection.size === 1 ? "" : "s"}). Lines for the same product are added together.`,
      confirmLabel: "Merge",
    });
    if (!ok) return;

    setMerging(true);
    try {
      const { data } = await apiClient.post("/api/stock-orders/merge", body);
      await showAlertDialog({
        title: "Orders merged",
        message: [data.message, ...(data.warnings || [])].filter(Boolean).join("\n\n"),
        tone: data.created > 0 ? "success" : "info",
      });
      refresh();
    } catch (err) {
      await showAlertDialog({
        title: "Merge failed",
        message: err.response?.data?.error || "Could not merge these orders.",
        tone: "danger",
      });
    } finally {
      setMerging(false);
    }
  };

  const receive = async (order) => {
    // Nothing to book in: the receive screen would open empty
    if (receivableCount(order) === 0) {
      await showAlertDialog({
        title: "Nothing to receive yet",
        message:
          (order.products || []).length === 0
            ? "This order has a total but no products on it. Open View / Edit, add the products that came, then receive it."
            : "Every product on this order has a quantity of 0. Open View / Edit and enter the quantities that came, then receive it.",
        tone: "warning",
      });
      return;
    }

    if (!order.receiving) {
      const ok = await showConfirmDialog({
        title: `Receive ${order.supplier || "this order"}?`,
        message:
          "This raises the purchase order for payment tracking and opens the receive screen, where you confirm quantities, expiry dates and the location. The order stays here until the stock is booked in there.",
        confirmLabel: "Receive",
      });
      if (!ok) return;
    }

    setBusyId(order._id);
    try {
      const { data } = await apiClient.put(`/api/stock-orders/${order._id}`, { action: "receive" });
      onChanged?.();
      router.push(`/stock/add?poId=${data.purchaseOrderId}`);
    } catch (err) {
      await showAlertDialog({
        title: "Could not receive",
        message: err.response?.data?.error || "Failed to receive this order.",
        tone: "danger",
      });
      setBusyId("");
    }
  };

  const remove = async (order) => {
    const ok = await showConfirmDialog({
      title: "Delete this order?",
      message: `${order.supplier || "This order"}: ${formatCurrency(order.grandTotal)}.${
        order.receiving ? " Receiving had started; its purchase order is removed too, since no stock was booked." : ""
      } This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;

    setBusyId(order._id);
    try {
      await apiClient.delete(`/api/stock-orders/${order._id}`);
      refresh();
    } catch (err) {
      await showAlertDialog({
        title: "Could not delete",
        message: err.response?.data?.error || "Failed to delete this order.",
        tone: "danger",
      });
    } finally {
      setBusyId("");
    }
  };

  const openOrder = (order) => {
    setProductSearch("");
    setProductResults([]);
    if (expandedId === order._id) {
      setExpandedId(null);
      setDraftLines(null);
      return;
    }
    setExpandedId(order._id);
    setDraftLines((order.products || []).map((product) => ({ ...product })));
  };

  const updateLine = (index, field, value) => {
    setDraftLines((prev) =>
      prev.map((line, i) => {
        if (i !== index) return line;
        const next = { ...line, [field]: value === "" ? "" : Number(value) };
        next.total = (Number(next.quantity) || 0) * (Number(next.price) || 0);
        return next;
      })
    );
  };

  const saveLines = async (order) => {
    if (!draftLines || draftLines.length === 0) {
      await showAlertDialog({ title: "Add a product", message: "An order needs at least one product.", tone: "warning" });
      return;
    }
    setBusyId(order._id);
    try {
      await apiClient.put(`/api/stock-orders/${order._id}`, {
        products: draftLines.map((line) => ({
          productId: line.productId,
          name: line.name,
          quantity: Number(line.quantity) || 0,
          price: Number(line.price) || 0,
          total: (Number(line.quantity) || 0) * (Number(line.price) || 0),
          // Carried through, or an order in the vendor's cartons would come back as
          // that many single units when it is received.
          supplyPackSize: line.supplyPackSize || 1,
          supplyPackLabel: line.supplyPackLabel || "",
        })),
      });
      refresh();
    } catch (err) {
      await showAlertDialog({
        title: "Could not save",
        message: err.response?.data?.error || "Failed to save the changes.",
        tone: "danger",
      });
    } finally {
      setBusyId("");
    }
  };

  const draftTotal = useMemo(
    () => (draftLines || []).reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.price) || 0), 0),
    [draftLines]
  );

  /* ─── Render ──────────────────────────────────────────────────── */

  return (
    <section className="content-card">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-800">
          Submitted Stock Orders <span className="text-gray-400">({orders.length})</span>
        </h2>
        {orders.length > 0 && (
          <span className="text-sm text-gray-500">Worth {formatCurrency(total)}</span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {canMerge && selected.size >= 2 && (
            <button onClick={() => merge("selected")} disabled={merging} className="btn-action btn-action-primary btn-sm disabled:opacity-50">
              {merging ? "Merging…" : `Merge ${selected.size} selected`}
            </button>
          )}
          {canMerge && orders.length >= 2 && (
            <button onClick={() => merge("all")} disabled={merging} className="btn-action btn-action-secondary btn-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              <Layers className="w-3.5 h-3.5" aria-hidden="true" /> Merge all by vendor
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <Loader size="sm" text="Loading stock orders..." />
      ) : orders.length === 0 ? (
        <div className="text-center py-8 rounded-lg border-2 border-dashed theme-border-soft theme-surface-soft">
          <p className="text-gray-600">No stock orders waiting. Place an order with a vendor above.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b theme-border-soft text-gray-600 text-xs uppercase">
                {canMerge && (
                  <th className="py-3 px-2 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all orders" className="h-4 w-4 p-0" />
                  </th>
                )}
                <th className="py-3 px-2 text-left whitespace-nowrap">Date</th>
                <th className="py-3 px-2 text-left">Vendor</th>
                <th className="py-3 px-2 text-left">Contact</th>
                <th className="py-3 px-2 text-center">Products</th>
                <th className="py-3 px-2 text-right">Total</th>
                <th className="py-3 px-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {orders.map((order) => {
                const isOpen = expandedId === order._id;
                const busy = busyId === order._id;
                const lineCount = order.products?.length || 0;
                const nothingToReceive = receivableCount(order) === 0;
                return (
                  <Fragment key={order._id}>
                    <tr className="hover:bg-gray-50 transition align-top">
                      {canMerge && (
                        <td className="py-3 px-2">
                          <input
                            type="checkbox"
                            checked={selected.has(order._id)}
                            onChange={() => toggle(order._id)}
                            aria-label={`Select ${order.supplier || "order"}`}
                            className="h-4 w-4 p-0"
                          />
                        </td>
                      )}
                      <td className="py-3 px-2 whitespace-nowrap text-gray-700">{formatOrderDate(order.date || order.createdAt)}</td>
                      <td className="py-3 px-2">
                        <p className="font-medium text-gray-800">{order.supplier || order.vendor?.companyName || "—"}</p>
                        {(order.mergedFrom?.length > 0 || order.receiving) && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {order.mergedFrom?.length > 0 && (
                              <span className="theme-badge-soft text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap">
                                Merged from {order.mergedFrom.length} orders
                              </span>
                            )}
                            {order.receiving && (
                              <span
                                className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                                title="Receive was started but the stock was not booked in. Continue receiving to finish it."
                              >
                                <PackageCheck className="w-3 h-3" aria-hidden="true" /> Receiving: stock not booked yet
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-2 text-xs text-gray-500 max-w-[9rem] break-words">{order.contact || "—"}</td>
                      <td className="py-3 px-2 text-center">
                        {nothingToReceive ? (
                          <span
                            className="inline-flex items-center gap-1 text-amber-700 font-medium"
                            title={lineCount === 0 ? "No products on this order yet" : "Every product is ordered as 0"}
                          >
                            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> {lineCount}
                          </span>
                        ) : (
                          <span className="text-gray-600">{lineCount}</span>
                        )}
                      </td>
                      <td className="py-3 px-2 text-right whitespace-nowrap font-semibold">{formatCurrency(order.grandTotal)}</td>
                      <td className="py-3 px-2">
                        <div className="flex flex-nowrap justify-end gap-2">
                          <button onClick={() => openOrder(order)} className="btn-action btn-action-secondary btn-sm whitespace-nowrap">
                            {isOpen ? "Close" : "View / Edit"}
                          </button>
                          {canReceive && (
                          <button
                            onClick={() => receive(order)}
                            disabled={busy}
                            className="btn-action btn-action-success btn-sm whitespace-nowrap disabled:opacity-50"
                          >
                            {busy ? "…" : order.receiving ? "Continue receiving" : "Receive"}
                          </button>
                          )}
                          {canReceive && (
                          <button
                            onClick={() => remove(order)}
                            disabled={busy}
                            aria-label={`Delete the order for ${order.supplier || "this vendor"}`}
                            title="Delete this order"
                            className="btn-action btn-action-danger btn-sm inline-flex items-center justify-center disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isOpen && draftLines && (
                      <tr>
                        <td colSpan={columnCount} className="bg-gray-50 px-4 py-4">
                          {draftLines.length === 0 && (
                            <p className="mb-3 text-sm text-amber-700">
                              No products on this order yet. Add the products that were ordered below.
                            </p>
                          )}
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs uppercase text-gray-500">
                                  <th className="text-left py-2">Product</th>
                                  <th className="text-right py-2 w-28">Quantity</th>
                                  <th className="text-right py-2 w-32">Unit price</th>
                                  <th className="text-right py-2 w-32">Total</th>
                                  <th className="w-10" aria-label="Remove" />
                                </tr>
                              </thead>
                              <tbody>
                                {draftLines.map((line, index) => (
                                  <tr key={index} className="border-t theme-border-soft">
                                    <td className="py-2 pr-3 text-gray-800">
                                      {line.name}
                                      {(line.supplyPackSize || 1) > 1 && (
                                        <span className="block text-xs text-gray-500">
                                          ordered by the {(line.supplyPackLabel || "pack").toLowerCase()} of{" "}
                                          {line.supplyPackSize}: {((Number(line.quantity) || 0) * line.supplyPackSize).toLocaleString()} units
                                          into stock
                                        </span>
                                      )}
                                      {!(Number(line.quantity) > 0) && (
                                        <span className="block text-xs text-amber-700">Quantity 0: nothing of this is received</span>
                                      )}
                                    </td>
                                    <td className="py-2">
                                      <input
                                        type="number"
                                        min="0"
                                        value={line.quantity}
                                        onChange={(e) => updateLine(index, "quantity", e.target.value)}
                                        onWheel={(e) => e.currentTarget.blur()}
                                        className="form-input !w-24 !py-1 text-sm text-right"
                                      />
                                    </td>
                                    <td className="py-2">
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={line.price}
                                        onChange={(e) => updateLine(index, "price", e.target.value)}
                                        onWheel={(e) => e.currentTarget.blur()}
                                        className="form-input !w-28 !py-1 text-sm text-right"
                                      />
                                    </td>
                                    <td className="py-2 text-right font-medium">
                                      {formatCurrency((Number(line.quantity) || 0) * (Number(line.price) || 0))}
                                    </td>
                                    <td className="py-2 text-right">
                                      <button
                                        type="button"
                                        onClick={() => removeLine(index)}
                                        aria-label={`Remove ${line.name}`}
                                        className="p-1 text-red-500 hover:bg-red-50 rounded"
                                      >
                                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t theme-border-soft">
                                  <td colSpan={3} className="py-2 text-right font-semibold text-gray-700">
                                    Order total
                                  </td>
                                  <td className="py-2 text-right font-bold text-gray-900">{formatCurrency(draftTotal)}</td>
                                  <td />
                                </tr>
                              </tfoot>
                            </table>
                          </div>

                          {/* Add a product line */}
                          <div className="relative mt-3 max-w-md">
                            <div className="flex items-center gap-2">
                              <Plus className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
                              <input
                                type="text"
                                value={productSearch}
                                onChange={(e) => setProductSearch(e.target.value)}
                                placeholder="Add a product: type its name or barcode"
                                className="form-input !py-1.5 text-sm"
                                aria-label="Add a product to this order"
                              />
                            </div>
                            {productResults.length > 0 && (
                              <div className="absolute z-10 left-6 right-0 mt-1 max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                                {productResults.map((product) => (
                                  <button
                                    key={product._id}
                                    type="button"
                                    onClick={() => addLine(product)}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-100 last:border-0"
                                  >
                                    <span className="font-medium text-gray-800">{product.name}</span>
                                    <span className="block text-xs text-gray-500">
                                      Cost {formatCurrency(Number(product.costPrice) || 0)}
                                      {product.barcode ? ` · ${product.barcode}` : ""}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="flex justify-end gap-2 mt-3">
                            <button onClick={() => openOrder(order)} className="btn-action btn-action-secondary btn-sm">
                              Cancel
                            </button>
                            <button
                              onClick={() => saveLines(order)}
                              disabled={busy}
                              className="btn-action btn-action-primary btn-sm disabled:opacity-50"
                            >
                              {busy ? "Saving…" : "Save changes"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
