import Layout from "@/components/Layout";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/router";
import { Loader } from "@/components/ui";
import useProgress from "@/lib/useProgress";
import { useIndexedDBCache } from "@/lib/useIndexedDBCache";
import { getCachedCategories } from "@/lib/categoriesCache";

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

function isRoomProduct(product) {
  return String(product?.productType || "").trim().toLowerCase() === "room";
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

function getInnerUnitLabel(childProducts = []) {
  if (childProducts.length === 0) return "-";
  const innerQuantity = childProducts.reduce((sum, childProduct) => sum + Number(childProduct.quantity || 0), 0);
  return `${formatQuantity(innerQuantity)} inner units`;
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
  if (isRoomProduct(product) || isDerivedChild(product)) {
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

      if (isRoomProduct(item)) {
        return [];
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
    () => locationScopedItems.filter((product) => !isDerivedChild(product) && !isRoomProduct(product)),
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
      const innerQuantity = childProducts.reduce((sum, childProduct) => sum + Number(childProduct.quantity || 0), 0);
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
              </p>
            </div>

            <section className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    {["Name", "Category", "Stock Location", "Current Stock", "Inner Unit", "Min Stock", "Unit Cost", "Status"].map((header) => (
                      <th key={header}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="px-6 py-4 text-center text-gray-500">
                        No products match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((product) => {
                      const qty = product.quantity ?? 0;
                      const childProducts = childProductsByParent.get(getProductId(product)) || [];
                      const status = getProductStatus(product);

                      return (
                        <tr key={product._id} className={`hover:bg-gray-50 ${qty < 0 ? "bg-red-50" : ""}`}>
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
                            {getInnerUnitLabel(childProducts)}
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

