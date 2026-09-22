import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import Layout from "@/components/Layout";
import { formatCurrency } from "@/lib/format";
import { Loader } from "@/components/ui";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { useAuth } from "@/lib/useAuth";
import { formatVendorMovementLabel } from "@/lib/vendorDisplay";
import {
  childQtyToParentQty,
  formatPackQuantity,
  getPackSize,
  isDerivedChild,
  isPackProduct,
  splitPackQuantity,
} from "@/lib/packUnits";
import { calculateMarginPercent, calculateSalePriceIncTax, roundMoney } from "@/lib/pricing";

/** Reasons that take stock out of a location, and so can run it short. */
const OUTBOUND_REASONS = new Set(["Transfer", "Return", "Adjustment", "Operational Loss"]);

let lineCounter = 0;
/** Stable identity for a line, so removing one never shifts another's inputs. */
const newLineId = () => `line-${Date.now()}-${(lineCounter += 1)}`;

/**
 * A movement line: the product plus what is being moved. The product's own
 * `quantity` is its stock, so it is kept as `stockOnHand` before `quantity`
 * becomes the amount on this line.
 */
function makeLine(product, quantity, expiryDate = "", extra = {}) {
  return {
    ...product,
    ...extra,
    lineId: newLineId(),
    stockOnHand: Number(product.quantity) || 0,
    quantity,
    expiryDate,
  };
}

/** A date for a date input: "2026-09-22", whatever form it arrived in. */
function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function isPastDate(value) {
  if (!value) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${toDateInput(value)}T00:00:00`) < today;
}

/** Does this product carry `code` as one of its barcodes? */
function hasBarcode(product, code) {
  const wanted = String(code || "").trim().toLowerCase();
  if (!wanted) return false;
  return String(product?.barcode || "")
    .split(/[,;\s|]+/)
    .some((candidate) => candidate.trim().toLowerCase() === wanted);
}

function marginOf(line) {
  return calculateMarginPercent(line.costPrice, line.salePriceIncTax);
}

/**
 * A child holds no stock of its own; its count moves its parent pack. Given any product,
 * return the product whose stock actually changes and the pack quantity `qty` of the
 * original amounts to — 12 singles of a 24-carton is half a carton.
 */
async function resolveStockTarget(product, qty) {
  if (!isDerivedChild(product)) return { product, quantity: qty };

  const parentId = typeof product.parentProduct === "object" ? product.parentProduct._id : product.parentProduct;
  try {
    const res = await apiClient.get(`/api/products?id=${parentId}`);
    const parent = res.data?.data || res.data;
    if (parent?._id) {
      return { product: parent, quantity: childQtyToParentQty(qty, product, parent), from: product };
    }
  } catch {
    // Fall through to the child itself; the movement API resolves it again on save.
  }
  return { product, quantity: qty };
}

export default function StockMovementAdd() {
  const router = useRouter();
  const { isAdmin } = useAuth();

  const [locations, setLocations] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [reasons] = useState(["Restock", "Transfer", "Return", "Adjustment", "Operational Loss"]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [staff, setStaff] = useState("");
  const [reason, setReason] = useState("");
  const [movementNotes, setMovementNotes] = useState("");

  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [quantityInput, setQuantityInput] = useState(1); // in the product's stock unit (packs for a pack)
  const [expiryDateInput, setExpiryDateInput] = useState("");
  const [lines, setLines] = useState([]);

  const [poRef, setPoRef] = useState(null);
  const [poLoading, setPoLoading] = useState(false);
  const [unmatchedProducts, setUnmatchedProducts] = useState([]);
  const [savingPrices, setSavingPrices] = useState({});

  const searchInputRef = useRef(null);
  const searchSeq = useRef(0);

  const isOperationalLoss = reason === "Operational Loss";
  const requiresDestination = !isOperationalLoss;
  const isPurchaseOrderReceipt = Boolean(poRef?.id);
  const isOutbound = OUTBOUND_REASONS.has(reason);

  /* ─── Reference data ──────────────────────────────────────────── */

  useEffect(() => {
    fetch("/api/setup/setup")
      .then((res) => res.json())
      .then((data) => {
        if (data?.store?.locations) {
          setLocations(data.store.locations.map((loc) => ({ _id: loc._id, name: loc.name || loc })));
        }
      })
      .catch((err) => console.error("Error fetching locations:", err));

    fetch("/api/staff")
      .then((res) => res.json())
      .then((data) => setStaffList(Array.isArray(data) ? data : data.data || []))
      .catch((err) => console.error("Error fetching staff:", err));
  }, []);

  /* ─── Arriving from a purchase order ──────────────────────────── */

  useEffect(() => {
    if (!router.isReady || !router.query.poId) return;
    const poId = router.query.poId;
    setPoLoading(true);

    (async () => {
      try {
        const res = await apiClient.get(`/api/purchase-orders/${poId}`);
        const order = res.data?.order || res.data;
        if (!order) return;
        setPoRef({ id: poId, orderRef: order.orderRef, vendorName: order.vendorName });
        setFromLocation("vendor");
        setReason("Restock");

        const matched = [];
        const unmatched = [];
        for (const poProduct of order.products || []) {
          if (!poProduct.name && !poProduct.productId) continue;
          const poQty = Number(poProduct.quantity) || 1;

          try {
            let found = null;

            // 1. The PO's own product id is the reliable link
            if (poProduct.productId) {
              try {
                const idRes = await apiClient.get(`/api/products?id=${poProduct.productId}`);
                const product = idRes.data?.data || idRes.data;
                if (product?._id) found = product;
              } catch {
                // fall through to a name search
              }
            }

            // 2. Otherwise match by name
            if (!found && poProduct.name) {
              const pRes = await apiClient.get(
                `/api/products?search=${encodeURIComponent(poProduct.name)}&excludeChild=true`
              );
              const list = pRes.data?.data || (Array.isArray(pRes.data) ? pRes.data : []);
              const wanted = poProduct.name.toLowerCase();
              found =
                list.find((p) => p.name.toLowerCase() === wanted) ||
                list.find((p) => p.name.toLowerCase().includes(wanted) || wanted.includes(p.name.toLowerCase())) ||
                list[0] ||
                null;
            }

            if (!found) {
              unmatched.push({ name: poProduct.name || "Unknown", quantity: poQty, price: poProduct.price || 0 });
              continue;
            }

            // A child ordered as singles is received into its pack, converted. It used
            // to be carried over unconverted: 12 singles became 12 cartons.
            const target = await resolveStockTarget(found, poQty);
            const existing = matched.find((line) => line._id === target.product._id && !line.expiryDate);
            if (existing) {
              existing.quantity += target.quantity;
            } else {
              matched.push(
                makeLine(target.product, target.quantity, "", {
                  receivedAs: target.from ? `${poQty} × ${target.from.name}` : "",
                })
              );
            }
          } catch {
            unmatched.push({ name: poProduct.name || "Unknown", quantity: poQty, price: poProduct.price || 0 });
          }
        }
        if (matched.length > 0) setLines(matched);
        if (unmatched.length > 0) setUnmatchedProducts(unmatched);
      } catch (err) {
        console.error("Error loading PO:", err);
      } finally {
        setPoLoading(false);
      }
    })();
  }, [router.isReady]);

  /* ─── Arriving from the expiration report ─────────────────────── */

  useEffect(() => {
    if (!router.isReady || !router.query.adjustProductId || router.query.poId) return;
    const { adjustProductId, adjustQty, reason: qReason } = router.query;

    (async () => {
      try {
        const res = await apiClient.get(`/api/products?id=${adjustProductId}`);
        const product = res.data?.data || res.data;
        if (!product?._id) return;

        // The report hands over what is left of the batch, in packs, and that is often
        // a fraction: 7 cans of a 24-carton is 0.29. parseInt() used to read that as 0
        // and fall back to 1, writing off a whole carton for seven cans.
        const qty = Number(adjustQty);
        const target = await resolveStockTarget(product, Number.isFinite(qty) && qty > 0 ? qty : 1);
        setLines([makeLine(target.product, target.quantity, toDateInput(router.query.expiryDate))]);
        if (qReason) setReason(String(qReason));
      } catch (err) {
        console.error("Error loading adjustment product:", err);
      }
    })();
  }, [router.isReady]);

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.reason) setReason(String(router.query.reason));
    if (router.query.lossNote) setMovementNotes(String(router.query.lossNote));
  }, [router.isReady, router.query.reason, router.query.lossNote]);

  useEffect(() => {
    if (isOperationalLoss) setToLocation("");
  }, [isOperationalLoss]);

  /* ─── Product search ──────────────────────────────────────────── */

  const runSearch = useCallback(async (term) => {
    const seq = (searchSeq.current += 1);
    setLoadingSearch(true);
    try {
      const res = await fetch(
        `/api/products?search=${encodeURIComponent(term)}&stockManaged=true&excludeChild=true`
      );
      const data = await res.json();
      const list = data.data || (Array.isArray(data) ? data : []);
      // A slower, older search must not overwrite a newer one's results.
      if (seq === searchSeq.current) setProducts(Array.isArray(list) ? list : []);
      return Array.isArray(list) ? list : [];
    } catch (err) {
      console.error("Error searching products:", err);
      if (seq === searchSeq.current) setProducts([]);
      return [];
    } finally {
      if (seq === searchSeq.current) setLoadingSearch(false);
    }
  }, []);

  useEffect(() => {
    const trimmed = searchTerm.trim();
    if (trimmed.length < 2) {
      searchSeq.current += 1;
      setProducts([]);
      setLoadingSearch(false);
      return undefined;
    }
    const timer = setTimeout(() => runSearch(trimmed), 400);
    return () => clearTimeout(timer);
  }, [searchTerm, runSearch]);

  const handleProductSelect = (product) => {
    setSelectedProduct(product);
    setQuantityInput(1);
    setSearchTerm("");
    setProducts([]);
  };

  /**
   * Enter picks the product straight away when the term is a barcode or leaves a
   * single match — which is how a handheld scanner "types": the code, then Enter.
   */
  const handleSearchKeyDown = async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const term = searchTerm.trim();
    if (term.length < 2) return;

    // Always search afresh: a scanner types faster than the debounce, so the list on
    // screen may still be the previous term's results.
    const list = await runSearch(term);
    const byCode = list.find((p) => hasBarcode(p, term));
    const pick = byCode || (list.length === 1 ? list[0] : null);
    if (pick) handleProductSelect(pick);
  };

  /* ─── Lines ───────────────────────────────────────────────────── */

  const addProduct = () => {
    if (!selectedProduct || !(Number(quantityInput) > 0)) return;
    const quantity = Number(quantityInput);
    const expiryDate = expiryDateInput || "";

    setLines((prev) => {
      // Same product, same expiry: add to that line. A different expiry is a separate
      // batch and gets its own line. This used to overwrite the first line's date,
      // losing a batch from the expiry report.
      const existing = prev.find((line) => line._id === selectedProduct._id && line.expiryDate === expiryDate);
      if (existing) {
        return prev.map((line) =>
          line.lineId === existing.lineId ? { ...line, quantity: line.quantity + quantity } : line
        );
      }
      return [...prev, makeLine(selectedProduct, quantity, expiryDate)];
    });

    setSearchTerm("");
    setQuantityInput(1);
    setExpiryDateInput("");
    setSelectedProduct(null);
    searchInputRef.current?.focus();
  };

  const updateLine = (lineId, patch) => {
    setLines((prev) => prev.map((line) => (line.lineId === lineId ? { ...line, ...patch } : line)));
  };

  const removeLine = (lineId) => {
    setLines((prev) => prev.filter((line) => line.lineId !== lineId));
  };

  /** Admin price edits. Margin and sale price stay in step whichever one is typed. */
  const updatePrice = (line, field, raw) => {
    const value = raw === "" ? "" : Number(raw);
    const patch = { priceDirty: true };

    if (field === "margin") {
      patch.marginDraft = raw;
      if (raw !== "" && Number.isFinite(value)) {
        patch.salePriceIncTax = roundMoney(calculateSalePriceIncTax(line.costPrice, value));
      }
    } else {
      patch[field] = raw === "" ? 0 : value;
      patch.marginDraft = undefined;
    }
    updateLine(line.lineId, patch);
  };

  const saveLinePrice = async (line) => {
    setSavingPrices((prev) => ({ ...prev, [line.lineId]: true }));
    try {
      await apiClient.put("/api/products", {
        _id: line._id,
        costPrice: Number(line.costPrice) || 0,
        salePriceIncTax: Number(line.salePriceIncTax) || 0,
      });
      // Every line of this product now reflects the saved price.
      setLines((prev) =>
        prev.map((l) => (l._id === line._id ? { ...l, costPrice: line.costPrice, salePriceIncTax: line.salePriceIncTax, priceDirty: false, marginDraft: undefined } : l))
      );
      return true;
    } catch (err) {
      await showAlertDialog({
        title: "Price save failed",
        message: `Failed to save the price of ${line.name}: ${err.response?.data?.message || err.message}`,
        tone: "danger",
      });
      return false;
    } finally {
      setSavingPrices((prev) => ({ ...prev, [line.lineId]: false }));
    }
  };

  /* ─── Checks ──────────────────────────────────────────────────── */

  const lineIssues = useMemo(() => {
    const issues = {};
    for (const line of lines) {
      const list = [];
      if (!(Number(line.quantity) > 0)) list.push({ tone: "error", text: "Quantity must be more than zero." });

      // Only the product-wide figure is on hand here, not the source location's own
      // count, so this warns rather than blocks.
      if (isOutbound && Number.isFinite(Number(line.stockOnHand)) && Number(line.quantity) > Number(line.stockOnHand) + 1e-9) {
        list.push({
          tone: "warning",
          text: `More than the ${formatPackQuantity(line.stockOnHand, getPackSize(line))} in stock across all locations.`,
        });
      }

      if (line.expiryDate && isPastDate(line.expiryDate) && !isOutbound) {
        list.push({ tone: "warning", text: "This expiry date has already passed." });
      }
      if (line.priceDirty) {
        list.push({ tone: "info", text: "Price changed but not saved. It is saved before the movement is created." });
      }
      if (list.length) issues[line.lineId] = list;
    }
    return issues;
  }, [lines, isOutbound]);

  const sameLocation = Boolean(
    reason === "Transfer" && fromLocation && toLocation && fromLocation === toLocation
  );

  const missing = [
    !fromLocation && "From location",
    requiresDestination && !toLocation && "To location",
    !staff && "Responsible staff",
    !reason && "Reason",
    lines.length === 0 && "At least one product",
  ].filter(Boolean);

  const hasBlockingLine = Object.values(lineIssues).some((list) => list.some((issue) => issue.tone === "error"));
  const canSubmit = missing.length === 0 && !sameLocation && !hasBlockingLine && !isSubmitting;

  /* ─── Submit ──────────────────────────────────────────────────── */

  const handleAddToStock = async () => {
    if (!canSubmit) {
      await showAlertDialog({
        title: "Not ready yet",
        message: sameLocation
          ? "A transfer needs two different locations."
          : hasBlockingLine
            ? "One or more products has a quantity of zero."
            : `Still needed: ${missing.join(", ")}.`,
        tone: "warning",
      });
      return;
    }

    // The movement is valued at the saved product price, so an unsaved edit on a line
    // would be silently ignored. Save them first, with the operator's say-so.
    const dirty = lines.filter((line) => line.priceDirty);
    if (dirty.length > 0) {
      const proceed = await showConfirmDialog({
        title: "Save price changes?",
        message: `${dirty.length} product(s) have price changes that are not saved yet. They will be saved now, and the movement will use them.`,
        confirmLabel: "Save and continue",
      });
      if (!proceed) return;
      const seen = new Set();
      for (const line of dirty) {
        if (seen.has(line._id)) continue;
        seen.add(line._id);
        if (!(await saveLinePrice(line))) return;
      }
    }

    try {
      setIsSubmitting(true);
      const totalCostPrice = lines.reduce((sum, line) => sum + (Number(line.costPrice) || 0) * line.quantity, 0);
      const movementLines = lines.map((line) => ({
        id: line._id,
        quantity: line.quantity,
        expiryDate: line.expiryDate || null,
        costPrice: Number(line.costPrice) || 0,
      }));

      if (isPurchaseOrderReceipt) {
        await apiClient.put(`/api/purchase-orders/${poRef.id}`, {
          action: "confirm-received",
          toLocationId: toLocation,
          staffId: staff || null,
          notes: movementNotes,
          products: movementLines,
        });

        await showAlertDialog({
          title: "Purchase order received",
          message: "Purchase order received and stock updated successfully.",
          tone: "success",
        });
      } else {
        const transRef = Date.now().toString();
        const res = await fetch("/api/stock-movement/stock-movement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transRef,
            fromLocationId: fromLocation,
            toLocationId: requiresDestination ? toLocation : null,
            staffId: staff || null,
            vendorName: fromLocation === "vendor" ? poRef?.vendorName || "" : "",
            reason,
            notes: movementNotes,
            status: "Received",
            totalCostPrice,
            barcode: transRef,
            dateSent: new Date().toISOString(),
            dateReceived: new Date().toISOString(),
            products: movementLines,
          }),
        });

        const result = await res.json();
        if (!res.ok) throw new Error(result?.message || result?.error || `Server error: ${res.status}`);

        await showAlertDialog({
          title: isOperationalLoss ? "Loss recorded" : "Stock movement saved",
          message: isOperationalLoss ? "Operational loss recorded." : "Stock movement added successfully.",
          tone: "success",
        });
      }

      setFromLocation("");
      setToLocation("");
      setStaff("");
      setReason("");
      setMovementNotes("");
      setLines([]);
      setSearchTerm("");
      setQuantityInput(1);
      setExpiryDateInput("");
      setSelectedProduct(null);
      router.push("/stock/movement");
    } catch (err) {
      await showAlertDialog({
        title: "Save failed",
        message: `Error saving stock movement: ${err.response?.data?.error || err.message}`,
        tone: "danger",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ─── Totals ──────────────────────────────────────────────────── */

  const totals = useMemo(() => {
    let cost = 0;
    let packLines = 0;
    let wholePacks = 0;
    let looseUnits = 0;
    let singles = 0;
    for (const line of lines) {
      cost += (Number(line.costPrice) || 0) * (Number(line.quantity) || 0);
      if (isPackProduct(line)) {
        packLines += 1;
        const split = splitPackQuantity(line.quantity, getPackSize(line));
        wholePacks += split.packs;
        looseUnits += split.units;
      } else {
        singles += Number(line.quantity) || 0;
      }
    }
    return { cost, packLines, wholePacks, looseUnits, singles };
  }, [lines]);

  const selectedIsPack = isPackProduct(selectedProduct);
  const selectedPackSize = getPackSize(selectedProduct);

  /* ─── Render ──────────────────────────────────────────────────── */

  return (
    <Layout>
      {isSubmitting && (
        <Loader
          fullScreen
          text={isPurchaseOrderReceipt ? "Receiving purchase order and updating stock..." : "Creating stock movement..."}
        />
      )}
      <div className="page-container">
        <div className="page-content">
          <div className="page-header">
            <div>
              <h1 className="page-title">{isOperationalLoss ? "Record Operational Loss" : "Create Stock Movement"}</h1>
              <p className="page-subtitle">
                {isOperationalLoss
                  ? "Log damaged, wasted, expired, or missing stock with a traceable write-off."
                  : "Receive, transfer or adjust stock, with full tracking of every product and batch."}
              </p>
            </div>
          </div>

          {/* PO reference */}
          {poLoading && (
            <div className="theme-note-primary border rounded-lg p-4 mb-4">
              <Loader size="sm" text="Loading purchase order details..." />
            </div>
          )}
          {poRef && !poLoading && (
            <div className="theme-note-primary border rounded-lg p-4 mb-4">
              <p className="text-sm font-semibold">
                Receiving Purchase Order: {poRef.orderRef} from {poRef.vendorName}
              </p>
              <p className="text-xs mt-1 opacity-80">
                Products have been pre-populated. Review quantities and expiry dates before submitting.
              </p>
              {unmatchedProducts.length > 0 && (
                <div className="mt-3 pt-3 border-t theme-border-soft">
                  <p className="text-xs font-semibold text-amber-700 mb-1">Unmatched PO items (add manually):</p>
                  {unmatchedProducts.map((p, i) => (
                    <p key={i} className="text-xs text-amber-700">
                      • {p.name} — Quantity: {p.quantity}, Price: {formatCurrency(p.price)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="content-card !p-0 overflow-hidden">
            {/* ── Movement details ── */}
            <div className="p-4 md:p-6 border-b theme-border-soft">
              <SectionTitle>Movement Details</SectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Dropdown
                  label="From Location"
                  value={fromLocation}
                  onChange={setFromLocation}
                  options={
                    isOperationalLoss
                      ? locations
                      : [{ _id: "vendor", name: formatVendorMovementLabel(poRef?.vendorName) }, ...locations]
                  }
                  required
                />

                {requiresDestination ? (
                  <div>
                    <Dropdown label="To Location" value={toLocation} onChange={setToLocation} options={locations} required />
                    {sameLocation && (
                      <p className="text-xs text-red-600 mt-1">A transfer needs two different locations.</p>
                    )}
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">Loss Destination</label>
                    <div className="form-input bg-red-50 border-red-200 text-red-700">
                      Recorded against the operational loss register
                    </div>
                  </div>
                )}

                <Dropdown label="Responsible Staff" value={staff} onChange={setStaff} options={staffList} required />

                <Dropdown
                  label="Movement Reason"
                  value={reason}
                  onChange={setReason}
                  options={reasons.map((r) => ({ name: r, _id: r }))}
                  required
                />

                <div className="md:col-span-2">
                  <label className="form-label">Notes</label>
                  <textarea
                    className="form-input min-h-24"
                    value={movementNotes}
                    onChange={(e) => setMovementNotes(e.target.value)}
                    placeholder={
                      isOperationalLoss
                        ? "Describe the loss, for example: damaged during handling, expired on shelf, broken pack, missing after recount."
                        : "Optional notes for this movement."
                    }
                  />
                </div>
              </div>
            </div>

            {/* ── Add products ── */}
            <div className="p-4 md:p-6 border-b theme-border-soft">
              <SectionTitle>Add Products</SectionTitle>

              <div className="space-y-4">
                <div className="relative">
                  <label className="form-label">Search by product name or barcode</label>
                  <input
                    ref={searchInputRef}
                    className="form-input"
                    placeholder="Type or scan, then press Enter…"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setSelectedProduct(null);
                    }}
                    onKeyDown={handleSearchKeyDown}
                  />
                  {loadingSearch && (
                    <div className="absolute top-full mt-1 left-0 w-full bg-white border rounded-lg p-4 shadow-lg z-20">
                      <Loader size="sm" text="Searching..." />
                    </div>
                  )}
                  {!loadingSearch && products.length > 0 && (
                    <ul className="absolute top-full mt-1 left-0 z-20 bg-white border w-full max-h-72 overflow-y-auto rounded-lg shadow-lg">
                      {products.map((product) => (
                        <li
                          key={product._id}
                          className="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition"
                          onClick={() => handleProductSelect(product)}
                        >
                          <div className="flex justify-between items-center gap-3">
                            <span className="font-medium text-gray-900">{product.name}</span>
                            <span className="text-sm text-gray-600 whitespace-nowrap">
                              {formatCurrency(product.salePriceIncTax || 0)}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Stock: {formatPackQuantity(product.quantity, getPackSize(product))}
                            {isPackProduct(product) && <span> · pack of {getPackSize(product)}</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {selectedProduct && (
                  <div className="theme-panel-soft rounded-lg p-4">
                    <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Selected product</p>
                        <p className="text-lg font-bold text-gray-900">{selectedProduct.name}</p>
                        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
                          <span>
                            Available stock:{" "}
                            <StockBreakdown quantity={selectedProduct.quantity} product={selectedProduct} />
                          </span>
                          <span>
                            Cost: <strong className="text-gray-900">{formatCurrency(selectedProduct.costPrice || 0)}</strong>
                            {selectedIsPack && <span className="text-gray-500"> / pack</span>}
                          </span>
                          <span>
                            Margin: <MarginBadge value={marginOf(selectedProduct)} />
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => setSelectedProduct(null)}
                        className="text-red-600 hover:text-red-700 font-semibold text-sm whitespace-nowrap"
                      >
                        Clear selection
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] gap-3 items-end">
                  <div>
                    <label className="form-label">
                      Quantity
                      {selectedIsPack && (
                        <span className="font-normal text-gray-500"> — pack of {selectedPackSize}</span>
                      )}
                    </label>
                    <PackQuantityInput
                      value={quantityInput}
                      packSize={selectedIsPack ? selectedPackSize : 1}
                      onChange={setQuantityInput}
                      disabled={!selectedProduct}
                    />
                  </div>

                  <div>
                    <label className="form-label">Expiry date (optional)</label>
                    <input
                      type="date"
                      className="form-input"
                      value={expiryDateInput}
                      onChange={(e) => setExpiryDateInput(e.target.value)}
                    />
                  </div>

                  <button
                    onClick={addProduct}
                    disabled={!selectedProduct || !(Number(quantityInput) > 0)}
                    className="btn-action btn-action-primary disabled:opacity-50 h-[42px] whitespace-nowrap"
                  >
                    Add Product
                  </button>
                </div>
              </div>
            </div>

            {/* ── Lines ── */}
            <div className="p-4 md:p-6">
              <SectionTitle>
                {isOperationalLoss ? "Products written off" : "Products in this movement"} ({lines.length})
              </SectionTitle>

              {lines.length > 0 ? (
                <div className="space-y-3 mb-6">
                  {lines.map((line) => (
                    <MovementLine
                      key={line.lineId}
                      line={line}
                      isAdmin={isAdmin}
                      issues={lineIssues[line.lineId] || []}
                      saving={Boolean(savingPrices[line.lineId])}
                      onQuantity={(quantity) => updateLine(line.lineId, { quantity })}
                      onExpiry={(expiryDate) => updateLine(line.lineId, { expiryDate })}
                      onPrice={(field, raw) => updatePrice(line, field, raw)}
                      onSavePrice={() => saveLinePrice(line)}
                      onRemove={() => removeLine(line.lineId)}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 rounded-lg border-2 border-dashed theme-border-soft theme-surface-soft">
                  <p className="text-gray-600">No products added yet. Search and add products above.</p>
                </div>
              )}

              {lines.length > 0 && (
                <div className="theme-panel-soft rounded-lg p-4 md:p-5 mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Stat label="Total cost" value={formatCurrency(totals.cost)} strong />
                  <Stat label="Products" value={String(lines.length)} />
                  <Stat
                    label="Packs"
                    value={
                      totals.packLines === 0
                        ? "—"
                        : `${totals.wholePacks}${totals.looseUnits ? ` · ${totals.looseUnits} loose unit${totals.looseUnits === 1 ? "" : "s"}` : ""}`
                    }
                  />
                  <Stat label="Single items" value={totals.singles ? String(totals.singles) : "—"} />
                </div>
              )}

              {missing.length > 0 && lines.length > 0 && (
                <p className="text-xs text-gray-500 text-right mb-2">Still needed: {missing.join(", ")}</p>
              )}

              <div className="flex flex-col sm:flex-row gap-3 justify-end">
                <button onClick={() => router.push("/stock/movement")} className="btn-action btn-action-secondary w-full sm:w-auto">
                  Cancel
                </button>
                <button
                  onClick={handleAddToStock}
                  disabled={!canSubmit}
                  className="btn-action btn-action-success w-full sm:w-auto disabled:opacity-50"
                >
                  {isSubmitting ? "Saving..." : isOperationalLoss ? "Record Operational Loss" : "Create Stock Movement"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────── */

function SectionTitle({ children }) {
  return (
    <h2 className="text-lg md:text-xl font-bold text-gray-900 mb-5 flex items-center gap-2">
      <span className="w-1.5 h-6 rounded-full theme-accent-bg" />
      {children}
    </h2>
  );
}

function Stat({ label, value, strong = false }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`${strong ? "text-2xl" : "text-lg"} font-bold text-gray-900`}>{value}</p>
    </div>
  );
}

/** Stock the way a person counts it: "1 pack · 7 units (31 units)". */
function StockBreakdown({ quantity, product }) {
  const packSize = getPackSize(product);
  if (!isPackProduct(product)) {
    return <strong className="text-gray-900">{formatPackQuantity(quantity, 1)}</strong>;
  }
  const { totalUnits } = splitPackQuantity(quantity, packSize);
  return (
    <>
      <strong className="text-gray-900">{formatPackQuantity(quantity, packSize)}</strong>
      <span className="text-gray-500"> ({totalUnits} units)</span>
    </>
  );
}

function MarginBadge({ value }) {
  const n = Number(value) || 0;
  const tone = n < 0 ? "bg-red-100 text-red-700" : n < 10 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${tone}`}>{n.toFixed(1)}%</span>;
}

/**
 * Quantity entry. A pack product takes packs and loose units separately; anything
 * else takes a single count. The value is always the product's stored stock unit —
 * packs for a pack, so 1 pack and 7 units of a 24-carton is 1.2917.
 *
 * While a field is being typed in it shows exactly what was typed, so entering "30"
 * units does not jump to "1 pack 6" after the "3". It tidies up when you leave the field.
 */
function PackQuantityInput({ value, packSize, onChange, disabled = false, compact = false, invalid = false }) {
  const size = Number(packSize) > 1 ? Number(packSize) : 1;
  const isPack = size > 1;
  const { packs, units, totalUnits } = splitPackQuantity(value, size);
  const [draft, setDraft] = useState(null); // { field, text, packs, units } while typing

  const setTotalUnits = (next) => onChange(Math.max(0, next) / size);

  const step = (deltaUnits) => {
    setDraft(null);
    setTotalUnits(totalUnits + deltaUnits);
  };

  const onType = (field) => (e) => {
    const text = e.target.value.replace(/[^\d]/g, "");
    const base = draft || { packs, units };
    setDraft({ field, text, packs: base.packs, units: base.units });
    const n = text === "" ? 0 : parseInt(text, 10);
    if (!isPack) return onChange(n);
    const nextPacks = field === "packs" ? n : base.packs;
    const nextUnits = field === "units" ? n : base.units;
    setTotalUnits(nextPacks * size + nextUnits);
  };

  const shown = (field) => {
    if (draft?.field === field) return draft.text;
    if (draft) return String(draft[field]);
    return String(field === "packs" ? packs : units);
  };

  const h = compact ? "h-8" : "h-[42px]";
  const box = `flex items-center border rounded-lg overflow-hidden bg-white ${invalid ? "border-red-400" : "theme-border-soft"} ${disabled ? "opacity-50" : ""}`;
  const btn = `${compact ? "w-8" : "w-10"} ${h} flex items-center justify-center bg-gray-50 hover:bg-gray-100 text-gray-700 font-semibold transition disabled:cursor-not-allowed`;
  const input = `${compact ? "w-12 text-sm" : "w-16 text-base"} ${h} text-center font-semibold border-0 focus:outline-none bg-transparent`;

  const renderField = ({ field, label, deltaUnits }) => (
    <div className="flex flex-col gap-1">
      {!compact && <span className="text-[11px] font-medium text-gray-500">{label}</span>}
      <div className={box}>
        <button type="button" className={btn} disabled={disabled} onClick={() => step(-deltaUnits)} aria-label={`Fewer ${label}`}>
          −
        </button>
        <input
          type="text"
          inputMode="numeric"
          className={input}
          value={shown(field)}
          disabled={disabled}
          onChange={onType(field)}
          onBlur={() => setDraft(null)}
          onFocus={(e) => e.target.select()}
          aria-label={label}
        />
        <button type="button" className={btn} disabled={disabled} onClick={() => step(deltaUnits)} aria-label={`More ${label}`}>
          +
        </button>
      </div>
      {compact && <span className="text-[10px] text-gray-500 text-center">{label}</span>}
    </div>
  );

  if (!isPack) {
    return <div className="flex">{renderField({ field: "packs", label: "Qty", deltaUnits: 1 })}</div>;
  }

  return (
    <div className="flex items-end gap-2 flex-wrap">
      {renderField({ field: "packs", label: "Packs", deltaUnits: size })}
      {renderField({ field: "units", label: "Units", deltaUnits: 1 })}
      {!compact && (
        <span className="text-xs text-gray-500 pb-3 whitespace-nowrap">= {totalUnits} units</span>
      )}
    </div>
  );
}

function MovementLine({ line, isAdmin, issues, saving, onQuantity, onExpiry, onPrice, onSavePrice, onRemove }) {
  const pack = isPackProduct(line);
  const packSize = getPackSize(line);
  const cost = Number(line.costPrice) || 0;
  const margin = marginOf(line);
  const lineTotal = cost * (Number(line.quantity) || 0);
  const invalidQty = !(Number(line.quantity) > 0);

  const toneClass = {
    error: "text-red-600",
    warning: "text-amber-700",
    info: "text-gray-500",
  };

  return (
    <div className="rounded-lg border theme-border-soft bg-white p-3 md:p-4 space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
        {/* Identity and prices */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm md:text-base">{line.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs md:text-sm text-gray-600">
            <span>
              Cost {formatCurrency(cost)}
              {pack && <span className="text-gray-400"> / pack · {formatCurrency(cost / packSize)} / unit</span>}
            </span>
            <span>Sell {formatCurrency(line.salePriceIncTax || 0)}</span>
            <span className="inline-flex items-center gap-1">
              Margin <MarginBadge value={margin} />
            </span>
            {pack && <span className="text-gray-500">Pack of {packSize}</span>}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            In stock (all locations): <StockBreakdown quantity={line.stockOnHand} product={line} />
            {line.receivedAs && <span> · received as {line.receivedAs}</span>}
          </p>
        </div>

        {/* Quantity, total, remove */}
        <div className="flex items-center gap-3 flex-wrap">
          <PackQuantityInput value={line.quantity} packSize={pack ? packSize : 1} onChange={onQuantity} compact invalid={invalidQty} />
          <div className="text-right min-w-[92px]">
            <p className="text-[10px] uppercase tracking-wide text-gray-400">Line total</p>
            <p className="font-semibold text-gray-900">{formatCurrency(lineTotal)}</p>
          </div>
          <button onClick={onRemove} className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-2 rounded-lg transition font-medium text-sm">
            Remove
          </button>
        </div>
      </div>

      {/* Expiry, editable on the line */}
      <div className="flex flex-wrap items-center gap-3 pt-3 border-t theme-border-soft">
        <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
          Expiry date
          <input
            type="date"
            value={toDateInput(line.expiryDate)}
            onChange={(e) => onExpiry(e.target.value)}
            className="form-input !w-auto !py-1 text-xs"
          />
        </label>
        {line.expiryDate && (
          <button type="button" onClick={() => onExpiry("")} className="text-xs text-gray-500 hover:text-gray-700 underline">
            Clear
          </button>
        )}
        {pack && (
          <span className="text-xs text-gray-500">
            Moving: <strong className="text-gray-800">{formatPackQuantity(line.quantity, packSize)}</strong>
          </span>
        )}
      </div>

      {/* Admin price editor */}
      {isAdmin && (
        <div className="flex flex-wrap items-end gap-3 pt-3 border-t theme-border-soft">
          <PriceField label={pack ? "Cost / pack" : "Cost"} value={line.costPrice} onChange={(v) => onPrice("costPrice", v)} />
          <PriceField label={pack ? "Sell / pack" : "Sell"} value={line.salePriceIncTax} onChange={(v) => onPrice("salePriceIncTax", v)} />
          <PriceField
            label="Margin %"
            value={line.marginDraft !== undefined ? line.marginDraft : roundMoney(margin)}
            onChange={(v) => onPrice("margin", v)}
            step="0.1"
          />
          <button
            onClick={onSavePrice}
            disabled={saving || !line.priceDirty}
            className="btn-action btn-action-primary btn-sm disabled:opacity-50"
          >
            {saving ? "Saving..." : line.priceDirty ? "Save Price" : "Saved"}
          </button>
        </div>
      )}

      {issues.length > 0 && (
        <ul className="space-y-0.5">
          {issues.map((issue, i) => (
            <li key={i} className={`text-xs ${toneClass[issue.tone] || "text-gray-600"}`}>
              {issue.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PriceField({ label, value, onChange, step = "0.01" }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-gray-500">{label}</span>
      <input
        type="number"
        value={value === "" || value === undefined || value === null ? "" : value}
        onChange={(e) => onChange(e.target.value)}
        onWheel={(e) => e.currentTarget.blur()}
        className="form-input !w-28 !py-1.5 text-sm"
        step={step}
        min="0"
      />
    </label>
  );
}

function Dropdown({ label, value, onChange, options, required = false }) {
  return (
    <div className="form-group">
      <label className="form-label">
        {label} {required && <span className="text-red-600">*</span>}
      </label>
      <select className="form-select" value={value} onChange={(e) => onChange(e.target.value)} required={required}>
        <option value="">Select {label.toLowerCase()}...</option>
        {options.map((opt) => (
          <option key={opt._id} value={opt._id}>
            {opt.name}
          </option>
        ))}
      </select>
    </div>
  );
}
