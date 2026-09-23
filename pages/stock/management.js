import Layout from "@/components/Layout";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/router";
import { Loader } from "@/components/ui";
import useProgress from "@/lib/useProgress";
import { useIndexedDBCache, clearCache } from "@/lib/useIndexedDBCache";
import { getCachedCategories } from "@/lib/categoriesCache";
import { getPackSize } from "@/lib/packUnits";
import { useTableSort, SortableTh } from "@/components/SortableTable";
import ExportMenu from "@/components/ExportMenu";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";

const LOCATION_FILTER_KEY = "stockManagement:locationFilter";
const CARD_FILTER_KEY = "stockManagement:cardFilter";

function normalizeLocationValue(value) {
  if (value && typeof value === "object") {
    return String(value.name || value.label || value.code || value._id || value.id || "").trim().toLowerCase();
  }
  return String(value || "").trim().toLowerCase();
}

function getLocationLabels(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => getLocationLabels(entry));
  }
  if (value && typeof value === "object") {
    return [value.name, value.label, value.code, value._id, value.id]
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  }
  const label = String(value || "").trim();
  return label ? [label] : [];
}

function getLocationDisplayLabel(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return String(value.name || value.label || value.code || value._id || value.id || "").trim();
  }
  return String(value || "").trim();
}

function getLocationTokens(value) {
  return getLocationLabels(value).map((entry) => normalizeLocationValue(entry)).filter(Boolean);
}

function getProductLocationEntries(product) {
  return (Array.isArray(product?.locationStocks) ? product.locationStocks : [])
    .map((entry) => ({
      locationName: String(entry?.locationName || "").trim(),
      quantity: Number(entry?.quantity || 0),
    }))
    .filter((entry) => entry.locationName && Math.abs(entry.quantity) > 0.0001);
}

function getProductLocationTokens(product) {
  return getProductLocationEntries(product).flatMap((entry) => getLocationTokens(entry.locationName));
}

function getProductLocationLabel(product) {
  const labels = getProductLocationEntries(product).flatMap((entry) => getLocationLabels(entry.locationName));
  return labels.length > 0 ? [...new Set(labels)].join(", ") : "Unassigned";
}

function getProductLocationQuantity(product, selectedTokens = []) {
  const tokenSet = new Set(selectedTokens.map((token) => normalizeLocationValue(token)).filter(Boolean));
  return getProductLocationEntries(product).reduce((sum, entry) => {
    const entryTokens = getLocationTokens(entry.locationName);
    return entryTokens.some((token) => tokenSet.has(token)) ? sum + entry.quantity : sum;
  }, 0);
}

function isDerivedChild(product) {
  return product?.isChildProduct && product?.packType !== "pack";
}

function getProductId(product) {
  return String(product?._id || product?.id || "");
}

function getParentProductId(product) {
  const parentProduct = product?.parentProduct;
  if (parentProduct && typeof parentProduct === "object") {
    return String(parentProduct._id || parentProduct.id || "");
  }
  return String(parentProduct || "");
}

function formatQuantity(value) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return "0";
  return String(parseFloat(numberValue.toFixed(2)));
}

// Units inside the pack's stock. Every child draws from the same units, so they are never summed.
function getInnerUnitQuantity(product) {
  return Number(product?.quantity || 0) * getPackSize(product);
}

function getInnerUnitLabel(product, childProducts = []) {
  if (childProducts.length === 0) return "-";
  return `${formatQuantity(getInnerUnitQuantity(product))} inner units`;
}

function quoteCsvValue(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const headers = [
    "Name",
    "Category",
    "Location",
    "Current Stock",
    "Inner Unit Stock",
    "Min Stock",
    "Max Stock",
    "Unit Cost",
    "Status",
  ];

  const csv = [
    headers.map(quoteCsvValue).join(","),
    ...rows.map((row) => headers.map((header) => quoteCsvValue(row[header])).join(",")),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function matchesStockState(product, stockFilter) {
  if (isDerivedChild(product)) {
    return false;
  }

  if (stockFilter === "all") {
    return true;
  }

  const quantity = Number(product?.quantity) || 0;
  const minStock = Number(product?.minStock) || 0;

  if (stockFilter === "positiveStock") {
    return quantity > 0;
  }

  // Nothing in stock: the dead entries worth clearing out. A blank quantity reads as
  // zero above, and negative stock is a different problem with its own filter.
  if (stockFilter === "noStock") {
    return quantity === 0;
  }

  if (stockFilter === "negativeStock") {
    return quantity < 0;
  }

  if (stockFilter === "wellStocked") {
    return quantity > minStock;
  }

  if (stockFilter === "critical") {
    return quantity < minStock / 2;
  }

  if (stockFilter === "lowStock") {
    return quantity < minStock;
  }

  return true;
}

export default function StockManagement() {
  const router = useRouter();
  const queryLocation = typeof router.query.location === "string" ? router.query.location : "";

  const fetchStockProducts = useCallback(async () => {
    const res = await fetch("/api/stock-management/location-stock");
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.message || "Failed to fetch products");
    }
    const data = await res.json();
    return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  }, []);

  const { data: cachedProducts, loading: productsLoading, error: productsError, refresh: refreshProducts } =
    useIndexedDBCache("stock_products_cache", fetchStockProducts, 15);

  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [categoryMap, setCategoryMap] = useState({});
  const [availableLocations, setAvailableLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(
    typeof window !== "undefined"
      ? sessionStorage.getItem(LOCATION_FILTER_KEY) || queryLocation || "all"
      : queryLocation || "all"
  );
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [archiving, setArchiving] = useState(false);
  const [selectedStockFilter, setSelectedStockFilter] = useState(
    typeof window !== "undefined"
      ? sessionStorage.getItem(CARD_FILTER_KEY) || "all"
      : "all"
  );

  useEffect(() => {
    async function loadCategories() {
      try {
        const categories = await getCachedCategories();
        const map = {};
        categories.forEach(cat => {
          map[cat._id] = cat.name;
        });
        setCategoryMap(map);
      } catch (error) {
        console.error("Error loading categories:", error);
      }
    }

    loadCategories();
  }, []);

  useEffect(() => {
    let isMounted = true;

    fetch("/api/setup/get")
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) {
          return;
        }

        const storeLocations = Array.isArray(data?.store?.locations)
          ? data.store.locations
          : [];

        setAvailableLocations(storeLocations);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!queryLocation) return;
    setSelectedLocation(queryLocation);
  }, [queryLocation]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(LOCATION_FILTER_KEY, selectedLocation || "all");
  }, [selectedLocation]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(CARD_FILTER_KEY, selectedStockFilter || "all");
  }, [selectedStockFilter]);

  useEffect(() => {
    if (productsLoading && !refreshing) {
      setLoading(true);
    } else {
      setLoading(false);
    }
    if (productsError) {
      setError(productsError || "Failed to load data");
      setProducts([]);
      return;
    }
    setError(null);
    start();
    onFetch();
    const list = Array.isArray(cachedProducts) ? cachedProducts : [];
    setProducts(list);
    onProcess();
    complete();
  }, [cachedProducts, productsLoading, productsError, start, onFetch, onProcess, complete, refreshing]);

  const locationOptions = useMemo(() => {
    const seenLocations = new Map();

    const registerLocation = (locationValue) => {
      const label = getLocationDisplayLabel(locationValue);
      const tokens = getLocationTokens(locationValue);
      if (!label || tokens.length === 0) return;

      const value = normalizeLocationValue(label);
      if (!seenLocations.has(value)) {
        seenLocations.set(value, { value, label, tokens: new Set(tokens) });
        return;
      }

      const existing = seenLocations.get(value);
      tokens.forEach((token) => existing.tokens.add(token));
    };

    availableLocations.forEach(registerLocation);
    products.forEach((product) => {
      getProductLocationEntries(product).forEach((entry) => registerLocation(entry.locationName));
    });

    return Array.from(seenLocations.values())
      .map((option) => ({ ...option, tokens: Array.from(option.tokens) }))
      .sort((leftValue, rightValue) => leftValue.label.localeCompare(rightValue.label));
  }, [availableLocations, products]);

  useEffect(() => {
    const normalizedLocationFilter = normalizeLocationValue(selectedLocation);
    if (["all", "unassigned"].includes(normalizedLocationFilter) || locationOptions.length === 0) return;

    const matchingOption = locationOptions.find((option) =>
      option.value === normalizedLocationFilter || option.tokens.includes(normalizedLocationFilter)
    );

    if (matchingOption && selectedLocation !== matchingOption.value) {
      setSelectedLocation(matchingOption.value);
    }
  }, [locationOptions, selectedLocation]);

  const locationScopedItems = useMemo(() => {
    return products.flatMap((item) => {
      const normalizedLocationFilter = normalizeLocationValue(selectedLocation);
      if (normalizedLocationFilter === "all") {
        return [item];
      }

      const productLocations = getProductLocationTokens(item);

      if (normalizedLocationFilter === "unassigned") {
        return productLocations.length === 0 ? [item] : [];
      }

      const selectedLocationOption = locationOptions.find((option) =>
        option.value === normalizedLocationFilter ||
        option.tokens.includes(normalizedLocationFilter)
      );
      const selectedTokens = selectedLocationOption?.tokens || [normalizedLocationFilter];
      const locationQuantity = getProductLocationQuantity(item, selectedTokens);

      if (Math.abs(locationQuantity) <= 0.0001) {
        return [];
      }

      return [{
        ...item,
        quantity: locationQuantity,
        stockLocationLabel: selectedLocationOption?.label || selectedLocation,
      }];
    });
  }, [products, selectedLocation, locationOptions]);

  const childProductsByParent = useMemo(() => {
    const map = new Map();
    locationScopedItems.filter(isDerivedChild).forEach((childProduct) => {
      const parentId = getParentProductId(childProduct);
      if (!parentId) return;
      const children = map.get(parentId) || [];
      children.push(childProduct);
      map.set(parentId, children);
    });
    return map;
  }, [locationScopedItems]);

  const parentProducts = useMemo(
    () => locationScopedItems.filter((product) => !isDerivedChild(product)),
    [locationScopedItems]
  );

  const filteredItems = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    return parentProducts.filter((item) => {
      if (!matchesStockState(item, selectedStockFilter)) {
        return false;
      }

      const categoryLabel = categoryMap[item.category] || item.category || "";
      const childProducts = childProductsByParent.get(getProductId(item)) || [];
      const childText = childProducts.map((childProduct) => `${childProduct.name || ""} ${childProduct.barcode || ""}`).join(" ").toLowerCase();
      if (!term) {
        return true;
      }

      return (
        item.name?.toLowerCase().includes(term) ||
        categoryLabel.toLowerCase().includes(term) ||
        childText.includes(term)
      );
    });
  }, [parentProducts, selectedStockFilter, searchTerm, categoryMap, childProductsByParent]);

  const { sorted: sortedItems, sortKey, sortDir, toggleSort } = useTableSort(
    filteredItems,
    null,
    "asc",
    {
      category: (item) => categoryMap[item.category] || item.category || "",
      status: (item) => {
        const qty = Number(item?.quantity || 0);
        const min = Number(item?.minStock || 0);
        // Out of stock first, then low, then healthy — the order that matters.
        if (qty <= 0) return 0;
        if (min > 0 && qty <= min) return 1;
        return 2;
      },
    }
  );

  const stockExportColumns = [
    { key: "name", label: "Product", width: 2.6 },
    { key: "category", label: "Category", width: 1.5, value: (p) => categoryMap[p.category] || p.category || "" },
    { key: "locationName", label: "Location", width: 1.4 },
    { key: "quantity", label: "Current Stock", type: "number", align: "right", width: 1.1 },
    { key: "minStock", label: "Min Stock", type: "number", align: "right", width: 1 },
    { key: "costPrice", label: "Unit Cost", type: "currency", align: "right", width: 1.2 },
    {
      key: "stockValue",
      label: "Stock Value",
      type: "currency",
      align: "right",
      width: 1.3,
      value: (p) => (Number(p.quantity) || 0) * (Number(p.costPrice) || 0),
    },
  ];

  const getProductStatus = useCallback((product) => {
    const quantity = Number(product?.quantity || 0);
    const minStock = Number(product?.minStock || 0);

    if (quantity < 0) return "Negative Stock";
    if (quantity === 0) return "Out of Stock";
    if (quantity < minStock) return "Low Stock";
    return "In Stock";
  }, []);

  const buildReportRows = useCallback((sourceProducts) => {
    return sourceProducts.map((product) => {
      const childProducts = childProductsByParent.get(getProductId(product)) || [];
      const innerQuantity = getInnerUnitQuantity(product);
      return {
        "Name": product.name || "N/A",
        "Category": categoryMap[product.category] || product.category || "Uncategorized",
        "Location": product.stockLocationLabel || getProductLocationLabel(product),
        "Current Stock": formatQuantity(product.quantity),
        "Inner Unit Stock": childProducts.length > 0 ? formatQuantity(innerQuantity) : "",
        "Min Stock": formatQuantity(product.minStock),
        "Max Stock": formatQuantity(product.maxStock),
        "Unit Cost": Number(product.costPrice || 0),
        "Status": getProductStatus(product),
      };
    });
  }, [categoryMap, childProductsByParent, getProductStatus]);

  const handleDownloadStockReport = useCallback((mode = "all") => {
    const sourceProducts = mode === "positive"
      ? filteredItems.filter((product) => Number(product.quantity || 0) > 0)
      : mode === "negative"
        ? filteredItems.filter((product) => Number(product.quantity || 0) < 0)
        : filteredItems;

    const normalizedLocation = normalizeLocationValue(selectedLocation || "all").replace(/[^a-z0-9]+/g, "-") || "all";
    const filename = `stock-${mode}-${normalizedLocation}-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadCsv(filename, buildReportRows(sourceProducts));
  }, [buildReportRows, filteredItems, selectedLocation]);

  const totalStock = useMemo(
    () =>
      parentProducts
        .reduce((sum, item) => sum + (item.quantity || 0), 0),
    [parentProducts]
  );
  const totalWellStocked = useMemo(
    () => parentProducts.filter((p) => (p.quantity || 0) > (p.minStock || 0)).length,
    [parentProducts]
  );
  const totalCritical = useMemo(
    () => parentProducts.filter((p) => (p.quantity || 0) < (p.minStock || 0) / 2).length,
    [parentProducts]
  );
  const lowStockCount = useMemo(
    () => parentProducts.filter((p) => p.quantity < (p.minStock || 0)).length,
    [parentProducts]
  );
  const negativeStockCount = useMemo(
    () => parentProducts.filter((p) => Number(p.quantity || 0) < 0).length,
    [parentProducts]
  );

  const stockValueOf = useCallback(
    (product) => (Number(product?.quantity) || 0) * (Number(product?.costPrice) || 0),
    []
  );

  /**
   * What the rows on screen are worth. Negative stock is counted separately as well as
   * in the total: it is stock the system says was sold but never received, and the
   * accounts need the figure on its own rather than netted quietly into the total.
   */
  const tableTotals = useMemo(() => {
    let units = 0;
    let value = 0;
    let negativeUnits = 0;
    let negativeValue = 0;
    let negativeProducts = 0;
    let noStockProducts = 0;

    for (const product of filteredItems) {
      const quantity = Number(product.quantity) || 0;
      const value1 = stockValueOf(product);
      units += quantity;
      value += value1;
      if (quantity < 0) {
        negativeProducts += 1;
        negativeUnits += quantity;
        negativeValue += value1;
      }
      if (quantity === 0) noStockProducts += 1;
    }

    return {
      products: filteredItems.length,
      units,
      value,
      negativeProducts,
      negativeUnits,
      negativeValue,
      noStockProducts,
      // What is actually on the shelves, ignoring the negative entries.
      positiveValue: value - negativeValue,
    };
  }, [filteredItems, stockValueOf]);

  const noStockCount = useMemo(
    () => parentProducts.filter((p) => !Number(p.quantity)).length,
    [parentProducts]
  );

  /* ── Selecting rows to archive ─────────────────────────────────── */

  const toggleSelected = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const shownIds = useMemo(() => filteredItems.map((product) => getProductId(product)), [filteredItems]);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => selectedIds.has(id));
  const someShownSelected = shownIds.some((id) => selectedIds.has(id));

  const toggleAllShown = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const selectAll = !shownIds.every((id) => next.has(id));
      shownIds.forEach((id) => (selectAll ? next.add(id) : next.delete(id)));
      return next;
    });
  }, [shownIds]);

  const selectedProducts = useMemo(
    () => parentProducts.filter((product) => selectedIds.has(getProductId(product))),
    [parentProducts, selectedIds]
  );

  const handleArchiveSelected = useCallback(async () => {
    if (selectedProducts.length === 0) return;
    const withStock = selectedProducts.filter((product) => Number(product.quantity) > 0);
    const names = selectedProducts.slice(0, 5).map((product) => product.name).join(", ");
    const more = selectedProducts.length > 5 ? ` and ${selectedProducts.length - 5} more` : "";

    const confirmed = await showConfirmDialog({
      title: `Archive ${selectedProducts.length} product${selectedProducts.length === 1 ? "" : "s"}?`,
      message:
        `${names}${more} will be hidden from the till and the web shop, and moved to Archived where they can be restored.` +
        (withStock.length > 0
          ? ` ${withStock.length} of them still has stock, which will be set to zero.`
          : ""),
      confirmLabel: "Archive them",
      tone: withStock.length > 0 ? "warning" : "info",
    });
    if (!confirmed) return;

    setArchiving(true);
    try {
      const res = await apiClient.post("/api/products/bulk", {
        ids: selectedProducts.map((product) => getProductId(product)),
        action: "archive",
        reason: "stock-management",
      });
      setSelectedIds(new Set());
      // The stock list is cached, so it has to be refetched to drop the archived rows.
      await Promise.allSettled([clearCache("stock_products_cache"), clearCache("products_cache")]);
      await refreshProducts();
      await showAlertDialog({
        title: "Products archived",
        message: res.data?.message || "Done.",
        tone: "success",
      });
    } catch (err) {
      await showAlertDialog({
        title: "Could not archive",
        message: err.response?.data?.error || "Something went wrong.",
        tone: "danger",
      });
    } finally {
      setArchiving(false);
    }
  }, [selectedProducts, refreshProducts]);

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
        <header className="page-header">
          <h1 className="page-title">Stock Management</h1>
          <p className="page-subtitle">Monitor all stock levels and alerts in real-time.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link href="/stock/stock-take" className="btn-action-primary">
              Start Stock Take
            </Link>
            <Link href="/stock/add?reason=Operational%20Loss" className="btn-action-danger">
              Record Operational Loss
            </Link>
            <ExportMenu
              title="Stock Levels"
              subtitle="Current stock position"
              columns={stockExportColumns}
              rows={sortedItems}
              summary={[
                { label: "Products", value: String(sortedItems.length) },
                {
                  label: "Stock Value",
                  value: formatCurrency(
                    sortedItems.reduce((sum, p) => sum + (Number(p.quantity) || 0) * (Number(p.costPrice) || 0), 0)
                  ),
                },
              ]}
              orientation="l"
            />
            <button
              type="button"
              onClick={async () => {
                setRefreshing(true);
                try {
                  await refreshProducts();
                } finally {
                  setRefreshing(false);
                }
              }}
              disabled={refreshing}
              className="btn-action-secondary"
            >
              {refreshing ? "Refreshing..." : "Refresh Data"}
            </button>
            <button type="button" onClick={() => handleDownloadStockReport("all")} className="btn-action-secondary">
              Download Stock Report
            </button>
            <button type="button" onClick={() => handleDownloadStockReport("positive")} className="btn-action-secondary">
              Download Value Stock
            </button>
            <button type="button" onClick={() => handleDownloadStockReport("negative")} className="btn-action-danger">
              Download Negative Stock
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            <p className="font-semibold">Error: {error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader size="md" text="Loading stock data..." progress={progress} />
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
              <StatCard
                label="Total Stock"
                value={`${parseFloat(totalStock.toFixed(2))} units`}
                active={selectedStockFilter === "all"}
                onClick={() => setSelectedStockFilter("all")}
              />
              <StatCard
                label="Well Stocked"
                value={`${totalWellStocked} products`}
                active={selectedStockFilter === "wellStocked"}
                onClick={() => setSelectedStockFilter("wellStocked")}
              />
              <StatCard
                label="Critical Level"
                value={`${totalCritical} products`}
                active={selectedStockFilter === "critical"}
                onClick={() => setSelectedStockFilter("critical")}
              />
              <StatCard
                label="Low Stock Alerts"
                value={lowStockCount}
                highlight
                active={selectedStockFilter === "lowStock"}
                onClick={() => setSelectedStockFilter("lowStock")}
              />
              <StatCard
                label="Negative Stock"
                value={negativeStockCount}
                highlight
                active={selectedStockFilter === "negativeStock"}
                onClick={() => setSelectedStockFilter("negativeStock")}
              />
              <StatCard
                label="No Stock"
                value={`${noStockCount} products`}
                active={selectedStockFilter === "noStock"}
                onClick={() => setSelectedStockFilter("noStock")}
              />
            </section>

            <div className="mb-6">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="search-input-wrapper max-w-xl flex-1">
                  <input
                    type="text"
                    placeholder="Search by product or category..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input !pl-4"
                  />
                </div>
                <select
                  className="form-select max-w-xs"
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                >
                  <option value="all">All Locations</option>
                  <option value="unassigned">Unassigned</option>
                  {locationOptions.map((locationOption) => (
                    <option key={locationOption.value} value={locationOption.value}>
                      {locationOption.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm("");
                    setSelectedLocation("all");
                    setSelectedStockFilter("all");
                  }}
                  className="btn-action-secondary"
                >
                  Clear Filters
                </button>
              </div>
              <p className="mt-3 text-sm text-gray-500">
                Showing {filteredItems.length} of {parentProducts.length} stock products
                {selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
              </p>

              {selectedIds.size > 0 && (
                <div className="content-card mt-3 flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-gray-700">
                    {selectedIds.size} selected
                    <span className="text-gray-400">
                      {" "}· worth {formatCurrency(selectedProducts.reduce((sum, p) => sum + stockValueOf(p), 0))}
                    </span>
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <button type="button" onClick={() => setSelectedIds(new Set())} className="btn-action btn-action-secondary btn-sm">
                      Clear selection
                    </button>
                    <button
                      type="button"
                      onClick={handleArchiveSelected}
                      disabled={archiving}
                      className="btn-action btn-action-danger btn-sm disabled:opacity-50"
                    >
                      {archiving ? "Archiving…" : `Archive ${selectedIds.size} product${selectedIds.size === 1 ? "" : "s"}`}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <section className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10">
                      {/* Ticks every row the filters leave, not just what fits on screen. */}
                      <input
                        type="checkbox"
                        aria-label="Select all shown products"
                        checked={allShownSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someShownSelected && !allShownSelected;
                        }}
                        onChange={toggleAllShown}
                      />
                    </th>
                    {[
                      { key: "name", label: "Name" },
                      { key: "category", label: "Category" },
                      { key: "locationName", label: "Stock Location" },
                      { key: "quantity", label: "Current Stock", align: "right" },
                      { key: null, label: "Inner Unit" },
                      { key: "minStock", label: "Min Stock", align: "right" },
                      { key: "costPrice", label: "Unit Cost", align: "right" },
                      { key: "status", label: "Status" },
                    ].map((col) =>
                      col.key ? (
                        <SortableTh
                          key={col.label}
                          sortKey={col.key}
                          activeKey={sortKey}
                          dir={sortDir}
                          onSort={toggleSort}
                          align={col.align || "left"}
                        >
                          {col.label}
                        </SortableTh>
                      ) : (
                        <th key={col.label}>{col.label}</th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sortedItems.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="px-6 py-4 text-center text-gray-500">
                        No products match the current filters.
                      </td>
                    </tr>
                  ) : (
                    sortedItems.map((product) => {
                      const qty = product.quantity ?? 0;
                      const childProducts = childProductsByParent.get(getProductId(product)) || [];
                      const status = getProductStatus(product);

                      const productId = getProductId(product);
                      const isSelected = selectedIds.has(productId);

                      return (
                        <tr
                          key={product._id}
                          className={`hover:bg-gray-50 ${isSelected ? "bg-sky-50" : qty < 0 ? "bg-red-50" : ""}`}
                        >
                          <td className="px-6 py-4">
                            <input
                              type="checkbox"
                              aria-label={`Select ${product.name || "product"}`}
                              checked={isSelected}
                              onChange={() => toggleSelected(productId)}
                            />
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-900">
                            {product.name || "N/A"}
                            {childProducts.length > 0 && <span className="ml-2 text-xs text-blue-600 font-normal">mother product</span>}
                          </td>
                          <td className="px-6 py-4 text-gray-700">{categoryMap[product.category] || product.category || "Uncategorized"}</td>
                          <td className="px-6 py-4 text-gray-700">{product.stockLocationLabel || getProductLocationLabel(product)}</td>
                          <td className={`px-6 py-4 font-semibold ${qty < 0 ? "text-red-600" : "text-gray-900"}`}>
                            {formatQuantity(qty)}
                          </td>
                          <td className="px-6 py-4 text-blue-700 font-semibold">
                            {getInnerUnitLabel(product, childProducts)}
                          </td>
                          <td className="px-6 py-4 text-gray-700">{product.minStock ?? 0}</td>
                          <td className="px-6 py-4">{formatCurrency(product.costPrice || 0, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>
                          <td
                            className={`px-6 py-4 font-semibold ${
                              status === "Linked"
                                ? "text-blue-600"
                                : status === "In Stock"
                                ? "text-green-600"
                                : status === "Low Stock"
                                ? "text-yellow-600"
                                : status === "Negative Stock"
                                ? "text-red-700"
                                : "text-red-600"
                            }`}
                          >
                            {status}
                          </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {sortedItems.length > 0 && (
              <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                <tr>
                  <td colSpan="3" className="px-6 py-3 text-sm font-semibold text-gray-700">
                    {tableTotals.products} product{tableTotals.products === 1 ? "" : "s"} shown
                    {tableTotals.noStockProducts > 0 && (
                      <span className="font-normal text-gray-500"> · {tableTotals.noStockProducts} with no stock</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-sm font-semibold text-gray-900">
                    {formatQuantity(tableTotals.units)} units
                  </td>
                  <td colSpan="3" className="px-6 py-3 text-sm text-right font-semibold text-gray-700">
                    Total stock value
                  </td>
                  <td className="px-6 py-3 text-sm font-bold text-gray-900">
                    {formatCurrency(tableTotals.value, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-6 py-3" />
                </tr>
                {tableTotals.negativeProducts > 0 && (
                  <tr className="bg-red-50">
                    <td colSpan="3" className="px-6 py-3 text-sm font-semibold text-red-700">
                      Of which negative: {tableTotals.negativeProducts} product{tableTotals.negativeProducts === 1 ? "" : "s"}
                    </td>
                    <td className="px-6 py-3 text-sm font-semibold text-red-700">
                      {formatQuantity(tableTotals.negativeUnits)} units
                    </td>
                    <td colSpan="3" className="px-6 py-3 text-sm text-right font-semibold text-red-700">
                      Negative value · stock on hand
                    </td>
                    <td className="px-6 py-3 text-sm font-bold text-red-700">
                      {formatCurrency(tableTotals.negativeValue, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      <span className="block text-xs font-semibold text-gray-600">
                        {formatCurrency(tableTotals.positiveValue, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    </td>
                    <td className="px-6 py-3" />
                  </tr>
                )}
              </tfoot>
            )}
          </table>
            </section>
          </>
        )}
        </div>
      </div>
    </Layout>
  );
}

function StatCard({ label, value, highlight = false, active = false, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`stat-card w-full text-center transition-all duration-200 hover:-translate-y-0.5 ${
        highlight ? "border-2 border-amber-400" : ""
      } ${active ? "ring-2 ring-sky-300 border-sky-400 bg-sky-50" : ""}`}
    >
      <p className="stat-card-label">{label}</p>
      <p className="stat-card-value mt-2">{value}</p>
    </button>
  );
}

