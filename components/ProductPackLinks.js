import axios from "axios";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatCurrency } from "@/lib/format";
import { showConfirmDialog } from "@/lib/dialogs";
import { clearCache } from "@/lib/useIndexedDBCache";
import { childQtyToParentQty, getPackSize, getUnitsPerChild, isDerivedChild } from "@/lib/packUnits";
import ProductPicker from "@/components/ProductPicker";

function formatQty(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? String(parseFloat(n.toFixed(2))) : "0";
}

function getErrorMessage(err, fallback) {
  return err?.response?.data?.message || err?.response?.data?.error || fallback;
}

/**
 * Parent/child (mother/child) links for an existing product.
 * - Pack products: list linked children and link more existing products as children.
 * - Child products: show the parent, change units, or unlink.
 * - Other products: link this product as a child of an existing pack.
 */
export default function ProductPackLinks({ productId, onRelationsChange }) {
  const [relations, setRelations] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [selected, setSelected] = useState(null);
  const [units, setUnits] = useState("1");
  const [moveStock, setMoveStock] = useState(false);
  const [costFromParent, setCostFromParent] = useState(true);
  const [unitDrafts, setUnitDrafts] = useState({});
  const onRelationsChangeRef = useRef(onRelationsChange);
  onRelationsChangeRef.current = onRelationsChange;

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`/api/products/links?productId=${productId}`);
      const data = res.data?.data || null;
      setRelations(data);
      setUnitDrafts({});
      onRelationsChangeRef.current?.(data);
    } catch (err) {
      setError(getErrorMessage(err, "Could not load linked products."));
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  const product = relations?.product;
  const parent = relations?.parent;
  const children = relations?.children || [];
  const isChild = Boolean(product && isDerivedChild(product) && parent);
  const isPack = Boolean(product && !isChild && product.packType === "pack" && getPackSize(product) > 1);
  const mode = isChild ? "child" : isPack ? "pack" : "standalone";

  async function runMutation(request, successMessage) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await request();
      await Promise.allSettled([clearCache("products_cache"), clearCache("stock_products_cache")]);
      setNotice(res?.data?.message || successMessage);
      setSelected(null);
      setUnits("1");
      setMoveStock(false);
      await load();
    } catch (err) {
      setError(getErrorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  function linkSelected() {
    if (!selected) return;
    const payload =
      mode === "pack"
        ? { parentId: product._id, childId: selected._id }
        : { parentId: selected._id, childId: product._id };
    runMutation(() =>
      axios.post("/api/products/links", {
        ...payload,
        unitsPerChild: Number(units),
        moveStockToParent: moveStock,
        costFromParent,
      })
    );
  }

  function saveUnits(child) {
    const draft = unitDrafts[child._id];
    if (draft === undefined || Number(draft) === getUnitsPerChild(child)) return;
    runMutation(() => axios.patch("/api/products/links", { childId: child._id, unitsPerChild: Number(draft) }));
  }

  async function unlink(child) {
    const confirmed = await showConfirmDialog({
      title: "Unlink child product?",
      message: `"${child.name}" will stop taking its stock from the pack and will start with 0 stock of its own.`,
      tone: "warning",
      confirmLabel: "Unlink",
      cancelLabel: "Keep linked",
    });
    if (!confirmed) return;
    runMutation(() => axios.delete(`/api/products/links?childId=${child._id}`));
  }

  function candidateStatus(candidate) {
    const id = String(candidate._id);
    if (id === String(product?._id)) return { disabled: true, note: "This product" };
    if (mode === "pack") {
      const currentParentId = String(candidate.parentProduct?._id || candidate.parentProduct || "");
      if (candidate.childCount > 0) return { disabled: true, note: `Parent of ${candidate.childCount} product(s)` };
      if (isDerivedChild(candidate) && currentParentId === String(product._id)) {
        return { disabled: true, note: "Already linked" };
      }
      if (isDerivedChild(candidate)) {
        return { disabled: false, note: `Currently in "${candidate.parentProduct?.name || "another pack"}" — will move` };
      }
      if (candidate.packType === "pack") return { disabled: false, note: "Its pack settings will be cleared" };
      return { disabled: false, note: "" };
    }
    // Standalone product looking for a parent pack
    if (isDerivedChild(candidate)) return { disabled: true, note: "Is a child product" };
    if (candidate.packType !== "pack" || getPackSize(candidate) <= 1) return { disabled: true, note: "Not a pack" };
    return { disabled: false, note: `Pack of ${candidate.qtyPerPack}` };
  }

  if (loading) {
    return <p className="mt-4 text-sm text-gray-500">Loading linked products…</p>;
  }
  if (!product) {
    return error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null;
  }

  const packProduct = isChild ? parent : product;
  const packSize = getPackSize(packProduct);
  const baseUnits = Number(packProduct.quantity || 0) * packSize;
  const unitsNumber = Number(units);
  const unitsValid = Number.isInteger(unitsNumber) && unitsNumber >= 1;

  // Stock that would move into the parent pack if the user ticks the box
  const stockOwner = mode === "pack" ? selected : product;
  const stockTarget = mode === "pack" ? product : selected;
  const movableStock =
    stockOwner && stockTarget && !isDerivedChild(stockOwner) && Number(stockOwner.quantity) > 0
      ? Number(stockOwner.quantity)
      : 0;
  const parentPackSize = stockTarget ? getPackSize(stockTarget) : 1;
  const childCostShare = stockTarget ? ((Number(stockTarget.costPrice) || 0) / parentPackSize) * unitsNumber : 0;
  const unitsTooLarge = selected && unitsValid && unitsNumber > parentPackSize;

  return (
    <div className="mt-5 space-y-4">
      {(error || notice) && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            error ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"
          }`}
        >
          {error || notice}
        </div>
      )}

      {isChild && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <p>
            Child of{" "}
            <Link href={`/products/edit/${parent._id}`} className="font-semibold underline">
              {parent.name}
            </Link>{" "}
            (pack of {parent.qtyPerPack}). One of this item = <strong>{getUnitsPerChild(product)}</strong> unit(s) of
            the pack.
          </p>
          <p className="mt-1">
            Stock is taken from the parent: <strong>{formatQty(product.quantity)}</strong> available (
            {formatQty(parent.quantity)} packs × {parent.qtyPerPack} ÷ {getUnitsPerChild(product)}).
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium">Units per item</label>
            <input
              type="number"
              min="1"
              max={parent.qtyPerPack}
              step="1"
              className="form-input !w-24 !py-1"
              value={unitDrafts[product._id] ?? getUnitsPerChild(product)}
              onChange={(e) => setUnitDrafts((prev) => ({ ...prev, [product._id]: e.target.value }))}
              onWheel={(e) => e.currentTarget.blur()}
            />
            <button type="button" className="btn-action-secondary !py-1 text-xs" disabled={busy} onClick={() => saveUnits(product)}>
              Save units
            </button>
            <button type="button" className="btn-action-danger !py-1 text-xs" disabled={busy} onClick={() => unlink(product)}>
              Unlink from parent
            </button>
          </div>
        </div>
      )}

      {(isPack || isChild) && (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold text-gray-800">
              {isChild ? "All items from this pack" : "Linked child products"} ({children.length})
            </h4>
            <p className="text-xs text-gray-500">
              Pack stock: {formatQty(packProduct.quantity)} × {packSize} = {formatQty(baseUnits)} units
            </p>
          </div>
          {children.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-gray-500">
              No child products yet. Search below to link existing products.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-600">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Units each</th>
                    <th className="px-3 py-2">Stock</th>
                    <th className="px-3 py-2">Cost</th>
                    <th className="px-3 py-2">Sale</th>
                    {isPack && <th className="px-3 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {children.map((child) => {
                    const draft = unitDrafts[child._id];
                    const unitsChanged = draft !== undefined && Number(draft) !== getUnitsPerChild(child);
                    const isCurrent = String(child._id) === String(product._id);
                    return (
                      <tr key={child._id} className={`border-t ${isCurrent ? "bg-blue-50" : ""}`}>
                        <td className="px-3 py-2">
                          {isCurrent ? (
                            <span className="font-medium">{child.name} (this product)</span>
                          ) : (
                            <Link href={`/products/edit/${child._id}`} className="font-medium text-blue-700 hover:underline">
                              {child.name}
                            </Link>
                          )}
                          {child.barcode && <div className="font-mono text-xs text-gray-500">{child.barcode}</div>}
                        </td>
                        <td className="px-3 py-2">
                          {isPack ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="1"
                                max={packSize}
                                step="1"
                                className="form-input !w-20 !py-1"
                                value={draft ?? getUnitsPerChild(child)}
                                onChange={(e) => setUnitDrafts((prev) => ({ ...prev, [child._id]: e.target.value }))}
                                onWheel={(e) => e.currentTarget.blur()}
                              />
                              {unitsChanged && (
                                <button
                                  type="button"
                                  className="btn-action-secondary !px-2 !py-1 text-xs"
                                  disabled={busy}
                                  onClick={() => saveUnits(child)}
                                >
                                  Save
                                </button>
                              )}
                            </div>
                          ) : (
                            getUnitsPerChild(child)
                          )}
                        </td>
                        <td className="px-3 py-2 font-semibold">{formatQty(child.quantity)}</td>
                        <td className="px-3 py-2">{formatCurrency(child.costPrice)}</td>
                        <td className="px-3 py-2">{formatCurrency(child.salePriceIncTax)}</td>
                        {isPack && (
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              className="text-xs font-medium text-red-600 hover:underline"
                              disabled={busy}
                              onClick={() => unlink(child)}
                            >
                              Unlink
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {mode !== "child" && (
        <div className="rounded-lg border border-gray-200 p-4">
          <h4 className="text-sm font-semibold text-gray-800">
            {mode === "pack" ? "Link an existing product as a child" : "Link this product to a parent pack"}
          </h4>
          <p className="mt-1 mb-3 text-xs text-gray-500">
            {mode === "pack"
              ? `The child takes its stock from this pack. Set how many of the ${packSize} units one child item holds.`
              : "Only pack products are listed. To make this product a mother (parent) instead, set Pack Type to Pack with Qty Per Pack, save, then link children here."}
          </p>

          <ProductPicker
            packsOnly={mode === "standalone"}
            getStatus={candidateStatus}
            selected={selected}
            placeholder={mode === "pack" ? "Pick a product or type to search…" : "Pick a parent pack or type to search…"}
            onSelect={(candidate) => {
              setSelected(candidate);
              setMoveStock(false);
              setUnits("1");
            }}
          />

          {selected && (
            <div className="mt-3 space-y-3 rounded-lg bg-gray-50 p-3 text-sm">
              <p>
                {mode === "pack" ? (
                  <>
                    Child: <strong>{selected.name}</strong> → parent: <strong>{product.name}</strong> (pack of {packSize})
                  </>
                ) : (
                  <>
                    Child: <strong>{product.name}</strong> → parent: <strong>{selected.name}</strong> (pack of{" "}
                    {selected.qtyPerPack})
                  </>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-medium text-gray-700">Units in one child item</label>
                <input
                  type="number"
                  min="1"
                  max={parentPackSize}
                  step="1"
                  className="form-input !w-24 !py-1"
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                />
                <span className="text-xs text-gray-500">of {parentPackSize}</span>
              </div>
              {unitsTooLarge && (
                <p className="text-xs text-red-600">Units can't be more than the pack size ({parentPackSize}).</p>
              )}
              {movableStock > 0 && unitsValid && (
                <label className="flex items-start gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={moveStock}
                    onChange={(e) => setMoveStock(e.target.checked)}
                  />
                  <span>
                    Move {mode === "pack" ? "its" : "this product's"} current stock ({formatQty(movableStock)}) into the
                    pack (+
                    {formatQty(childQtyToParentQty(movableStock, { unitsPerChild: unitsNumber }, stockTarget))} packs).
                    Otherwise that stock is dropped and the child only shows what the pack holds.
                  </span>
                </label>
              )}
              {unitsValid && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs font-medium text-gray-700">Cost source</label>
                  <div
                    role="radiogroup"
                    aria-label="Cost source"
                    className="inline-flex gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5"
                  >
                    {[
                      { value: true, label: "From pack" },
                      { value: false, label: "Own cost" },
                    ].map((choice) => {
                      const active = costFromParent === choice.value;
                      return (
                        <button
                          key={choice.label}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setCostFromParent(choice.value)}
                          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                            active ? "bg-blue-50 text-blue-700 ring-1 ring-blue-200" : "text-gray-600 hover:text-gray-900"
                          }`}
                        >
                          {choice.label}
                        </button>
                      );
                    })}
                  </div>
                  {costFromParent && childCostShare > 0 && (
                    <span className="text-xs text-gray-500">
                      {formatCurrency(childCostShare)} · {unitsNumber} of {parentPackSize}
                    </span>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-action-primary !py-1.5 text-sm"
                  disabled={busy || !unitsValid || unitsTooLarge}
                  onClick={linkSelected}
                >
                  {busy ? "Linking…" : "Link product"}
                </button>
                <button type="button" className="btn-action-secondary !py-1.5 text-sm" onClick={() => setSelected(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
