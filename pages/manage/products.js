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
import { calculateMarginPercent } from "@/lib/pricing";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { Loader } from "@/components/ui";

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
  const fetchProducts = useCallback(() => fetcher("/api/products"), []);
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
    setEditableProduct({ ...product });
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
      const cost = parseFloat(updated.costPrice || 0);
      const margin = parseFloat(updated.margin || 0);
      const tax = parseFloat(updated.taxRate || 0);
      const sale = parseFloat(updated.salePriceIncTax || 0);

      if (name === "margin") {
        const marginRatio = margin / 100;
        const saleExTax = cost * (1 + marginRatio);
        const saleIncTax = saleExTax * (1 + tax / 100);
        updated.salePriceIncTax = Number.isFinite(saleIncTax) ? saleIncTax.toFixed(2) : "0.00";
      }
      if (["costPrice", "taxRate", "salePriceIncTax"].includes(name)) {
        updated.margin = calculateMarginPercent(cost, sale, tax, true).toFixed(2);
      }
      return updated;
    });
  };

  const handleUpdateClick = async (_id) => {
    try {
      setSavingProductId(_id);
      const updatedProduct = {
        ...editableProduct,
        properties: parsePropertiesInput(propertiesText),
      };
      const response = await axios.put("/api/products", { ...updatedProduct, _id });
      const saved = response?.data?.data || { ...updatedProduct, _id };

      // update local cached arrays immediately (optimistic update)
      setFilteredProducts((prev) =>
        prev.map((p) => (p._id === _id ? { ...p, ...saved } : p))
      );
      setAllProducts((prev) => prev.map((p) => (p._id === _id ? { ...p, ...saved } : p)));

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

  const totalFilteredProducts = Array.isArray(filteredProducts) ? filteredProducts.length : 0;
  const totalPages = Math.max(1, Math.ceil(totalFilteredProducts / entriesPerPage));
  const safeCurrentPage = clampPage(currentPage, totalPages);
  const pageStartIndex = totalFilteredProducts === 0 ? 0 : (safeCurrentPage - 1) * entriesPerPage;
  const pageEndIndex = Math.min(totalFilteredProducts, pageStartIndex + entriesPerPage);
  const visibleProducts = Array.isArray(filteredProducts)
    ? filteredProducts.slice(pageStartIndex, pageEndIndex)
    : [];
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
                <th className="!px-2"></th>
                <th className="!px-2">Adv</th>
                <th>Name</th>
                <th className="hidden sm:table-cell">Description</th>
                <th>Cost</th>
                <th>Tax %</th>
                <th>Sale</th>
                <th className="hidden sm:table-cell">Margin</th>
                <th className="hidden lg:table-cell">Barcode</th>
                <th>Min Stock</th>
                <th className="hidden lg:table-cell">Properties</th>
                <th>Category</th>
                <th className="hidden xl:table-cell">Locations</th>
                <th className="hidden sm:table-cell">Promo</th>
                <th className="!px-2">Del</th>
              </tr>
            </thead>

            <tbody className="bg-white divide-y divide-gray-100">
              {productsLoading ? (
                <tr>
                  <td colSpan={15} className="p-8 text-center">
                    <Loader size="sm" text="Loading product list..." />
                  </td>
                </tr>
              ) : visibleProducts.length === 0 ? (
                <tr>
                  <td colSpan={15} className="p-6 text-center text-gray-500 italic">
                    No products found.
                  </td>
                </tr>
              ) : (
                visibleProducts.map((p, idx) => {
                  // calculate the real index inside filteredProducts (useful for editIndex)
                  const realIndex = pageStartIndex + idx;
                  const isHighlighted = highlightedId && highlightedId === p._id;
                  return (
                    <tr
                      key={p._id}
                      className={`transition cursor-pointer ${expandedRow === realIndex ? "bg-gray-50" : ""} ${
                        isHighlighted ? "ring-2 ring-blue-200 bg-gray-50" : ""
                      }`}
                      onClick={() => setExpandedRow(expandedRow === realIndex ? null : realIndex)}
                    >
                      <td className="p-2">
                        {editIndex === realIndex ? (
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
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditClick(realIndex, p);
                            }}
                            className="py-1 px-2 md:px-3 border border-blue-600 text-blue-700 hover:bg-blue-600 hover:text-white rounded text-xs"
                          >
                            Edit
                          </button>
                        )}
                      </td>

                      <td className="p-2">
                        <Link
                          href={`/products/edit/${p._id}`}
                          onClick={() => {
                            rememberListPosition();
                            // persist highlight so when returning the row is still highlighted
                            sessionStorage.setItem("products:highlight", p._id);
                          }}
                        >
                          <button
                            onClick={(e) => e.stopPropagation()}
                            className="py-1 px-2 md:px-3 border border-gray-300 text-blue-600 hover:bg-blue-600 hover:text-white rounded text-xs transition"
                          >
                            Adv
                          </button>
                        </Link>
                      </td>

                      <td className="p-2 font-semibold text-xs md:text-sm">
                        {editIndex === realIndex ? (
                          <input
                            name="name"
                            value={editableProduct.name || ""}
                            onChange={handleChange}
                            onClick={(e) => e.stopPropagation()}
                            className="w-32 md:w-36 border p-1 rounded text-xs"
                          />
                        ) : (
                          <span>
                            {p.name}
                            {p.isChildProduct && p.packType !== "pack" && (
                              <span className="ml-1 text-[10px] text-blue-500 font-normal">(unit from pack)</span>
                            )}
                            {p.packType === "pack" && (
                              <span className="ml-1 text-[10px] text-purple-500 font-normal">(pack of {p.qtyPerPack})</span>
                            )}
                          </span>
                        )}
                      </td>

                      <td className="p-2 hidden sm:table-cell max-w-[190px] text-xs align-top">
                        {editIndex === realIndex ? (
                          <textarea
                            name="description"
                            value={editableProduct.description || ""}
                            onChange={handleChange}
                            onClick={(e) => e.stopPropagation()}
                            rows={3}
                            className="w-full min-w-[180px] border p-1 rounded text-xs resize-none"
                          />
                        ) : (
                          <div className="truncate">{p.description}</div>
                        )}
                      </td>


                      <td className="p-2 text-xs md:text-sm">
                        {editIndex === realIndex ? (
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

                      <td className="p-2 text-xs md:text-sm">
                        {editIndex === realIndex ? (
                          <select
                            name="taxRate"
                            value={editableProduct.taxRate || ""}
                            onChange={handleChange}
                            onClick={(e) => e.stopPropagation()}
                            className="w-16 md:w-20 border p-1 rounded text-xs"
                          >
                            <option value="4.5">4.5%</option>
                            <option value="7.5">7.5%</option>
                          </select>
                        ) : (
                          p.taxRate
                        )}
                      </td>

                      <td className="p-2 text-gray-900 font-semibold text-xs md:text-sm">
                        {editIndex === realIndex ? (
                          <input
                            name="salePriceIncTax"
                            value={editableProduct.salePriceIncTax || ""}
                            onChange={handleChange}
                            onClick={(e) => e.stopPropagation()}
                            onWheel={(e) => e.currentTarget.blur()}
                            type="number"
                            className="w-16 md:w-20 border p-1 rounded text-xs"
                          />
                        ) : (
                          formatCurrency(p.salePriceIncTax)
                        )}
                      </td>

                      <td className="p-2 hidden sm:table-cell text-xs">
                        {editIndex === realIndex ? (
                          <input
                            name="margin"
                            value={editableProduct.margin || ""}
                            onChange={handleChange}
                            onClick={(e) => e.stopPropagation()}
                            onWheel={(e) => e.currentTarget.blur()}
                            type="number"
                            className="w-14 md:w-16 border p-1 rounded text-xs"
                          />
                        ) : (
                          p.margin
                        )}
                      </td>
                      <td className="p-2 hidden lg:table-cell text-xs">
                        {editIndex === realIndex ? (
                          <input
                            name="barcode"
                            value={editableProduct.barcode || ""}
                            onChange={handleChange}
                            onClick={(e) => e.stopPropagation()}
                            className="w-28 border p-1 rounded text-xs"
                          />
                        ) : (
                          p.barcode
                        )}
                      </td>

                      <td className="p-2 text-xs md:text-sm">
                        {editIndex === realIndex ? (
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
                          p.minStock ?? ""
                        )}
                      </td>

                      <td className="p-2 hidden lg:table-cell text-gray-600 text-xs align-top">
                        {editIndex === realIndex ? (
                          <textarea
                            value={propertiesText}
                            onChange={(e) => setPropertiesText(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            rows={3}
                            placeholder="Size: Large\nColor: Red"
                            className="w-full min-w-[180px] border p-1 rounded text-xs resize-none"
                          />
                        ) : (
                          p.properties?.length > 0
                            ? p.properties.map((pr) => `${pr.propName}: ${pr.propValue}`).join(", ")
                            : ""
                        )}
                      </td>

                      <td className="p-2 text-xs md:text-sm">
                        {editIndex === realIndex ? (
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
                          categoryMap[p.category] || p.category || ""
                        )}
                      </td>

                      <td className="p-2 hidden xl:table-cell text-xs text-gray-600 align-top">
                        {Array.isArray(p.locations) && p.locations.length > 0
                          ? p.locations.join(", ")
                          : "Unassigned"}
                      </td>

                      <td className="p-2 hidden sm:table-cell text-xs">
                        {p.isPromotion ? (
                          <span className="text-green-600 font-semibold">Yes</span>
                        ) : (
                          <span className="text-gray-400">No</span>
                        )}
                      </td>

                      <td className="p-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(p._id);
                          }}
                          className="py-1 px-2 md:px-3 bg-red-50 text-red-700 border border-red-300 hover:bg-red-600 hover:text-white rounded text-xs"
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


