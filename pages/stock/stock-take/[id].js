// pages/stock/stock-take/[id].js
"use client";
import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/router";
import Layout from "@/components/Layout";
import { Loader } from "@/components/ui";
import useProgress from "@/lib/useProgress";
import { formatCurrency } from "@/lib/format";
import { showConfirmDialog } from "@/lib/dialogs";
import { showToastMessage } from "@/lib/toast-state";
import { useAuth } from "@/lib/useAuth";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faPlay,
  faCheck,
  faThumbsUp,
  faSyncAlt,
  faTimes,
  faSearch,
  faDownload,
  faSave,
  faExclamationTriangle,
  faCheckCircle,
  faBalanceScale,
  faPlus,
  faPrint,
  faClipboardList,
} from "@fortawesome/free-solid-svg-icons";

const STATUS_COLORS = {
  draft: "bg-gray-100 text-gray-700",
  "in-progress": "bg-blue-100 text-blue-700",
  completed: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-700",
};

const EMPTY_LIST_FILTERS = {
  vendorId: "",
  categoryId: "",
  shelfLine: "",
};

const VIEW_MODES = {
  COUNT: "count",
  REVIEW: "review",
};

const REASON_OPTIONS = [
  "Stock Take",
  "Damaged",
  "Expired",
  "Transfer",
  "Supplier Shortage",
  "Theft",
  "Counting Error",
  "Other",
];

function getStockTakeGroupKey(item) {
  return String(item?.productId || item?._id || "");
}

function groupStockTakeItems(items = []) {
  const groupMap = new Map();

  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = getStockTakeGroupKey(item);
    if (!key) return;

    const existing = groupMap.get(key) || {
      key,
      productName: item.productName || "Unknown product",
      barcode: item.barcode || "",
      items: [],
      standard: null,
      loose: null,
    };

    existing.items.push(item);
    if (item.countType === "loose-units") {
      existing.loose = item;
    } else {
      existing.standard = item;
      existing.productName = item.productName || existing.productName;
      existing.barcode = item.barcode || existing.barcode;
    }

    groupMap.set(key, existing);
  });

  return Array.from(groupMap.values()).map((group) => ({
    ...group,
    primary: group.standard || group.loose || group.items[0],
    variance: group.items.reduce((sum, item) => (
      item.countedQty !== null && item.countedQty !== undefined ? sum + Number(item.variance || 0) : sum
    ), 0),
    varianceValue: group.items.reduce((sum, item) => (
      item.countedQty !== null && item.countedQty !== undefined ? sum + Number(item.varianceValue || 0) : sum
    ), 0),
    isCounted: group.items.every((item) => item.countedQty !== null && item.countedQty !== undefined),
    isPartiallyCounted: group.items.some((item) => item.countedQty !== null && item.countedQty !== undefined),
    hasVariance: group.items.some((item) => item.countedQty !== null && item.countedQty !== undefined && Number(item.variance || 0) !== 0),
  }));
}

function formatStockTakeQuantity(value) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return "0";
  return String(parseFloat(numberValue.toFixed(2)));
}

export default function StockTakeDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const { isAdmin } = useAuth();

  const [stockTake, setStockTake] = useState(null);
  const [builderOptions, setBuilderOptions] = useState({ vendors: [], categories: [], shelfLines: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterItemStatus, setFilterItemStatus] = useState("all");
  const [filterVariance, setFilterVariance] = useState("all");
  const [message, setMessage] = useState({ type: "", text: "" });
  const [pendingChanges, setPendingChanges] = useState({});
  const [showCreateListModal, setShowCreateListModal] = useState(false);
  const [listFilters, setListFilters] = useState(EMPTY_LIST_FILTERS);
  const [productSearchTerm, setProductSearchTerm] = useState("");
  const [productSearchResults, setProductSearchResults] = useState([]);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [viewMode, setViewMode] = useState(VIEW_MODES.COUNT);
  const [bulkReason, setBulkReason] = useState(REASON_OPTIONS[0]);
  const countInputRefs = useRef({});

  const isEditable = Boolean(stockTake && ["draft", "in-progress"].includes(stockTake.status));
  const hasItems = Boolean(stockTake?.items?.length);

  const fetchStockTake = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      start();
      onFetch();
      const res = await fetch(`/api/stock-take/${id}`);
      const data = await res.json();
      onProcess();

      if (data.success) {
        setStockTake(data.stockTake);
        setBuilderOptions(data.builderOptions || { vendors: [], categories: [], shelfLines: [] });
      } else {
        setMessage({ type: "error", text: data.message || "Failed to load stock take" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to load stock take" });
    } finally {
      complete();
      setLoading(false);
    }
  }, [id, start, onFetch, onProcess, complete]);

  useEffect(() => {
    fetchStockTake();
  }, [fetchStockTake]);

  useEffect(() => {
    if (!message.text) return;
    showToastMessage({
      title: "Stock take",
      text: message.text,
      fallbackTone: message.type === "error" ? "danger" : "success",
    });
    setMessage({ type: "", text: "" });
  }, [message]);

  useEffect(() => {
    const query = productSearchTerm.trim();
    if (!isEditable || query.length < 2) {
      setProductSearchResults([]);
      setSearchingProducts(false);
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setSearchingProducts(true);
        const params = new URLSearchParams({
          search: query,
          names: "true",
          stockManaged: "true",
          excludeChild: "true",
        });
        const res = await fetch(`/api/products?${params.toString()}`, { signal: controller.signal });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || "Failed to search products");
        }

        const existingProductIds = new Set((stockTake?.items || []).map((item) => String(item.productId)));
        const results = (Array.isArray(data.data) ? data.data : [])
          .filter((product) => !existingProductIds.has(String(product._id)))
          .slice(0, 8);
        setProductSearchResults(results);
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("Product search failed:", err);
          setProductSearchResults([]);
        }
      } finally {
        setSearchingProducts(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [productSearchTerm, isEditable, stockTake?.items]);

  useEffect(() => {
    if (!stockTake) return;

    if (!isEditable) {
      setViewMode(VIEW_MODES.REVIEW);
      return;
    }

    if (!hasItems) {
      setViewMode(VIEW_MODES.COUNT);
    }
  }, [stockTake, isEditable, hasItems]);

  const getEffectiveItem = useCallback((item) => {
    const pending = pendingChanges[item._id] || {};
    const countedQty = Object.prototype.hasOwnProperty.call(pending, "countedQty")
      ? pending.countedQty
      : item.countedQty;
    const reason = Object.prototype.hasOwnProperty.call(pending, "reason")
      ? pending.reason
      : (item.reason || "");
    const variance = countedQty !== null && countedQty !== undefined
      ? Number(countedQty) - Number(item.systemQty || 0)
      : null;

    return {
      ...item,
      countedQty,
      reason,
      variance,
      varianceValue: variance !== null ? variance * Number(item.costPrice || 0) : null,
      derivedStatus: countedQty !== null && countedQty !== undefined ? "counted" : "pending",
    };
  }, [pendingChanges]);

  const filteredItems = useMemo(() => {
    if (!stockTake?.items) return [];

    return stockTake.items.filter((item) => {
      const effectiveItem = getEffectiveItem(item);

      if (filterItemStatus !== "all" && effectiveItem.derivedStatus !== filterItemStatus) return false;
      if (filterVariance === "positive" && !(effectiveItem.countedQty !== null && effectiveItem.variance > 0)) return false;
      if (filterVariance === "negative" && !(effectiveItem.countedQty !== null && effectiveItem.variance < 0)) return false;
      if (filterVariance === "match" && !(effectiveItem.countedQty !== null && effectiveItem.variance === 0)) return false;
      if (filterVariance === "uncounted" && effectiveItem.countedQty !== null) return false;
      if (searchTerm) {
        const normalizedSearch = searchTerm.toLowerCase();
        return item.productName?.toLowerCase().includes(normalizedSearch) || item.barcode?.toLowerCase().includes(normalizedSearch);
      }

      return true;
    }).map((item) => getEffectiveItem(item));
  }, [stockTake, filterItemStatus, filterVariance, searchTerm, getEffectiveItem]);

  const reviewItems = useMemo(() => {
    if (!stockTake?.items) return [];
    return stockTake.items.map((item) => getEffectiveItem(item));
  }, [stockTake, getEffectiveItem]);

  const filteredItemGroups = useMemo(() => groupStockTakeItems(filteredItems), [filteredItems]);
  const reviewItemGroups = useMemo(() => groupStockTakeItems(reviewItems), [reviewItems]);

  const reviewStats = useMemo(() => {
    const total = reviewItemGroups.length;
    const discrepancies = reviewItemGroups.filter((group) => group.hasVariance).length;
    const correct = reviewItemGroups.filter((group) => group.isCounted && !group.hasVariance).length;
    const uncounted = reviewItemGroups.filter((group) => !group.isPartiallyCounted).length;

    return { total, discrepancies, correct, uncounted };
  }, [reviewItemGroups]);

  const countStats = useMemo(() => {
    const total = reviewItemGroups.length;
    const counted = reviewItemGroups.filter((group) => group.isCounted).length;
    const partial = reviewItemGroups.filter((group) => group.isPartiallyCounted && !group.isCounted).length;
    const progress = total > 0 ? Math.round((counted / total) * 100) : 0;
    const netVariance = reviewItems
      .filter((item) => item.countedQty !== null && item.countedQty !== undefined)
      .reduce((sum, item) => sum + Number(item.variance || 0), 0);

    return { total, counted, partial, progress, netVariance };
  }, [reviewItemGroups, reviewItems]);

  const showMsg = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: "", text: "" }), 4000);
  };

  const handleCountChange = (itemId, value) => {
    const numVal = value === "" ? null : Number(value);
    setPendingChanges((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {}),
        countedQty: numVal,
      },
    }));
  };

  const handleReasonChange = (itemId, value) => {
    setPendingChanges((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {}),
        reason: value,
      },
    }));
  };

  const saveChanges = async () => {
    const entries = Object.entries(pendingChanges);
    if (entries.length === 0) return;

    setSaving(true);
    try {
      const items = entries.map(([_id, data]) => ({ _id, ...data }));
      const res = await fetch(`/api/stock-take/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-counts", items }),
      });
      const data = await res.json();
      if (data.success) {
        setStockTake(data.stockTake);
        setPendingChanges({});
        showMsg("success", `${items.length} update(s) saved successfully`);
      } else {
        showMsg("error", data.message);
      }
    } catch (err) {
      showMsg("error", "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const performAction = async (action, extra = {}) => {
    setActionLoading(action);
    try {
      const res = await fetch(`/api/stock-take/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (data.success) {
        showMsg("success", data.message);
        if (data.stockTake) {
          setStockTake(data.stockTake);
        } else {
          await fetchStockTake();
        }
        return true;
      }

      showMsg("error", data.message);
    } catch (err) {
      showMsg("error", "Action failed");
    } finally {
      setActionLoading("");
    }

    return false;
  };

  const handleAddProduct = async (productId) => {
    const added = await performAction("add-items", { productIds: [productId] });
    if (!added) return;

    setProductSearchTerm("");
    setProductSearchResults([]);
  };

  const handleCreateList = async () => {
    if (hasItems) {
      const shouldReplace = await showConfirmDialog({
        title: "Replace the current list?",
        message: "Creating a new list will replace the products already on this stock take.",
        tone: "warning",
        confirmLabel: "Replace list",
        cancelLabel: "Keep current list",
      });
      if (!shouldReplace) return;
    }

    const created = await performAction("create-list", {
      vendorIds: listFilters.vendorId ? [listFilters.vendorId] : [],
      categoryIds: listFilters.categoryId ? [listFilters.categoryId] : [],
      shelfLines: listFilters.shelfLine ? [listFilters.shelfLine] : [],
    });
    if (!created) return;

    setPendingChanges({});
    setViewMode(VIEW_MODES.COUNT);
    setShowCreateListModal(false);
    setListFilters(EMPTY_LIST_FILTERS);
  };

  const handleClearList = async () => {
    const shouldClear = await showConfirmDialog({
      title: "Clear this list?",
      message: "All current stock take items and unsaved count entries will be removed.",
      tone: "danger",
      confirmLabel: "Clear list",
      cancelLabel: "Keep list",
    });
    if (!shouldClear) return;

    const cleared = await performAction("clear-list");
    if (!cleared) return;

    setPendingChanges({});
    setSearchTerm("");
    setFilterItemStatus("all");
    setFilterVariance("all");
  };

  const handleApplyReasonToAll = () => {
    const discrepancyItems = reviewItems.filter((item) => item.countedQty !== null && item.variance !== 0);

    if (discrepancyItems.length === 0) {
      showMsg("error", "There are no discrepancy items to update");
      return;
    }

    setPendingChanges((prev) => {
      const next = { ...prev };
      discrepancyItems.forEach((item) => {
        next[item._id] = {
          ...(next[item._id] || {}),
          reason: bulkReason,
        };
      });
      return next;
    });

    showMsg("success", `Reason applied to ${discrepancyItems.length} discrepancy item(s)`);
  };

  const handleZeroUncounted = async () => {
    const shouldZero = await showConfirmDialog({
      title: "Zero all uncounted items?",
      message: "Every uncounted item will be saved with an actual quantity of 0.",
      tone: "warning",
      confirmLabel: "Zero uncounted",
      cancelLabel: "Keep uncounted",
    });
    if (!shouldZero) return;

    const updated = await performAction("zero-uncounted");
    if (!updated) return;
    setPendingChanges({});
    setViewMode(VIEW_MODES.REVIEW);
  };

  const handleRemoveUncounted = async () => {
    const shouldRemove = await showConfirmDialog({
      title: "Remove all uncounted items?",
      message: "Every item without an actual count will be removed from this stock take.",
      tone: "danger",
      confirmLabel: "Remove uncounted",
      cancelLabel: "Keep items",
    });
    if (!shouldRemove) return;

    const updated = await performAction("remove-uncounted");
    if (!updated) return;
    setPendingChanges({});
  };

  const exportCSV = () => {
    if (!stockTake?.items) return;
    const header = "Product,Barcode,System Qty,Counted Qty,Variance,Variance Value,Status,Reason,Notes\n";
    const rows = stockTake.items.map((item) => [
      `"${item.productName}"`,
      item.barcode,
      item.systemQty,
      item.countedQty ?? "",
      item.variance,
      item.varianceValue?.toFixed(2),
      item.status,
      `"${item.reason || ""}"`,
      `"${item.notes || ""}"`,
    ].join(","));

    const csv = header + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `stock-take-${stockTake.reference}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader size="lg" text="Loading stock take..." progress={progress} />
        </div>
      </Layout>
    );
  }

  if (!stockTake) {
    return (
      <Layout>
        <div className="page-container">
          <div className="page-content text-center py-20">
            <p className="text-gray-500 text-lg">Stock take not found</p>
            <button onClick={() => router.push("/stock/stock-take")} className="btn-action-primary mt-4">
              Back to Stock Takes
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  const hasPending = Object.keys(pendingChanges).length > 0;
  const progressPct = countStats.progress;
  const isReviewMode = viewMode === VIEW_MODES.REVIEW;
  const canCompleteInReview = isAdmin && stockTake.status === "in-progress" && hasItems;

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
            <div>
              <button
                onClick={() => router.push("/stock/stock-take")}
                className="text-blue-600 hover:text-blue-800 text-sm mb-2 flex items-center gap-1"
              >
                <FontAwesomeIcon icon={faArrowLeft} className="w-3 h-3" /> Back to Stock Takes
              </button>
              <h1 className="page-title">{stockTake.title}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-2">
                <span className="font-mono text-sm text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                  {stockTake.reference}
                </span>
                <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[stockTake.status]}`}>
                  {stockTake.status}
                </span>
                <span className="text-sm text-gray-500">{stockTake.locationName}</span>
                <span className="text-sm text-gray-400">
                  Created {new Date(stockTake.createdAt).toLocaleDateString()} by {stockTake.createdBy}
                </span>
              </div>
              {stockTake.description && <p className="text-sm text-gray-500 mt-1">{stockTake.description}</p>}
            </div>

            <div className="flex flex-wrap gap-2">
              {isEditable && hasPending && (
                <button
                  onClick={saveChanges}
                  disabled={saving}
                  className="btn-action-success flex items-center gap-2 text-sm"
                >
                  <FontAwesomeIcon icon={faSave} className="w-3.5 h-3.5" />
                  {saving ? "Saving..." : `Save (${Object.keys(pendingChanges).length})`}
                </button>
              )}
              {isEditable && hasItems && !isReviewMode && (
                <button
                  onClick={() => {
                    setSearchTerm("");
                    setFilterItemStatus("all");
                    setFilterVariance("all");
                    setViewMode(VIEW_MODES.REVIEW);
                  }}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
                >
                  <FontAwesomeIcon icon={faCheck} className="w-3.5 h-3.5" />
                  Review Stocktake
                </button>
              )}
              {isEditable && hasItems && isReviewMode && (
                <button
                  onClick={() => setViewMode(VIEW_MODES.COUNT)}
                  className="btn-action flex items-center gap-2 text-sm"
                >
                  <FontAwesomeIcon icon={faPlay} className="w-3.5 h-3.5" />
                  Resume
                </button>
              )}
              {stockTake.status === "draft" && hasItems && !isReviewMode && (
                <button
                  onClick={() => performAction("start")}
                  disabled={!!actionLoading}
                  className="btn-action-primary flex items-center gap-2 text-sm"
                >
                  <FontAwesomeIcon icon={faPlay} className="w-3.5 h-3.5" />
                  Start Counting
                </button>
              )}
              {isAdmin && !isReviewMode && (stockTake.status === "draft" || stockTake.status === "in-progress") && (
                <button
                  onClick={async () => {
                    const shouldZero = await showConfirmDialog({
                      title: "Zero all counts?",
                      message: "This sets every item's counted quantity to 0.",
                      tone: "danger",
                      confirmLabel: "Zero all counts",
                      cancelLabel: "Keep counts",
                    });
                    if (!shouldZero) return;
                    performAction("zero-all");
                  }}
                  disabled={!!actionLoading}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
                >
                  <FontAwesomeIcon icon={faExclamationTriangle} className="w-3.5 h-3.5" />
                  {actionLoading === "zero-all" ? "Zeroing..." : "Zero All Stock"}
                </button>
              )}
              {canCompleteInReview && isReviewMode && (
                <button
                  onClick={async () => {
                    const shouldComplete = await showConfirmDialog({
                      title: "Complete stock take?",
                      message: "Ensure all discrepancies are reviewed before finalizing.",
                      tone: "warning",
                      confirmLabel: "Complete stock take",
                      cancelLabel: "Keep reviewing",
                    });
                    if (!shouldComplete) return;
                    performAction("complete");
                  }}
                  disabled={!!actionLoading || hasPending || reviewStats.uncounted > 0}
                  className="btn-action-primary flex items-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FontAwesomeIcon icon={faCheck} className="w-3.5 h-3.5" />
                  Complete Stocktake
                </button>
              )}
              {stockTake.status === "completed" && (
                <button
                  onClick={() => performAction("approve")}
                  disabled={!!actionLoading}
                  className="btn-action-success flex items-center gap-2 text-sm"
                >
                  <FontAwesomeIcon icon={faThumbsUp} className="w-3.5 h-3.5" />
                  Approve
                </button>
              )}
              {stockTake.status === "approved" && !stockTake.adjustmentApplied && (
                <button
                  onClick={async () => {
                    const shouldApply = await showConfirmDialog({
                      title: "Apply inventory adjustments?",
                      message: "All variance adjustments will be applied to inventory and cannot be undone.",
                      tone: "danger",
                      confirmLabel: "Apply adjustments",
                      cancelLabel: "Cancel",
                    });
                    if (!shouldApply) return;
                    performAction("apply-adjustments");
                  }}
                  disabled={!!actionLoading}
                  className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
                >
                  <FontAwesomeIcon icon={faSyncAlt} className="w-3.5 h-3.5" />
                  Apply Adjustments
                </button>
              )}
              {stockTake.adjustmentApplied && (
                <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 px-3 py-2 rounded-lg text-sm font-medium border border-green-200">
                  <FontAwesomeIcon icon={faCheckCircle} className="w-4 h-4" />
                  Adjustments Applied
                </span>
              )}
              {hasItems && (
                <button onClick={exportCSV} className="btn-action flex items-center gap-2 text-sm">
                  <FontAwesomeIcon icon={faDownload} className="w-3.5 h-3.5" />
                  Export CSV
                </button>
              )}
              {!isReviewMode && !stockTake.adjustmentApplied && !["approved", "cancelled"].includes(stockTake.status) && (
                <button
                  onClick={async () => {
                    const shouldCancel = await showConfirmDialog({
                      title: "Cancel stock take?",
                      message: "The current stock take will be cancelled.",
                      tone: "danger",
                      confirmLabel: "Cancel stock take",
                      cancelLabel: "Keep stock take",
                    });
                    if (!shouldCancel) return;
                    performAction("cancel");
                  }}
                  disabled={!!actionLoading}
                  className="btn-action btn-action-danger flex items-center gap-2 text-sm"
                >
                  <FontAwesomeIcon icon={faTimes} className="w-3.5 h-3.5" />
                  Cancel
                </button>
              )}
            </div>
          </div>

          {isEditable && !isReviewMode && (
            <div className="content-card mb-6">
              <div className="flex flex-col xl:flex-row gap-4 xl:items-start xl:justify-between">
                <div className="flex-1">
                  <div className="relative flex gap-2">
                    <FontAwesomeIcon icon={faSearch} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="text"
                      value={productSearchTerm}
                      onChange={(e) => setProductSearchTerm(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && productSearchResults[0]) {
                          e.preventDefault();
                          handleAddProduct(productSearchResults[0]._id);
                        }
                      }}
                      placeholder="Search for products to add by name or barcode..."
                      className="form-input pl-12 placeholder:text-gray-400"
                    />

                    {(searchingProducts || productSearchResults.length > 0 || productSearchTerm.trim().length >= 2) && (
                      <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                        {searchingProducts ? (
                          <div className="px-4 py-3 text-sm text-gray-500">Searching products...</div>
                        ) : productSearchResults.length > 0 ? (
                          productSearchResults.map((product) => (
                            <button
                              key={product._id}
                              type="button"
                              onClick={() => handleAddProduct(product._id)}
                              className="flex w-full items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors hover:bg-gray-50 last:border-b-0"
                            >
                              <div>
                                <div className="font-medium text-gray-900">{product.name}</div>
                                <div className="text-xs text-gray-500">{product.barcode || "No barcode"}</div>
                              </div>
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                                <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
                                Add
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-sm text-gray-500">No matching products found.</div>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    Add a single product from search, or use Create List to build a stock take by vendor, category, shelf line, or all products.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 xl:justify-end">
                  <button onClick={handlePrint} className="btn-action flex items-center gap-2 text-sm">
                    <FontAwesomeIcon icon={faPrint} className="w-3.5 h-3.5" />
                    Print
                  </button>
                  <button
                    onClick={handleClearList}
                    disabled={!hasItems || !!actionLoading}
                    className="btn-action flex items-center gap-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FontAwesomeIcon icon={faTimes} className="w-3.5 h-3.5" />
                    Clear List
                  </button>
                  <button
                    onClick={() => setShowCreateListModal(true)}
                    disabled={!!actionLoading}
                    className="btn-action-primary flex items-center gap-2 text-sm"
                  >
                    <FontAwesomeIcon icon={faClipboardList} className="w-3.5 h-3.5" />
                    Create List
                  </button>
                </div>
              </div>
            </div>
          )}

          {!isReviewMode && isEditable && !hasItems ? (
            <div className="content-card py-16">
              <div className="grid gap-10 text-center md:grid-cols-2 md:items-start">
                <div>
                  <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full border-4 border-gray-200 text-gray-300">
                    <FontAwesomeIcon icon={faSearch} className="w-9 h-9" />
                  </div>
                  <h2 className="text-2xl font-semibold text-gray-700">Search products</h2>
                  <p className="mt-2 text-sm text-gray-400">
                    Search by product name or barcode to add only the products you want to count.
                  </p>
                </div>
                <div>
                  <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full border-4 border-gray-200 text-gray-300">
                    <FontAwesomeIcon icon={faClipboardList} className="w-9 h-9" />
                  </div>
                  <h2 className="text-2xl font-semibold text-gray-700">Create a list</h2>
                  <p className="mt-2 text-sm text-gray-400">
                    Build the stock take from all products, or narrow it by vendor, category, or shelf line before counting starts.
                  </p>
                </div>
              </div>
            </div>
          ) : isReviewMode ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
                {[
                  { label: "All Items", value: reviewStats.total, accent: "border-sky-500 text-sky-600" },
                  { label: "Discrepancies", value: reviewStats.discrepancies, accent: "border-red-400 text-red-500" },
                  { label: "Correct", value: reviewStats.correct, accent: "border-green-400 text-green-500" },
                  { label: "Uncounted", value: reviewStats.uncounted, accent: "border-gray-700 text-gray-800" },
                ].map((card) => (
                  <div key={card.label} className={`rounded-xl border-2 bg-white px-6 py-5 text-center ${card.accent}`}>
                    <div className="text-xs font-semibold uppercase tracking-[0.25em] text-gray-400">Showing</div>
                    <div className={`mt-3 text-4xl font-light ${card.accent.split(" ").at(-1) || "text-gray-900"}`}>{card.value}</div>
                    <div className="mt-3 text-lg font-medium uppercase tracking-wide text-gray-700">{card.label}</div>
                  </div>
                ))}
              </div>

              <div className="content-card mb-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  {isEditable ? (
                    <div className="flex flex-col gap-3 md:flex-row md:items-center">
                      <select
                        value={bulkReason}
                        onChange={(e) => setBulkReason(e.target.value)}
                        className="form-select w-full md:w-52"
                      >
                        {REASON_OPTIONS.map((reason) => (
                          <option key={reason} value={reason}>{reason}</option>
                        ))}
                      </select>
                      <button onClick={handleApplyReasonToAll} className="btn-action-primary text-sm px-5 py-2.5">
                        Apply To All
                      </button>
                    </div>
                  ) : <div />}

                  <div className="flex flex-wrap gap-2 xl:justify-end">
                    {isEditable && (
                      <>
                        <button
                          onClick={handleZeroUncounted}
                          disabled={reviewStats.uncounted === 0 || !!actionLoading}
                          className="btn-action text-sm disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Zero Uncounted
                        </button>
                        <button
                          onClick={handleRemoveUncounted}
                          disabled={reviewStats.uncounted === 0 || !!actionLoading}
                          className="btn-action text-sm disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remove Uncounted
                        </button>
                      </>
                    )}
                    <button onClick={handlePrint} className="btn-action text-sm">
                      Print
                    </button>
                  </div>
                </div>
              </div>

              <div className="content-card overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead>
                    <tr className="border-b-2 border-gray-200 text-left">
                      <th className="py-2 px-2 font-semibold text-gray-600 w-8">#</th>
                      <th className="py-2 px-2 font-semibold text-gray-600">Product</th>
                      <th className="py-2 px-2 font-semibold text-gray-600 hidden md:table-cell">Barcode</th>
                      <th className="py-2 px-2 font-semibold text-gray-600 text-center">Expected Stock</th>
                      <th className="py-2 px-2 font-semibold text-gray-600 text-center">Actual Stock</th>
                      <th className="py-2 px-2 font-semibold text-gray-600 text-center">Variance</th>
                      <th className="py-2 px-2 font-semibold text-gray-600 text-right hidden lg:table-cell">Variance Value</th>
                      <th className="py-2 px-2 font-semibold text-gray-600 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewItemGroups.map((group, index) => {
                      const standardItem = group.standard || group.primary;
                      const looseItem = group.loose;
                      const hasPackAndLoose = Boolean(group.standard && group.loose);
                      const discrepantItems = group.items.filter((item) => (
                        item.countedQty !== null && item.countedQty !== undefined && Number(item.variance || 0) !== 0
                      ));

                      return (
                        <Fragment key={group.key}>
                          <tr className={`border-b border-gray-100 transition-colors ${
                            group.hasVariance
                              ? group.variance > 0
                                ? "bg-green-50/40"
                                : "bg-red-50/40"
                              : "hover:bg-gray-50"
                          }`}>
                            <td className="py-2 px-2 text-gray-400 text-xs">{index + 1}</td>
                            <td className="py-2 px-2">
                              <div className="font-medium text-gray-900 text-sm">
                                {group.productName}
                                {hasPackAndLoose && (
                                  <span className="ml-2 rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-700">
                                    Pack + each
                                  </span>
                                )}
                              </div>
                              {hasPackAndLoose && (
                                <div className="mt-1 text-xs text-gray-500">
                                  {looseItem.qtyPerPack || standardItem.qtyPerPack || 1} each per pack
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-2 font-mono text-xs text-gray-500 hidden md:table-cell">{group.barcode || "—"}</td>
                            <td className="py-2 px-2 text-center font-medium text-gray-700">
                              {hasPackAndLoose ? (
                                <div className="space-y-1 text-xs">
                                  <div>Pack: {formatStockTakeQuantity(standardItem.systemQty)}</div>
                                  <div>Each: {formatStockTakeQuantity(looseItem.systemQty)}</div>
                                </div>
                              ) : formatStockTakeQuantity(group.primary.systemQty)}
                            </td>
                            <td className="py-2 px-2 text-center font-medium text-gray-900">
                              {hasPackAndLoose ? (
                                <div className="space-y-1 text-xs">
                                  <div>Pack: {standardItem.countedQty ?? "—"}</div>
                                  <div>Each: {looseItem.countedQty ?? "—"}</div>
                                </div>
                              ) : group.primary.countedQty ?? "—"}
                            </td>
                            <td className="py-2 px-2 text-center">
                              {group.isPartiallyCounted ? (
                                <span className={`font-bold ${
                                  group.variance > 0 ? "text-green-600" : group.variance < 0 ? "text-red-600" : "text-gray-500"
                                }`}>
                                  {group.variance > 0 ? "+" : ""}
                                  {formatStockTakeQuantity(group.variance)}
                                </span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-right hidden lg:table-cell">
                              {group.hasVariance ? (
                                <span className={group.variance > 0 ? "text-green-600" : "text-red-600"}>
                                  {formatCurrency(Math.abs(group.varianceValue || 0))}
                                </span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-center">
                              <span className={`inline-flex w-2 h-2 rounded-full ${group.isCounted ? "bg-green-500" : group.isPartiallyCounted ? "bg-yellow-500" : "bg-gray-300"}`} />
                            </td>
                          </tr>
                          {discrepantItems.length > 0 && (
                            <tr className="bg-gray-50/80 border-b border-gray-100">
                              <td colSpan={3} className="px-2 py-3 text-sm text-gray-500 text-right">
                                The reason for the difference is
                              </td>
                              <td colSpan={5} className="px-2 py-3">
                                <div className="flex flex-col items-end gap-2">
                                  {discrepantItems.map((item) => (
                                    <div key={item._id} className="flex w-full max-w-md items-center gap-2">
                                      {hasPackAndLoose && (
                                        <span className="w-14 text-right text-xs font-semibold text-gray-500">
                                          {item.countType === "loose-units" ? "Each" : "Pack"}
                                        </span>
                                      )}
                                      <select
                                        value={item.reason || REASON_OPTIONS[0]}
                                        onChange={(e) => handleReasonChange(item._id, e.target.value)}
                                        disabled={!isEditable}
                                        className="form-select flex-1"
                                      >
                                        {REASON_OPTIONS.map((reason) => (
                                          <option key={reason} value={reason}>{reason}</option>
                                        ))}
                                      </select>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                {reviewItemGroups.length === 0 && (
                  <div className="text-center py-12 text-gray-400">
                    <FontAwesomeIcon icon={faBalanceScale} className="w-10 h-10 mb-3" />
                    <p>No items available for review</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
                {[
                  { label: "Count Entries", value: countStats.total },
                  { label: "Fully Counted", value: countStats.counted },
                  { label: "Partial", value: countStats.partial },
                  { label: "Progress", value: `${progressPct}%` },
                  { label: "Net Variance", value: countStats.netVariance, isVariance: true },
                ].map((stat, index) => (
                  <div key={index} className="bg-white border border-gray-200 rounded-lg p-3 text-center">
                    <div className={`text-lg font-bold ${
                      stat.isVariance
                        ? (stat.raw || stat.value) > 0
                          ? "text-green-600"
                          : (stat.raw || stat.value) < 0
                          ? "text-red-600"
                          : "text-gray-900"
                        : "text-gray-900"
                    }`}>
                      {stat.isVariance && typeof stat.value === "number" && stat.value > 0 ? "+" : ""}
                      {stat.value}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
                  </div>
                ))}
              </div>

              <div className="mb-6">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">Counting Progress</span>
                  <span className="text-xs font-medium text-gray-700">{countStats.counted} / {countStats.total}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-500 ${
                      progressPct === 100 ? "bg-green-500" : progressPct > 50 ? "bg-blue-500" : "bg-orange-400"
                    }`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              <div className="content-card mb-4">
                <div className="flex flex-col md:flex-row gap-3">
                  <div className="relative flex-1">
                    <FontAwesomeIcon icon={faSearch} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="text"
                      placeholder="Search products by name or barcode..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="form-input pl-12 placeholder:text-gray-400"
                    />
                  </div>
                  <select
                    value={filterItemStatus}
                    onChange={(e) => setFilterItemStatus(e.target.value)}
                    className="form-select w-full md:w-36"
                  >
                    <option value="all">All Items</option>
                    <option value="pending">Pending</option>
                    <option value="counted">Counted</option>
                  </select>
                  <select
                    value={filterVariance}
                    onChange={(e) => setFilterVariance(e.target.value)}
                    className="form-select w-full md:w-44"
                  >
                    <option value="all">All Variances</option>
                    <option value="positive">Surplus (+)</option>
                    <option value="negative">Shortage (-)</option>
                    <option value="match">Exact Match</option>
                    <option value="uncounted">Not Counted</option>
                  </select>
                </div>
              </div>

              <div className="content-card overflow-x-auto">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-gray-500">{filteredItemGroups.length} count entr{filteredItemGroups.length === 1 ? "y" : "ies"} shown</p>
                </div>
                <table className="w-full min-w-[980px] text-sm">
                  <thead>
                    <tr className="border-b-2 border-gray-200 text-left">
                      <th className="py-2 px-2 font-semibold text-gray-600 w-8">#</th>
                      <th className="py-2 px-2 font-semibold text-gray-600">Product</th>
                      <th className="py-2 px-2 font-semibold text-gray-600 hidden md:table-cell">Barcode</th>
                      <th className="py-2 px-2 font-semibold text-gray-600 text-center">System Qty</th>
                      <th className="py-2 px-2 font-semibold text-gray-600 text-center w-44 min-w-[11rem]">Counted</th>
                      <th className="py-2 px-2 font-semibold text-gray-600 text-center">Variance</th>
                      <th className="py-2 px-2 font-semibold text-gray-600 text-right hidden lg:table-cell">Variance Value</th>
                      <th className="py-2 px-2 font-semibold text-gray-600 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItemGroups.map((group, index) => {
                      const standardItem = group.standard || group.primary;
                      const looseItem = group.loose;
                      const hasPackAndLoose = Boolean(group.standard && group.loose);
                      const nextGroup = filteredItemGroups[index + 1];
                      const nextFocusId = nextGroup?.standard?._id || nextGroup?.primary?._id;

                      return (
                        <tr key={group.key} className={`border-b border-gray-100 transition-colors ${
                          group.isPartiallyCounted && group.variance !== 0
                            ? group.variance > 0
                              ? "bg-green-50/40"
                              : "bg-red-50/40"
                            : "hover:bg-gray-50"
                        }`}>
                          <td className="py-2 px-2 text-gray-400 text-xs">{index + 1}</td>
                          <td className="py-2 px-2 align-top">
                            <div className="flex flex-wrap items-center gap-2 font-medium text-gray-900 text-sm leading-snug">
                              <span>{group.productName}</span>
                              {hasPackAndLoose && (
                                <span className="inline-flex shrink-0 whitespace-nowrap rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-700">
                                  Pack + each
                                </span>
                              )}
                            </div>
                            {hasPackAndLoose && (
                              <div className="mt-1 text-xs text-gray-500">
                                {looseItem.qtyPerPack || standardItem.qtyPerPack || 1} each per pack
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-2 font-mono text-xs text-gray-500 hidden md:table-cell">{group.barcode || "—"}</td>
                          <td className="py-2 px-2 text-center font-medium text-gray-700">
                            {hasPackAndLoose ? (
                              <div className="mx-auto grid w-28 grid-cols-[3.25rem_1fr] gap-x-2 gap-y-1 text-xs leading-tight">
                                <span className="text-right text-gray-500">Pack</span>
                                <span className="text-left font-semibold text-gray-800">{formatStockTakeQuantity(standardItem.systemQty)}</span>
                                <span className="text-right text-gray-500">Each</span>
                                <span className="text-left font-semibold text-orange-700">{formatStockTakeQuantity(looseItem.systemQty)}</span>
                              </div>
                            ) : (
                              formatStockTakeQuantity(standardItem.systemQty)
                            )}
                          </td>
                          <td className="py-2 px-2 text-center">
                            {isEditable ? (
                              <div className={hasPackAndLoose ? "mx-auto grid w-36 grid-cols-[3.25rem_5rem] items-center gap-x-2 gap-y-2" : "flex justify-center"}>
                                <label className={hasPackAndLoose ? "contents text-xs text-gray-500" : ""}>
                                  {hasPackAndLoose && <span className="text-right text-xs text-gray-500">Pack</span>}
                                  <input
                                    ref={(element) => {
                                      if (element) countInputRefs.current[standardItem._id] = element;
                                    }}
                                    type="number"
                                    min="0"
                                    value={standardItem.countedQty ?? ""}
                                    onChange={(e) => handleCountChange(standardItem._id, e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        const focusId = hasPackAndLoose ? looseItem._id : nextFocusId;
                                        if (focusId && countInputRefs.current[focusId]) {
                                          countInputRefs.current[focusId].focus();
                                          countInputRefs.current[focusId].select();
                                        }
                                      }
                                    }}
                                    className="w-20 text-center border border-gray-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                                    placeholder="0"
                                  />
                                </label>
                                {hasPackAndLoose && (
                                  <label className="contents text-xs text-gray-500">
                                    <span className="text-right text-xs text-gray-500">Each</span>
                                    <input
                                      ref={(element) => {
                                        if (element) countInputRefs.current[looseItem._id] = element;
                                      }}
                                      type="number"
                                      min="0"
                                      value={looseItem.countedQty ?? ""}
                                      onChange={(e) => handleCountChange(looseItem._id, e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" && nextFocusId && countInputRefs.current[nextFocusId]) {
                                          countInputRefs.current[nextFocusId].focus();
                                          countInputRefs.current[nextFocusId].select();
                                        }
                                      }}
                                      className="w-20 text-center border border-orange-200 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-orange-300 focus:border-transparent"
                                      placeholder="0"
                                    />
                                  </label>
                                )}
                              </div>
                            ) : (
                              <div className={hasPackAndLoose ? "mx-auto grid w-28 grid-cols-[3.25rem_1fr] gap-x-2 gap-y-1 text-xs font-medium" : "font-medium"}>
                                {hasPackAndLoose ? (
                                  <>
                                    <span className="text-right text-gray-500">Pack</span>
                                    <span className="text-left text-gray-900">{standardItem.countedQty ?? "—"}</span>
                                    <span className="text-right text-gray-500">Each</span>
                                    <span className="text-left text-orange-700">{looseItem.countedQty ?? "—"}</span>
                                  </>
                                ) : (
                                  standardItem.countedQty ?? "—"
                                )}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-2 text-center">
                            {group.isPartiallyCounted ? (
                              <span className={`font-bold ${
                                group.variance > 0 ? "text-green-600" : group.variance < 0 ? "text-red-600" : "text-gray-500"
                              }`}>
                                {group.variance > 0 ? "+" : ""}
                                {formatStockTakeQuantity(group.variance)}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right hidden lg:table-cell">
                            {group.isPartiallyCounted && group.variance !== 0 ? (
                              <span className={group.variance > 0 ? "text-green-600" : "text-red-600"}>
                                {formatCurrency(Math.abs(group.varianceValue || 0))}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-center">
                            {group.isCounted ? (
                              <span className="inline-flex w-2 h-2 rounded-full bg-green-500" title="Counted" />
                            ) : group.isPartiallyCounted ? (
                              <span className="inline-flex w-2 h-2 rounded-full bg-yellow-400" title="Partially counted" />
                            ) : (
                              <span className="inline-flex w-2 h-2 rounded-full bg-gray-300" title="Pending" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredItemGroups.length === 0 && (
                  <div className="text-center py-12 text-gray-400">
                    <FontAwesomeIcon icon={faBalanceScale} className="w-10 h-10 mb-3" />
                    <p>No items match your filters</p>
                  </div>
                )}
              </div>
            </>
          )}

          {showCreateListModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">Create Stocktake List</h2>
                    <p className="mt-1 text-sm text-gray-500">Choose how you want to build this stock take list.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowCreateListModal(false)}
                    className="rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                  >
                    <FontAwesomeIcon icon={faTimes} className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4 px-5 py-5">
                  <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                    Leave every filter on All Products to create a full stock take list.
                  </div>

                  <div className="grid gap-4">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-gray-700">Vendors</label>
                      <select
                        value={listFilters.vendorId}
                        onChange={(e) => setListFilters((current) => ({ ...current, vendorId: e.target.value }))}
                        className="form-select"
                      >
                        <option value="">All Products</option>
                        {builderOptions.vendors.map((vendor) => (
                          <option key={vendor.value} value={vendor.value}>{vendor.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-gray-700">Categories</label>
                      <select
                        value={listFilters.categoryId}
                        onChange={(e) => setListFilters((current) => ({ ...current, categoryId: e.target.value }))}
                        className="form-select"
                      >
                        <option value="">All Categories</option>
                        {builderOptions.categories.map((category) => (
                          <option key={category.value} value={category.value}>{category.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-gray-700">Shelf Line</label>
                      <select
                        value={listFilters.shelfLine}
                        onChange={(e) => setListFilters((current) => ({ ...current, shelfLine: e.target.value }))}
                        className="form-select"
                      >
                        <option value="">All Shelf Lines</option>
                        {builderOptions.shelfLines.map((shelfLine) => (
                          <option key={shelfLine.value} value={shelfLine.value}>{shelfLine.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-gray-200 px-5 py-4 sm:flex-row sm:justify-between">
                  <button
                    type="button"
                    onClick={() => setListFilters(EMPTY_LIST_FILTERS)}
                    className="btn-action w-full sm:w-auto"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateList}
                    disabled={actionLoading === "create-list"}
                    className="btn-action-primary w-full sm:w-auto"
                  >
                    {actionLoading === "create-list" ? "Creating..." : "Create List"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
