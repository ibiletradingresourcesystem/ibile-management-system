import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";
import { Loader } from "@/components/ui";

/**
 * Orders placed with vendors that have not been received yet.
 *
 * This is the step between placing an order and paying for it: orders wait here, can be
 * merged so a vendor gets one order instead of five, and are received here — which
 * raises the purchase order and takes you to the receive screen to book the stock in.
 */
export default function StockOrderList({ orders = [], loading = false, onChanged }) {
  const router = useRouter();
  const [selected, setSelected] = useState(new Set());
  const [expandedId, setExpandedId] = useState(null);
  const [draftLines, setDraftLines] = useState(null); // edits to the expanded order
  const [busyId, setBusyId] = useState("");
  const [merging, setMerging] = useState(false);

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
          ? "Every order still on order will be merged into one per vendor. Lines for the same product are added together."
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
    const ok = await showConfirmDialog({
      title: `Receive ${order.supplier || "this order"}?`,
      message:
        "This raises the purchase order for payment tracking and opens the receive screen, where you confirm quantities, expiry dates and the location. Stock changes only when you confirm there.",
      confirmLabel: "Receive",
    });
    if (!ok) return;

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
      message: `${order.supplier || "This order"} — ${formatCurrency(order.grandTotal)}. This cannot be undone.`,
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
          {selected.size >= 2 && (
            <button onClick={() => merge("selected")} disabled={merging} className="btn-action btn-action-primary btn-sm disabled:opacity-50">
              {merging ? "Merging…" : `Merge ${selected.size} selected`}
            </button>
          )}
          {orders.length >= 2 && (
            <button onClick={() => merge("all")} disabled={merging} className="btn-action btn-action-secondary btn-sm disabled:opacity-50">
              🧩 Merge all by vendor
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b theme-border-soft text-gray-600 text-xs uppercase">
                <th className="py-3 px-2 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all orders" />
                </th>
                <th className="py-3 px-3 text-left">Date</th>
                <th className="py-3 px-3 text-left">Vendor</th>
                <th className="py-3 px-3 text-left">Contact</th>
                <th className="py-3 px-3 text-center">Products</th>
                <th className="py-3 px-3 text-right">Total</th>
                <th className="py-3 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {orders.map((order) => {
                const isOpen = expandedId === order._id;
                const busy = busyId === order._id;
                return (
                  <Fragment key={order._id}>
                    <tr className="hover:bg-gray-50 transition">
                      <td className="py-3 px-2">
                        <input
                          type="checkbox"
                          checked={selected.has(order._id)}
                          onChange={() => toggle(order._id)}
                          aria-label={`Select ${order.supplier || "order"}`}
                        />
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-gray-700">
                        {order.date ? new Date(order.date).toLocaleDateString() : "—"}
                      </td>
                      <td className="py-3 px-3 font-medium text-gray-800">
                        {order.supplier || order.vendor?.companyName || "—"}
                        {order.mergedFrom?.length > 0 && (
                          <span className="ml-2 theme-badge-soft text-[10px] px-2 py-0.5 rounded-full">
                            merged from {order.mergedFrom.length}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-xs text-gray-500">{order.contact || "—"}</td>
                      <td className="py-3 px-3 text-center text-gray-600">{order.products?.length || 0}</td>
                      <td className="py-3 px-3 text-right whitespace-nowrap font-semibold">{formatCurrency(order.grandTotal)}</td>
                      <td className="py-3 px-3">
                        <div className="flex flex-wrap justify-center gap-2">
                          <button onClick={() => openOrder(order)} className="btn-action btn-action-secondary btn-sm">
                            {isOpen ? "Close" : "View / Edit"}
                          </button>
                          <button
                            onClick={() => receive(order)}
                            disabled={busy}
                            className="btn-action btn-action-success btn-sm disabled:opacity-50"
                          >
                            {busy ? "…" : "Receive"}
                          </button>
                          <button
                            onClick={() => remove(order)}
                            disabled={busy}
                            className="btn-action btn-action-danger btn-sm disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isOpen && draftLines && (
                      <tr>
                        <td colSpan={7} className="bg-gray-50 px-4 py-4">
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs uppercase text-gray-500">
                                  <th className="text-left py-2">Product</th>
                                  <th className="text-right py-2 w-28">Quantity</th>
                                  <th className="text-right py-2 w-32">Unit price</th>
                                  <th className="text-right py-2 w-32">Total</th>
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
                                          {line.supplyPackSize} — {((Number(line.quantity) || 0) * line.supplyPackSize).toLocaleString()} units
                                          into stock
                                        </span>
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
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t theme-border-soft">
                                  <td colSpan={3} className="py-2 text-right font-semibold text-gray-700">
                                    Order total
                                  </td>
                                  <td className="py-2 text-right font-bold text-gray-900">{formatCurrency(draftTotal)}</td>
                                </tr>
                              </tfoot>
                            </table>
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
