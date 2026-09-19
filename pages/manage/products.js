// pages/manage/products.js  (or your route file)
"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Search } from "lucide-react";
import Layout from "@/components/Layout";
import { formatCurrency as formatCurrencyValue } from "@/lib/format";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/router";
import { mutate } from "swr";
import { useIndexedDBCache, clearCache } from "@/lib/useIndexedDBCache";
import { getCachedCategories } from "@/lib/categoriesCache";
import { calculateMarginPercent, calculateSalePriceIncTax, normalizeTaxRate, VAT_RATE } from "@/lib/pricing";
import { getUnitsPerChild } from "@/lib/packUnits";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { Loader } from "@/components/ui";
import { useTableSort, SortableTh } from "@/components/SortableTable";
import ExportMenu from "@/components/ExportMenu";

const entriesPerPageDefault = 20;
const entriesPerPageOptions = [10, 20, 50, 100];

function getStoredPositiveInteger(key, fallback) {
  if (typeof window === "undefined") return fallback;
  const parsedValue = Number.parseInt(window.sessionStorage.getItem(key) || "", 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function clampPage(page, totalPages) {
  const normalizedPage = Number.parseInt(page, 10);
  const safePage = Number.isFinite(normalizedPage) ? normalizedPage : 1;
  return Math.min(Math.max(1, safePage), Math.max(1, totalPages));
}

function getPaginationPages(currentPage, totalPages) {
  const pageWindowSize = 5;
  const pages = [];
  const safeTotalPages = Math.max(1, totalPages);
  let startPage = Math.max(1, currentPage - Math.floor(pageWindowSize / 2));
  let endPage = Math.min(safeTotalPages, startPage + pageWindowSize - 1);

  startPage = Math.max(1, endPage - pageWindowSize + 1);

  for (let page = startPage; page <= endPage; page += 1) {
    pages.push(page);
  }

  return pages;
}

// --- fetcher for SWR (uses axios so your existing endpoints stay the same)
const fetcher = (url) => axios.get(url).then((r) => r.data);

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function formatPropertiesForInput(properties = []) {
  return (Array.isArray(properties) ? properties : [])
    .map((property) => {
      const propName = property?.propName ?? property?.name ?? "";
      const propValue = property?.propValue ?? property?.value ?? "";
      return propValue ? `${propName}: ${propValue}` : propName;
    })
    .filter(Boolean)
    .join("\n");
}

function parsePropertiesInput(value = "") {
  return String(value)
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf(":");
      if (separatorIndex === -1) {
        return { propName: entry, propValue: "" };
      }

      return {
        propName: entry.slice(0, separatorIndex).trim(),
        propValue: entry.slice(separatorIndex + 1).trim(),
      };
    })
    .filter((property) => property.propName);
}

function normalizeLocationValue(value) {
  return String(value || "").trim().toLowerCase();
}

export default function Products() {
  const router = useRouter();
  const fetchProducts = useCallback(() => fetcher("/api/products?listAll=true"), []);
  const queryLocation = typeof router.query.location === "string" ? router.query.location : "";

  // ========== SMART CACHING STRATEGY ==========
  // Products: IndexedDB cache with 30-minute TTL (frequently changes)
  // + SWR background revalidation (only if cache expired)
  const { data: cachedProducts, loading: productsLoading, error: productsError, refresh: refreshProducts } = useIndexedDBCache(
    "products_cache",
    fetchProducts,
    30 // 30 minutes TTL
  );

  // ========== LOCAL UI STATE ==========
  const [allProducts, setAllProducts] = useState([]); // full list (from cache)
  const [filteredProducts, setFilteredProducts] = useState([]); // after search/filter
  const [categoryMap, setCategoryMap] = useState({});
  const [editIndex, setEditIndex] = useState(null);
  const [editableProduct, setEditableProduct] = useState({});
  const [propertiesText, setPropertiesText] = useState("");
  const [searchTerm, setSearchTerm] = useState(
    typeof window !== "undefined" ? sessionStorage.getItem("products:searchTerm") || "" : ""
  );
  const [expandedRow, setExpandedRow] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true); // Track first load
  const [isRefreshingList, setIsRefreshingList] = useState(false);
  const [isApplyingChanges, setIsApplyingChanges] = useState(false);
  const [savingProductId, setSavingProductId] = useState(null);
  const [isOpeningAddProduct, setIsOpeningAddProduct] = useState(false);

  // AI pricing recommendations cache (loaded once)
  const [aiPriceMap, setAiPriceMap] = useState({});
  const [selectedCategory, setSelectedCategory] = useState(
    typeof window !== "undefined" ? sessionStorage.getItem("products:categoryFilter") || "all" : "all"
  );
  const [selectedLocation, setSelectedLocation] = useState(
    typeof window !== "undefined"
      ? sessionStorage.getItem("products:locationFilter") || queryLocation || "all"
      : queryLocation || "all"
  );
  const [availableLocations, setAvailableLocations] = useState([]);

  // pagination
  const [entriesPerPage, setEntriesPerPage] = useState(() => {
    const storedPageSize = getStoredPositiveInteger("products:entriesPerPage", entriesPerPageDefault);
    return entriesPerPageOptions.includes(storedPageSize) ? storedPageSize : entriesPerPageDefault;
  });
  const [currentPage, setCurrentPage] = useState(() => getStoredPositiveInteger("products:currentPage", 1));

  // highlighted product id (persisted so when you go to edit page and back it stays)
  const [highlightedId, setHighlightedId] = useState(
    typeof window !== "undefined" ? sessionStorage.getItem("products:highlight") : null
  );

  // refs
  const searchRef = useRef();

  const categoryOptions = useMemo(() => {
    const seen = new Set();
    const rows = [];
    (Array.isArray(allProducts) ? allProducts : []).forEach((p) => {
      const id = p?.category;
      if (!id || seen.has(id)) return;
      seen.add(id);
      rows.push({ id, label: categoryMap[id] || "Uncategorized" });
    });
    return rows.sort((a, b) => a.label.localeCompare(b.label));
  }, [allProducts, categoryMap]);

  const allCategoryOptions = useMemo(
    () => Object.entries(categoryMap)
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [categoryMap]
  );

  const locationOptions = useMemo(() => {
    const seenLocations = new Map();

    [...availableLocations, ...(Array.isArray(allProducts) ? allProducts.flatMap((product) => product.locations || []) : [])]
      .map((locationValue) => String(locationValue || "").trim())
      .filter(Boolean)
      .forEach((locationValue) => {
        const normalizedValue = normalizeLocationValue(locationValue);
        if (!seenLocations.has(normalizedValue)) {
          seenLocations.set(normalizedValue, locationValue);
        }
      });

    return Array.from(seenLocations.values()).sort((leftValue, rightValue) => leftValue.localeCompare(rightValue));
  }, [availableLocations, allProducts]);

  const applyFilters = useCallback((term, categoryId, locationId) => {
    const t = term.trim().toLowerCase();
    const filtered = (Array.isArray(allProducts) ? allProducts : []).filter((p) => {
      const matchesCategory = categoryId === "all" ? true : p.category === categoryId;
      if (!matchesCategory) return false;

      const normalizedLocationFilter = normalizeLocationValue(locationId);
      const productLocations = Array.isArray(p.locations)
        ? p.locations.map((locationValue) => normalizeLocationValue(locationValue)).filter(Boolean)
        : [];
      const matchesLocation =
        normalizedLocationFilter === "all"
          ? true
          : normalizedLocationFilter === "unassigned"
            ? productLocations.length === 0
            : productLocations.includes(normalizedLocationFilter);
      if (!matchesLocation) return false;

      if (!t) return true;
      return [p.name, p.barcode, p.description, categoryMap[p.category]]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(t));
    });
    setFilteredProducts(filtered);
  }, [allProducts, categoryMap]);

  // Initialize from cache when data arrives
  useEffect(() => {
    if (productsLoading) {
      setIsInitializing(true);
      return;
    }
    const list = Array.isArray(cachedProducts) ? cachedProducts : cachedProducts?.data || [];
    setAllProducts(list);
    const t = searchTerm.trim().toLowerCase();
    const filtered = list.filter((p) => {
      const matchesCategory = selectedCategory === "all" ? true : p.category === selectedCategory;
      if (!matchesCategory) return false;

      const normalizedLocationFilter = normalizeLocationValue(selectedLocation);
      const productLocations = Array.isArray(p.locations)
        ? p.locations.map((locationValue) => normalizeLocationValue(locationValue)).filter(Boolean)
        : [];
      const matchesLocation =
        normalizedLocationFilter === "all"
          ? true
          : normalizedLocationFilter === "unassigned"
            ? productLocations.length === 0
            : productLocations.includes(normalizedLocationFilter);
      if (!matchesLocation) return false;

      if (!t) return true;
      return [p.name, p.barcode, p.description, categoryMap[p.category]]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(t));
    });
    setFilteredProducts(filtered);
    setIsInitializing(false);
  }, [cachedProducts, productsLoading, searchTerm, selectedCategory, selectedLocation, categoryMap]);

  // Load cached AI pricing recommendations (once, non-blocking)
  useEffect(() => {
    apiClient.get("/api/ai/recommendations?type=pricing&limit=100")
      .then(res => {
        const map = {};
        (res.data?.recommendations || []).forEach(r => {
          if (r.entityId && r.data?.recommendedPrice) map[String(r.entityId)] = r.data;
        });
        setAiPriceMap(map);
      })
      .catch(() => {});
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const catList = await getCachedCategories();
      const map = (Array.isArray(catList) ? catList : []).reduce((acc, c) => {
        acc[c._id] = c.name;
        return acc;
      }, {});
      setCategoryMap(map);
    } catch {
      setCategoryMap({});
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    let isMounted = true;

    apiClient.get("/api/setup/get")
      .then((response) => {
        if (!isMounted) {
          return;
        }

        const storeLocations = Array.isArray(response.data?.store?.locations)
          ? response.data.store.locations
              .map((locationValue) => locationValue?.name || locationValue)
              .map((locationValue) => String(locationValue || "").trim())
              .filter(Boolean)
          : [];

        setAvailableLocations(storeLocations);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const onFocus = () => loadCategories();
    const onStorage = (event) => {
      if (event.key === "categories_cache_version") {
        loadCategories();
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, [loadCategories]);

  // Keep highlightedId in sessionStorage so it's preserved when navigating away & back
  useEffect(() => {
    if (highlightedId) sessionStorage.setItem("products:highlight", highlightedId);
    else sessionStorage.removeItem("products:highlight");
  }, [highlightedId]);

  // Persist list filters so returning from advanced edit keeps current view.
  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem("products:searchTerm", searchTerm || "");
  }, [searchTerm]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem("products:categoryFilter", selectedCategory || "all");
  }, [selectedCategory]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem("products:locationFilter", selectedLocation || "all");
  }, [selectedLocation]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem("products:currentPage", String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem("products:entriesPerPage", String(entriesPerPage));
  }, [entriesPerPage]);

  useEffect(() => {
    if (!queryLocation) return;
    setSelectedLocation(queryLocation);
    setCurrentPage(1);
    applyFilters(searchTerm, selectedCategory, queryLocation);
  }, [queryLocation, applyFilters, searchTerm, selectedCategory]);

  // Warm the add-product route bundle to make navigation faster.
  useEffect(() => {
    router.prefetch("/products/new");
  }, [router]);

  // Force refresh after add/edit flow redirects back to this page
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("products:refresh") !== "1") return;

    sessionStorage.removeItem("products:refresh");
    (async () => {
      try {
        setIsApplyingChanges(true);
        await clearCache("products_cache");
        await refreshProducts();
        mutate("/api/products");
        await loadCategories();
      } finally {
        setIsApplyingChanges(false);
      }
    })();
  }, [refreshProducts, loadCategories]);

  // Debounced search over the cached allProducts (safe - products array guarded)
  const debouncedFilter = useCallback(
    debounce((term) => {
      applyFilters(term, selectedCategory, selectedLocation);
    }, 250),
    [applyFilters, selectedCategory, selectedLocation]
  );

  const handleSearchChange = (e) => {
    const v = e.target.value;
    setSearchTerm(v);
    setCurrentPage(1);
    debouncedFilter(v);
  };

  const handleCategoryFilterChange = (e) => {
    const value = e.target.value;
    setSelectedCategory(value);
    setCurrentPage(1);
    applyFilters(searchTerm, value, selectedLocation);
  };

  const handleLocationFilterChange = (e) => {
    const value = e.target.value;
    setSelectedLocation(value);
    setCurrentPage(1);
    applyFilters(searchTerm, selectedCategory, value);
  };

  // Inline edit handlers
  const handleEditClick = (index, product) => {
    setEditIndex(index);
    setEditableProduct({ ...product, taxRate: normalizeTaxRate(product.taxRate) });
    setPropertiesText(formatPropertiesForInput(product.properties || []));
    // set highlight now so when user leaves/returns it remains
    setHighlightedId(product._id);
  };

  const handleCancelClick = () => {
    setEditIndex(null);
    setEditableProduct({});
    setPropertiesText("");
    // keep highlight (helpful)  comment out to clear highlight on cancel
    // setHighlightedId(null);
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setEditableProduct((prev) => {
      const newValue = type === "checkbox" ? checked : value;
      const updated = { ...prev, [name]: newValue };
      const tax = normalizeTaxRate(updated.taxRate);

      if (name === "margin") {
        updated.salePriceIncTax = calculateSalePriceIncTax(updated.costPrice, updated.margin, tax).toFixed(2);
      }
      if (["costPrice", "taxRate", "salePriceIncTax"].includes(name)) {
        updated.margin = calculateMarginPercent(updated.costPrice, updated.salePriceIncTax, tax).toFixed(2);
      }
      return updated;
    });
  };

  const handleUpdateClick = async (_id) => {
    try {
      setSavingProductId(_id);
      // Stock and pack links aren't edited inline; never send the (possibly cached) values back
      const { quantity, isChildProduct, parentProduct, unitsPerChild, ...editableFields } = editableProduct;
      const updatedProduct = {
        ...editableFields,
        properties: parsePropertiesInput(propertiesText),
      };
      const response = await axios.put("/api/products", { ...updatedProduct, _id });
      const saved = response?.data?.data || { ...updatedProduct, _id };

      // update local cached arrays immediately (optimistic update)
      setFilteredProducts((prev) =>
        prev.map((p) => (p._id === _id ? { ...p, ...saved } : p))
      );
      setAllProducts((prev) => prev.map((p) => (p._id === _id ? { ...p, ...saved } : p)));

      // Invalidate IndexedDB cache so next load fetches fresh data
      await clearCache("products_cache");

      // close edit mode & highlight the updated product
      setEditIndex(null);
      setHighlightedId(_id);
      const indexInFiltered = (filteredProducts || []).findIndex((p) => p._id === _id);
      if (indexInFiltered >= 0) {
        setCurrentPage(Math.floor(indexInFiltered / entriesPerPage) + 1);
      }
    } catch (err) {
      console.error("Failed to update product", err);
      await showAlertDialog({
        title: "Update failed",
        message: "Failed to update product.",
        tone: "danger",
      });
    } finally {
      setSavingProductId(null);
    }
  };

  const handleDeleteClick = async (_id) => {
    const shouldArchive = await showConfirmDialog({
      title: "Archive product?",
      message: "The product will move to the archived list.",
      tone: "warning",
      confirmLabel: "Archive product",
      cancelLabel: "Keep product",
    });
    if (!shouldArchive) return;
    try {
      await axios.delete(`/api/products?id=${_id}`);
      setFilteredProducts((prev) => prev.filter((p) => p._id !== _id));
      setAllProducts((prev) => prev.filter((p) => p._id !== _id));
      
      // Invalidate cache and refresh
      await clearCache("products_cache");
      await refreshProducts();
      
      mutate("/api/products");
      await loadCategories();
      if (highlightedId === _id) setHighlightedId(null);
      await showAlertDialog({
        title: "Product archived",
        message: "The product was moved to the archived list.",
        tone: "success",
      });
    } catch (err) {
      console.error("delete failed", err);
      await showAlertDialog({
        title: "Archive failed",
        message: "The product could not be archived.",
        tone: "danger",
      });
    }
  };

  const formatCurrency = (num) => formatCurrencyValue(num || 0);

  // Sorting runs over the whole filtered set before paging, so clicking a
  // column header reorders every product rather than just the current page.
  const { sorted: sortedProducts, sortKey, sortDir, toggleSort } = useTableSort(
    Array.isArray(filteredProducts) ? filteredProducts : [],
    null,
    "asc",
    {
      category: (p) => p.category?.name || p.categoryName || "",
      margin: (p) => Number(p.margin) || 0,
      locations: (p) => (Array.isArray(p.locations) ? p.locations.length : 0),
    }
  );

  const totalFilteredProducts = sortedProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredProducts / entriesPerPage));
  const safeCurrentPage = clampPage(currentPage, totalPages);
  const pageStartIndex = totalFilteredProducts === 0 ? 0 : (safeCurrentPage - 1) * entriesPerPage;
  const pageEndIndex = Math.min(totalFilteredProducts, pageStartIndex + entriesPerPage);
  const visibleProducts = sortedProducts.slice(pageStartIndex, pageEndIndex);

  const exportColumns = [
    { key: "name", label: "Product", width: 2.6 },
    { key: "barcode", label: "Barcode", width: 1.3 },
    { key: "category", label: "Category", width: 1.4, value: (p) => p.category?.name || p.categoryName || "" },
    { key: "costPrice", label: "Cost", type: "currency", align: "right" },
    { key: "salePriceIncTax", label: "Sale", type: "currency", align: "right" },
    { key: "margin", label: "Margin", type: "percent", align: "right" },
    { key: "quantity", label: "Qty", type: "number", align: "right" },
    { key: "minStock", label: "Min Stock", type: "number", align: "right" },
  ];
  const paginationPages = getPaginationPages(safeCurrentPage, totalPages);

  const goToPage = useCallback((pageNumber) => {
    setCurrentPage(clampPage(pageNumber, totalPages));
    setExpandedRow(null);
  }, [totalPages]);

  const handleEntriesPerPageChange = (e) => {
    const nextEntriesPerPage = Number.parseInt(e.target.value, 10) || entriesPerPageDefault;
    const firstVisibleItem = pageStartIndex + 1;
    const nextPage = Math.max(1, Math.ceil(firstVisibleItem / nextEntriesPerPage));

    setEntriesPerPage(nextEntriesPerPage);
    setCurrentPage(nextPage);
    setExpandedRow(null);
  };

  const rememberListPosition = useCallback(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem("products:currentPage", String(safeCurrentPage));
    sessionStorage.setItem("products:scrollY", String(window.scrollY || 0));
  }, [safeCurrentPage]);

  useEffect(() => {
    if (typeof window === "undefined" || isInitializing || isApplyingChanges) return;

    const storedScrollY = sessionStorage.getItem("products:scrollY");
    if (!storedScrollY) return;

    sessionStorage.removeItem("products:scrollY");
    const scrollY = Number.parseInt(storedScrollY, 10);
    if (!Number.isFinite(scrollY) || scrollY < 0) return;

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: "auto" });
    });
  }, [isApplyingChanges, isInitializing, visibleProducts.length]);

  const paginationButtonClass =
    "min-w-[2.5rem] rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
  const activePaginationButtonClass =
    "min-w-[2.5rem] rounded-md border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-semibold text-white";

  const renderPageButton = (pageNumber) => {
    const isActive = pageNumber === safeCurrentPage;

    return (
      <button
        key={pageNumber}
        type="button"
        onClick={() => goToPage(pageNumber)}
        aria-current={isActive ? "page" : undefined}
        className={isActive ? activePaginationButtonClass : paginationButtonClass}
      >
        {pageNumber}
      </button>
    );
  };

  if (productsError) {
    return (
      <Layout>
        <div className="p-6">
          <h2 className="text-xl text-red-600">Failed to load products</h2>
          <p className="text-sm text-gray-600">{String(productsError)}</p>
          <button 
            onClick={() => refreshProducts()}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </Layout>
    );
  }

  // Show initial loading state
  if (isInitializing || isApplyingChanges) {
    return (
      <Layout>
        <div className="p-6 text-center">
          <Loader size="md" text={isApplyingChanges ? "Applying latest changes..." : "Loading products..."} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
        {/* Header */}
        <div className="page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h1 className="page-title">Products</h1>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={async () => {
                try {
                  setIsRefreshingList(true);
                  await refreshProducts();
                  await loadCategories();
                } finally {
                  setIsRefreshingList(false);
                }
              }}
              className="btn-action-secondary flex items-center gap-2"
              title="Refresh products from server"
              disabled={isRefreshingList}
            >
               {isRefreshingList ? "Refreshing..." : "Refresh"}
            </button>
            <ExportMenu
              title="Product List"
              subtitle={selectedCategory && selectedCategory !== "all" ? "Category: " + selectedCategory : "All categories"}
              columns={exportColumns}
              rows={sortedProducts}
              summary={[{ label: "Products", value: String(sortedProducts.length) }]}
              orientation="l"
            />
            <button
              type="button"
              onClick={() => {
                setIsOpeningAddProduct(true);
                router.push("/products/new");
              }}
              disabled={isOpeningAddProduct}
              className="btn-action-primary w-full sm:w-auto text-center disabled:opacity-60"
            >
              {isOpeningAddProduct ? "Opening..." : "+ Add Product"}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="search-input-wrapper max-w-lg flex-1">
              <Search className="search-input-icon" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search products..."
                className="search-input"
                value={searchTerm}
                onChange={handleSearchChange}
              />
            </div>
            <select
              className="form-select max-w-xs"
              value={selectedCategory}
              onChange={handleCategoryFilterChange}
            >
              <option value="all">All Categories</option>
              {categoryOptions.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
            <select
              className="form-select max-w-xs"
              value={selectedLocation}
              onChange={handleLocationFilterChange}
            >
              <option value="all">All Locations</option>
              <option value="unassigned">Unassigned</option>
              {locationOptions.map((locationValue) => (
                <option key={locationValue} value={locationValue}>
                  {locationValue}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table - Responsive wrapper */}
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th className="!px-3 whitespace-nowrap">Actions</th>
                <SortableTh sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort}>Name</SortableTh>
                <th className="hidden sm:table-cell whitespace-nowrap">Description</th>
                <SortableTh sortKey="costPrice" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right">Cost</SortableTh>
                <SortableTh sortKey="taxRate" activeKey={sortKey} dir={sortDir} onSort={toggleSort}>VAT</SortableTh>
                <SortableTh sortKey="salePriceIncTax" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right">Sale</SortableTh>
                <SortableTh sortKey="margin" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="hidden sm:table-cell">Margin</SortableTh>
                <SortableTh sortKey="barcode" activeKey={sortKey} dir={sortDir} onSort={toggleSort} className="hidden lg:table-cell">Barcode</SortableTh>
                <SortableTh sortKey="minStock" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right">Min Stock</SortableTh>
                <th className="hidden lg:table-cell whitespace-nowrap">Properties</th>
                <SortableTh sortKey="category" activeKey={sortKey} dir={sortDir} onSort={toggleSort}>Category</SortableTh>
                <SortableTh sortKey="locations" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" className="hidden xl:table-cell">Locations</SortableTh>
                <th className="hidden sm:table-cell whitespace-nowrap">Promo</th>
                <th className="!px-3">
                  <span className="sr-only">Archive</span>
                </th>
              </tr>
            </thead>

            <tbody className="bg-white divide-y divide-gray-100">
              {productsLoading ? (
                <tr>
                  <td colSpan={14} className="p-8 text-center">
                    <Loader size="sm" text="Loading product list..." />
                  </td>
                </tr>
              ) : visibleProducts.length === 0 ? (
                <tr>
                  <td colSpan={14} className="p-6 text-center text-gray-500 italic">
                    No products found.
                  </td>
                </tr>
              ) : (
                visibleProducts.map((p, idx) => {
                  // calculate the real index inside filteredProducts (useful for editIndex)
                  const realIndex = pageStartIndex + idx;
                  const isHighlighted = highlightedId && highlightedId === p._id;
                  const isEditing = editIndex === realIndex;
                  const aiPrice = aiPriceMap[String(p._id)];
                  const marginValue = Number(p.margin);
                  const hasVat = normalizeTaxRate(p.taxRate) > 0;
                  const propertiesLabel = p.properties?.length > 0
                    ? p.properties.map((pr) => `${pr.propName}: ${pr.propValue}`).join(", ")
                    : "";
                  return (
                    <tr
                      key={p._id}
                      className={`transition cursor-pointer ${expandedRow === realIndex ? "bg-gray-50" : ""} ${
                        isHighlighted ? "ring-2 ring-blue-200 bg-gray-50" : ""
                      }`}
                      onClick={() => setExpandedRow(expandedRow === realIndex ? null : realIndex)}
                    >
                      <td className="!px-3">
                        {isEditing ? (
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUpdateClick(p._id);
                              }}
                              className="w-16 py-1 bg-green-600 text-white rounded text-xs"
                              disabled={savingProductId === p._id}
                            >
                              {savingProductId === p._id ? "Saving..." : "Save"}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCancelClick();
                              }}
                              className="w-16 py-1 bg-gray-300 text-gray-700 rounded text-xs"
                              disabled={savingProductId === p._id}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditClick(realIndex, p);
                              }}
                              title="Quick edit in the table"
                              className="rounded border border-blue-600 px-2 py-1 text-xs font-semibold uppercase text-blue-700 transition hover:bg-blue-600 hover:text-white"
                            >
                              Edit
                            </button>
                            <Link
                              href={`/products/edit/${p._id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                rememberListPosition();
                                // persist highlight so when returning the row is still highlighted
                                sessionStorage.setItem("products:highlight", p._id);
                              }}
                              title="Open the full product page"
                              className="rounded border border-gray-300 px-2 py-1 text-xs font-semibold uppercase text-gray-700 transition hover:bg-gray-100"
                            >
                              Advanced
                            </Link>
                          </div>
                        )}
                      </td>

                      <td className="min-w-[10rem]">
                        {isEditing ? (
                          <input
                            name="name"
                            value={editableProduct.name || ""}
                            onChange={handleChange}
                            onClick={(e) => e.stopPropagation()}
                            className="w-32 md:w-36 border p-1 rounded text-xs"
                          />
                        ) : (
                          <div className="max-w-[16rem]">
                            <TruncatedText text={p.name} lines={2} className="font-semibold text-gray-900" />
                            {(p.packType === "pack" || (p.isChildProduct && p.packType !== "pack")) && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {p.packType === "pack" && <Badge tone="purple">Pack of {p.qtyPerPack}</Badge>}
                                {p.isChildProduct && p.packType !== "pack" && (
                                  <Badge tone="blue">
                                    {getUnitsPerChild(p) > 1 ? `${getUnitsPerChild(p)} units` : "1 unit"} from pack
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="hidden sm:table-cell">
                        {isEditing ? (
                          <textarea
                            name="description"
                            value={editableProduct.description || ""}
                            onChange={handleChange}
                            onClick={(e) => e.stopPropagation()}
                            rows={3}
                            className="w-full min-w-[180px] border p-1 rounded text-xs resize-none"
                          />
                        ) : (
                          <TruncatedText text={p.description} className="max-w-[14rem] text-gray-600" />
                        )}
                      </td>

                      <td className="!text-right whitespace-nowrap tabular-nums">
                        {isEditing ? (
                          <input
                            name="costPrice"
                            value={editableProduct.costPrice || ""}
                            onChange={handleChange}
                            onClick={(e) => e.stopPropagation()}
                            onWheel={(e) => e.currentTarget.blur()}
                            type="number"
                            className="w-16 md:w-20 border p-1 rounded text-xs"
                          />
                        ) : (
                          formatCurrency(p.costPrice)
                        )}
                      </td>

                      <td className="whitespace-nowrap">
                        {isEditing ? (
                          <select
                            name="taxRate"
                            value={String(normalizeTaxRate(editableProduct.taxRate))}
                            onChange={handleChange}
                            onClick={(e) => e.stopPropagation()}
                            className="w-16 md:w-20 border p-1 rounded text-xs"
                          >
                            <option value={String(VAT_RATE)}>{VAT_RATE}%</option>
                            <option value="0">None</option>
                          </select>
                        ) : (
                          <Badge tone={hasVat ? "blue" : "gray"}>{hasVat ? `${VAT_RATE}%` : "None"}</Badge>
                        )}
                      </td>

                      <td className="!text-right whitespace-nowrap tabular-nums font-semibold !text-gray-900">
                        {isEditing ? (
                          <div className="flex flex-col items-end">
                            <input
                              name="salePriceIncTax"
                              value={editableProduct.salePriceIncTax || ""}
                              onChange={handleChange}
                              onClick={(e) => e.stopPropagation()}
                              onWheel={(e) => e.currentTarget.blur()}
                              type="number"
                              className="w-16 md:w-20 border p-1 rounded text-xs"
                            />
                            {aiPrice && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleChange({ target: { name: "salePriceIncTax", value: String(aiPrice.recommendedPrice) } }); }}
                                className="block text-[9px] text-purple-600 hover:text-purple-800 mt-0.5"
                                title={`AI suggests ${formatCurrency(aiPrice.recommendedPrice)} — ${aiPrice.reason || ""}`}
                              >
                                Apply AI: {formatCurrency(aiPrice.recommendedPrice)}
                              </button>
                            )}
                          </div>
                        ) : (
                          <div>
                            {formatCurrency(p.salePriceIncTax)}
                            {aiPrice && Math.abs(Number(aiPrice.recommendedPrice) - Number(p.salePriceIncTax)) > 1 && (
                              <span className="block text-[10px] text-purple-500 font-normal" title={aiPrice.reason || "AI recommendation"}>
                                AI: {formatCurrency(aiPrice.recommendedPrice)}
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="hidden sm:table-cell !text-right whitespace-nowrap tabular-nums">
                        {isEditing ? (
                          <input
                            name="margin"
                            value={editableProduct.margin || ""}
                            onChange={handleChange}
                            onClick={(e) => e.stopPropagation()}
                            onWheel={(e) => e.currentTarget.blur()}
                            type="number"
                            className="w-14 md:w-16 border p-1 rounded text-xs"
                          />
                        ) : Number.isFinite(marginValue) && p.margin !== null && p.margin !== "" ? (
                          <span className={marginValue < 0 ? "font-medium text-red-600" : ""}>
                            {marginValue.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>

                      <td className="hidden lg:table-cell">
                        {isEditing ? (
                          <input
                            name="barcode"
                            value={editableProduct.barcode || ""}
                            onChange={handleChange}
                            onClick={(e) => e.stopPropagation()}
                            className="w-28 border p-1 rounded text-xs"
                          />
                        ) : (
                          <TruncatedText text={p.barcode} className="max-w-[9rem] font-mono text-xs" />
                        )}
                      </td>

                      <td className="!text-right whitespace-nowrap tabular-nums">
                        {isEditing ? (
                          <input
                            name="minStock"
                            value={editableProduct.minStock ?? ""}
                            onChange={handleChange}
                            onClick={(e) => e.stopPropagation()}
                            onWheel={(e) => e.currentTarget.blur()}
                            type="number"
                            className="w-16 md:w-20 border p-1 rounded text-xs"
                          />
                        ) : (
                          p.minStock ?? <span className="text-gray-400">—</span>
                        )}
                      </td>

                      <td className="hidden lg:table-cell !text-gray-600">
                        {isEditing ? (
                          <textarea
                            value={propertiesText}
                            onChange={(e) => setPropertiesText(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            rows={3}
                            placeholder="Size: Large\nColor: Red"
                            className="w-full min-w-[180px] border p-1 rounded text-xs resize-none"
                          />
                        ) : (
                          <TruncatedText text={propertiesLabel} className="max-w-[12rem] text-xs" />
                        )}
                      </td>

                      <td>
                        {isEditing ? (
                          <select
                            name="category"
                            value={editableProduct.category || ""}
                            onChange={handleChange}
                            onClick={(e) => e.stopPropagation()}
                            className="w-32 border p-1 rounded text-xs"
                          >
                            <option value="">Select category</option>
                            {allCategoryOptions.map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.label}
                              </option>
                            ))}
                            {!allCategoryOptions.some((category) => category.id === editableProduct.category) && (
                              <option value={editableProduct.category || "Top Level"}>
                                {editableProduct.category || "Top Level"}
                              </option>
                            )}
                          </select>
                        ) : (
                          <TruncatedText text={categoryMap[p.category] || p.category} className="max-w-[10rem]" />
                        )}
                      </td>

                      <td className="hidden xl:table-cell !text-gray-600">
                        <TruncatedText
                          text={Array.isArray(p.locations) ? p.locations.join(", ") : ""}
                          empty="Unassigned"
                          className="max-w-[10rem] text-xs"
                        />
                      </td>

                      <td className="hidden sm:table-cell">
                        {p.isPromotion ? <Badge tone="green">On</Badge> : <Badge tone="gray">Off</Badge>}
                      </td>

                      <td className="!px-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(p._id);
                          }}
                          title="Archive product"
                          aria-label={`Archive ${p.name}`}
                          className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-600 hover:text-white"
                        >
                          X
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        <div className="mt-6 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-2 text-sm text-gray-600 sm:flex-row sm:items-center sm:gap-3">
              <span>
                {totalFilteredProducts > 0
                  ? `Showing ${pageStartIndex + 1}-${pageEndIndex} of ${totalFilteredProducts}`
                  : "No products to show"}
              </span>
              <label className="flex items-center gap-2">
                <span className="text-gray-500">Rows</span>
                <select
                  className="form-select !w-auto !py-1.5 text-sm"
                  value={entriesPerPage}
                  onChange={handleEntriesPerPageChange}
                >
                  {entriesPerPageOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {totalFilteredProducts > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => goToPage(1)}
                  disabled={safeCurrentPage <= 1}
                  className={paginationButtonClass}
                >
                  First
                </button>
                <button
                  type="button"
                  onClick={() => goToPage(safeCurrentPage - 1)}
                  disabled={safeCurrentPage <= 1}
                  className={paginationButtonClass}
                >
                  Previous
                </button>

                {paginationPages.map(renderPageButton)}

                <button
                  type="button"
                  onClick={() => goToPage(safeCurrentPage + 1)}
                  disabled={safeCurrentPage >= totalPages}
                  className={paginationButtonClass}
                >
                  Next
                </button>
                <button
                  type="button"
                  onClick={() => goToPage(totalPages)}
                  disabled={safeCurrentPage >= totalPages}
                  className={paginationButtonClass}
                >
                  Last
                </button>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    </Layout>
  );
}

// Long values are cut off with "…"; hovering shows the full text
function TruncatedText({ text, lines = 1, className = "", empty = "—" }) {
  const value = String(text ?? "").trim();
  if (!value) return <span className="text-gray-400">{empty}</span>;
  return (
    <span title={value} className={`${lines > 1 ? "line-clamp-2 break-words" : "block truncate"} ${className}`}>
      {value}
    </span>
  );
}

const BADGE_TONES = {
  gray: "bg-gray-100 text-gray-600 ring-gray-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-green-50 text-green-700 ring-green-200",
  purple: "bg-purple-50 text-purple-700 ring-purple-200",
};

function Badge({ tone = "gray", children }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

