import Layout from "@/components/Layout";
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader } from "@/components/ui";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";
import { getCachedCategories } from "@/lib/categoriesCache";
import { clearCache } from "@/lib/useIndexedDBCache";
import { useAuth } from "@/lib/useAuth";
import { useTableSort, SortableTh } from "@/components/SortableTable";

const UNCATEGORISED = "__uncategorised";

export default function Archived() {
  const [archivedProducts, setArchivedProducts] = useState([]);
  const [categoryMap, setCategoryMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [restoringId, setRestoringId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const { isAdmin } = useAuth();

  async function loadArchived() {
    try {
      setLoading(true);
      const res = await axios.get("/api/products?archived=true");
      const rows = Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.data?.data)
          ? res.data.data
          : [];
      setArchivedProducts(rows);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadArchived();
    getCachedCategories()
      .then((categories) => {
        const map = {};
        (Array.isArray(categories) ? categories : []).forEach((category) => {
          map[String(category._id)] = category.name;
        });
        setCategoryMap(map);
      })
      .catch(() => setCategoryMap({}));
  }, []);

  const categoryLabel = (product) =>
    categoryMap[String(product.category)] || (product.category && product.category !== "Top Level" ? product.category : "");

  /* ─── Filters ─────────────────────────────────────────────────── */

  const categoryOptions = useMemo(() => {
    const counts = new Map();
    for (const product of archivedProducts) {
      const label = categoryLabel(product) || UNCATEGORISED;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ value: label, label: label === UNCATEGORISED ? "Uncategorised" : label, count }))
      .sort((a, b) => (a.value === UNCATEGORISED ? 1 : b.value === UNCATEGORISED ? -1 : a.label.localeCompare(b.label)));
  }, [archivedProducts, categoryMap]);

  const filtered = useMemo(() => {
    const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return archivedProducts.filter((product) => {
      const label = categoryLabel(product) || UNCATEGORISED;
      if (categoryFilter !== "all" && label !== categoryFilter) return false;
      if (tokens.length === 0) return true;
      const haystack = `${product.name || ""} ${product.barcode || ""} ${label === UNCATEGORISED ? "" : label}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [archivedProducts, search, categoryFilter, categoryMap]);

  const { sorted: sortedArchived, sortKey, sortDir, toggleSort } = useTableSort(filtered, "archivedAt", "desc", {
    category: (product) => categoryLabel(product) || "",
  });

  /* ─── Selection ───────────────────────────────────────────────── */

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allShownSelected = filtered.length > 0 && filtered.every((product) => selected.has(product._id));
  const someShownSelected = filtered.some((product) => selected.has(product._id));
  const toggleAllShown = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((product) => (allShownSelected ? next.delete(product._id) : next.add(product._id)));
      return next;
    });

  const selectedProducts = archivedProducts.filter((product) => selected.has(product._id));

  /* ─── Actions ─────────────────────────────────────────────────── */

  const afterChange = async () => {
    // The product lists elsewhere are cached, so they have to be told.
    await Promise.allSettled([clearCache("products_cache"), clearCache("stock_products_cache")]);
    await loadArchived();
  };

  const runBulk = async (action) => {
    if (selectedProducts.length === 0) return;
    const names = selectedProducts.slice(0, 5).map((product) => product.name).join(", ");
    const more = selectedProducts.length > 5 ? ` and ${selectedProducts.length - 5} more` : "";

    const confirmed = await showConfirmDialog({
      title: action === "restore" ? `Restore ${selectedProducts.length} products?` : `Delete ${selectedProducts.length} products for good?`,
      message:
        action === "restore"
          ? `${names}${more} will go back into the catalogue, with their web visibility as it was before archiving.`
          : `${names}${more} will be removed permanently, along with their images. This cannot be undone.`,
      confirmLabel: action === "restore" ? "Restore them" : "Delete permanently",
      tone: action === "restore" ? "info" : "danger",
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      const res = await axios.post("/api/products/bulk", { ids: [...selected], action });
      await afterChange();
      await showAlertDialog({
        title: action === "restore" ? "Products restored" : "Products deleted",
        message: res.data?.message || "Done.",
        tone: "success",
      });
    } catch (error) {
      await showAlertDialog({
        title: action === "restore" ? "Restore failed" : "Delete failed",
        message: error?.response?.data?.error || "Something went wrong.",
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (productId) => {
    try {
      setRestoringId(productId);
      await axios.put("/api/products", { _id: productId, restore: true });
      await afterChange();
    } catch (error) {
      console.error("Restore failed", error);
      await showAlertDialog({ title: "Restore failed", message: "Failed to restore product.", tone: "danger" });
    } finally {
      setRestoringId(null);
    }
  };

  const handlePermanentDelete = async (productId) => {
    const shouldDelete = await showConfirmDialog({
      title: "Delete product permanently?",
      message: "This action cannot be undone.",
      tone: "danger",
      confirmLabel: "Delete permanently",
      cancelLabel: "Keep product",
    });
    if (!shouldDelete) return;
    try {
      setDeletingId(productId);
      await axios.delete(`/api/products?id=${productId}&permanent=true`);
      await afterChange();
    } catch (error) {
      console.error("Delete failed", error);
      await showAlertDialog({
        title: "Delete failed",
        message: error?.response?.data?.message || "Failed to delete product.",
        tone: "danger",
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          <div className="page-header">
            <div>
              <h1 className="page-title">Archived Products</h1>
              <p className="page-subtitle">
                Archived products are hidden from the till and the web shop, and keep their history. Restore one to put it back.
              </p>
            </div>
          </div>

          {/* Search and category filter */}
          <div className="content-card mb-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by product name, barcode or category…"
                className="form-input flex-1"
              />
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="form-select sm:max-w-xs"
              >
                <option value="all">All categories ({archivedProducts.length})</option>
                {categoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
              {(search || categoryFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setCategoryFilter("all");
                  }}
                  className="btn-action btn-action-secondary"
                >
                  Clear
                </button>
              )}
            </div>
            <p className="mt-3 text-sm text-gray-500">
              Showing {filtered.length} of {archivedProducts.length} archived products
              {selected.size > 0 ? ` · ${selected.size} selected` : ""}
            </p>
          </div>

          {/* Bulk actions */}
          {selected.size > 0 && (
            <div className="content-card mb-4 flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-gray-700">
                {selected.size} selected
                {selectedProducts.length > 0 && (
                  <span className="text-gray-400">
                    {" "}
                    · {formatCurrency(selectedProducts.reduce((sum, p) => sum + (Number(p.salePriceIncTax) || 0), 0))} of sale value
                  </span>
                )}
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                <button onClick={() => setSelected(new Set())} className="btn-action btn-action-secondary btn-sm">
                  Clear selection
                </button>
                <button onClick={() => runBulk("restore")} disabled={busy} className="btn-action btn-action-success btn-sm disabled:opacity-50">
                  {busy ? "Working…" : `Restore ${selected.size}`}
                </button>
                {isAdmin && (
                  <button onClick={() => runBulk("delete")} disabled={busy} className="btn-action btn-action-danger btn-sm disabled:opacity-50">
                    {busy ? "Working…" : `Delete ${selected.size} permanently`}
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="data-table-container">
            {loading ? (
              <div className="p-8 flex items-center justify-center">
                <Loader size="sm" text="Loading archived products..." />
              </div>
            ) : archivedProducts.length === 0 ? (
              <div className="content-card text-center py-12">
                <p className="text-gray-500">No archived products to display</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="content-card text-center py-12">
                <p className="text-gray-500">No archived products match this search.</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all shown"
                        checked={allShownSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someShownSelected && !allShownSelected;
                        }}
                        onChange={toggleAllShown}
                      />
                    </th>
                    <SortableTh sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort}>Name</SortableTh>
                    <SortableTh sortKey="category" activeKey={sortKey} dir={sortDir} onSort={toggleSort}>Category</SortableTh>
                    <SortableTh sortKey="salePriceIncTax" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right">Sale Price</SortableTh>
                    <SortableTh sortKey="archivedAt" activeKey={sortKey} dir={sortDir} onSort={toggleSort}>Archived On</SortableTh>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedArchived.map((item) => (
                    <tr key={item._id} className={selected.has(item._id) ? "bg-sky-50" : ""}>
                      <td className="p-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.name}`}
                          checked={selected.has(item._id)}
                          onChange={() => toggle(item._id)}
                        />
                      </td>
                      <td className="p-3 text-sm font-medium">
                        {item.name}
                        {item.barcode && <div className="text-xs text-gray-400 font-mono">{item.barcode}</div>}
                      </td>
                      <td className="p-3 text-sm text-gray-600">{categoryLabel(item) || "Uncategorised"}</td>
                      <td className="p-3 text-sm">{formatCurrency(item.salePriceIncTax || 0)}</td>
                      <td className="p-3 text-sm">
                        {item.archivedAt ? new Date(item.archivedAt).toLocaleString() : "-"}
                        {item.archivedReason && <div className="text-xs text-gray-400">{item.archivedReason}</div>}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleRestore(item._id)}
                            className="py-1 px-3 rounded bg-emerald-600 text-white text-xs disabled:opacity-60"
                            disabled={restoringId === item._id || busy}
                          >
                            {restoringId === item._id ? "Restoring..." : "Restore"}
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => handlePermanentDelete(item._id)}
                              className="py-1 px-3 rounded bg-red-600 text-white text-xs disabled:opacity-60"
                              disabled={deletingId === item._id || busy}
                            >
                              {deletingId === item._id ? "Deleting..." : "Delete"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
