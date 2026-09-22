import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X } from "lucide-react";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";

function formatPrice(val, currency = "₦") {
  const num = Number(String(val).replace(/[^0-9.]/g, ""));
  if (isNaN(num)) return `${currency}0.00`;
  return `${currency}${num.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildBarcodeValue(product, index) {
  if (product.barcode) {
    // Use only the first barcode if multiple exist (comma or space separated)
    const raw = String(product.barcode).trim();
    const first = raw.split(/[,;\s|]+/)[0].trim();
    if (first) return first;
  }
  const prefix = "IBIL";
  const idx = String(index).padStart(3, "0");
  const nameChars = String(product.name || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 5);
  return `${prefix}${idx}${nameChars}`.slice(0, 12);
}

/** Does this product carry `code` as one of its barcodes? */
function hasBarcode(product, code) {
  const wanted = String(code || "").trim().toLowerCase();
  if (!wanted) return false;
  return String(product?.barcode || "")
    .split(/[,;\s|]+/)
    .some((candidate) => candidate.trim().toLowerCase() === wanted);
}

const TAG_SIZES = {
  compact: { width: "58mm", height: "35mm", label: "Compact (58×35mm)" },
  standard: { width: "68mm", height: "42mm", label: "Standard (68×42mm)" },
  wide: { width: "90mm", height: "42mm", label: "Wide (90×42mm)" },
};

// Print column layouts for A4 paper (A4 = 210mm x 297mm, margins ~15mm each side = 180mm x 267mm usable)
const PRINT_LAYOUTS = {
  2: { cols: 2, label: "2 columns (Large)", rows: 5, tagWidth: "85mm", tagHeight: "50mm" },
  3: { cols: 3, label: "3 columns", rows: 6, tagWidth: "56mm", tagHeight: "42mm" },
  4: { cols: 4, label: "4 columns (Compact)", rows: 7, tagWidth: "42mm", tagHeight: "35mm" },
};

const UNCATEGORISED = "__uncategorised";
/** Product cards drawn in the picker at once. "Add all" still covers every match. */
const PICKER_RENDER_CAP = 240;
/** Tag-list rows drawn at once; more on request. */
const TABLE_PAGE = 100;
/** Adding more than this many products at once asks first. */
const LARGE_ADD = 300;

let tagCounter = 0;
const newTagKey = () => `tag-${(tagCounter += 1)}`;

function toCopies(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 1;
}

/** Turn a product record (or a movement line) into a row on the tag list. */
function toTag(product, copies = 1) {
  return {
    key: newTagKey(),
    productId: product._id ? String(product._id) : null,
    name: product.name || product.productName || "",
    price: product.salePriceIncTax ?? product.sellingPrice ?? product.price ?? 0,
    barcode: product.barcode || "",
    copies: toCopies(copies),
  };
}

/**
 * Categories as the picker offers them. A product's `category` holds a category id;
 * older records may hold a name instead, and some hold nothing ("Top Level").
 * Picking a category also takes in its sub-categories.
 */
function buildCategoryIndex(categories, products) {
  const list = Array.isArray(categories) ? categories : [];
  const byId = new Map(list.map((c) => [String(c._id), c]));
  const byName = new Map(list.map((c) => [String(c.name || "").trim().toLowerCase(), String(c._id)]));

  const parentOf = (id) => {
    const parent = byId.get(id)?.parent;
    return parent ? String(parent._id || parent) : null;
  };

  const pathIds = new Map(); // id -> [id, parentId, grandparentId, ...]
  const pathOf = (id) => {
    if (pathIds.has(id)) return pathIds.get(id);
    const path = [];
    const seen = new Set();
    for (let cur = id; cur && byId.has(cur) && !seen.has(cur); cur = parentOf(cur)) {
      seen.add(cur);
      path.push(cur);
    }
    pathIds.set(id, path);
    return path;
  };

  const labelOf = (id) =>
    pathOf(id)
      .map((cid) => byId.get(cid)?.name || "")
      .reverse()
      .join(" › ");

  const keyOf = (raw) => {
    const value = String(raw || "").trim();
    if (!value || value.toLowerCase() === "top level") return UNCATEGORISED;
    if (byId.has(value)) return value;
    const named = byName.get(value.toLowerCase());
    if (named) return named;
    return `name:${value}`;
  };

  const counts = new Map();
  const bump = (key) => counts.set(key, (counts.get(key) || 0) + 1);
  for (const product of products) {
    const key = keyOf(product.category);
    if (byId.has(key)) pathOf(key).forEach(bump);
    else bump(key);
  }

  const options = [...counts.keys()]
    .filter((key) => key !== UNCATEGORISED)
    .map((key) => ({
      id: key,
      label: key.startsWith("name:") ? key.slice(5) : labelOf(key),
      count: counts.get(key),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (counts.has(UNCATEGORISED)) {
    options.push({ id: UNCATEGORISED, label: "Uncategorised", count: counts.get(UNCATEGORISED) });
  }

  return {
    options,
    keyOf,
    /** The category keys a product answers to: its own and every parent above it. */
    keysFor(raw) {
      const key = keyOf(raw);
      return byId.has(key) ? pathOf(key) : [key];
    },
    labelFor(raw) {
      const key = keyOf(raw);
      if (key === UNCATEGORISED) return "";
      return key.startsWith("name:") ? key.slice(5) : byId.get(key)?.name || "";
    },
  };
}

/** Draw every barcode inside `root` that is not already drawn for its current value. */
async function renderBarcodes(root) {
  if (!root) return;
  let JsBarcode;
  try {
    JsBarcode = (await import("jsbarcode")).default;
  } catch {
    return; // JsBarcode not available
  }
  root.querySelectorAll("svg.tag-barcode[data-barcode]").forEach((svg) => {
    const value = svg.getAttribute("data-barcode");
    if (!value || svg.dataset.drawn === value) return;
    try {
      JsBarcode(svg, value, { format: "CODE128", height: 24, displayValue: false, margin: 0, width: 1.2 });
      svg.dataset.drawn = value;
    } catch {
      // Invalid barcode value — skip
    }
  });
}

/**
 * @param {Array} products      the products this generator can pick from
 * @param {Array} categories    category records ({ _id, name, parent }) for the category filter
 * @param {boolean} catalogLoading  the product list is (re)loading
 * @param {boolean} autoLoad    pre-fill the tag list from `products` instead of
 *                              waiting for a manual selection. Used by the stock
 *                              movement screen, where the tags to print are
 *                              simply the items on that delivery.
 * @param {boolean} copiesFromQuantity  make one tag per unit received, so a
 *                              delivery of 12 prints 12 tags.
 */
export default function PriceTagGenerator({
  products: productsProp,
  categories = [],
  catalogLoading = false,
  autoLoad = false,
  copiesFromQuantity = false,
  defaultBrandName = "Ibile mart",
}) {
  const catalog = useMemo(() => (Array.isArray(productsProp) ? productsProp : []), [productsProp]);

  // One list of tags, whatever they came from: products picked from the catalogue, a
  // whole category, rows typed in by hand or rows from an Excel file. Picking products
  // used to replace this list, wiping out anything added another way.
  const [tags, setTags] = useState([]);
  const [tagSize, setTagSize] = useState("standard");
  const [currency, setCurrency] = useState("₦");
  const [brandName, setBrandName] = useState(defaultBrandName);
  const [pickerOpen, setPickerOpen] = useState(!autoLoad);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [visibleRows, setVisibleRows] = useState(TABLE_PAGE);
  const [bulkCopies, setBulkCopies] = useState("");
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [printColumns, setPrintColumns] = useState(3);
  const [printJob, setPrintJob] = useState(0);
  const autoLoadedRef = useRef(false);
  const fileInputRef = useRef(null);
  const previewRef = useRef(null);

  // Auto-load: every product handed in becomes a tag straight away, with one
  // copy per unit when the caller asks for it. Runs once, so edits the user
  // makes to the tag list afterwards are not wiped out on the next render.
  useEffect(() => {
    if (!autoLoad || autoLoadedRef.current || catalog.length === 0) return;
    autoLoadedRef.current = true;
    setTags(catalog.map((p) => toTag(p, copiesFromQuantity ? p.quantity : 1)));
  }, [autoLoad, copiesFromQuantity, catalog]);

  /* ─── Catalogue, categories and search ───────────────────────── */

  const categoryIndex = useMemo(() => buildCategoryIndex(categories, catalog), [categories, catalog]);

  const indexedCatalog = useMemo(
    () =>
      catalog.map((product) => ({
        product,
        id: String(product._id),
        haystack: `${product.name || ""} ${product.barcode || ""}`.toLowerCase(),
        categoryKeys: categoryIndex.keysFor(product.category),
      })),
    [catalog, categoryIndex]
  );

  const filtered = useMemo(() => {
    const tokens = searchTerm.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return indexedCatalog.filter(
      (entry) =>
        (categoryFilter === "all" || entry.categoryKeys.includes(categoryFilter)) &&
        tokens.every((token) => entry.haystack.includes(token))
    );
  }, [indexedCatalog, categoryFilter, searchTerm]);

  // A category that no longer exists in the loaded catalogue (after switching to
  // "Price Changed", say) falls back to all categories.
  useEffect(() => {
    if (categoryFilter !== "all" && !categoryIndex.options.some((o) => o.id === categoryFilter)) {
      setCategoryFilter("all");
    }
  }, [categoryIndex, categoryFilter]);

  const selectedIds = useMemo(() => new Set(tags.map((t) => t.productId).filter(Boolean)), [tags]);
  const filteredOnList = useMemo(() => filtered.filter((e) => selectedIds.has(e.id)).length, [filtered, selectedIds]);
  const allFilteredOnList = filtered.length > 0 && filteredOnList === filtered.length;

  const categoryLabel =
    categoryFilter === "all" ? "" : categoryIndex.options.find((o) => o.id === categoryFilter)?.label || "";

  /* ─── Tag list edits ─────────────────────────────────────────── */

  const toggleProduct = useCallback((product) => {
    const id = String(product._id);
    setTags((prev) =>
      prev.some((t) => t.productId === id) ? prev.filter((t) => t.productId !== id) : [...prev, toTag(product)]
    );
  }, []);

  const addFiltered = async () => {
    const toAdd = filtered.filter((e) => !selectedIds.has(e.id)).map((e) => e.product);
    if (toAdd.length === 0) return;
    if (toAdd.length > LARGE_ADD) {
      const ok = await showConfirmDialog({
        title: "Add a large batch?",
        message: `This adds ${toAdd.length.toLocaleString()} products to the tag list${
          categoryLabel ? ` from ${categoryLabel}` : ""
        }. Continue?`,
        confirmLabel: "Add them",
      });
      if (!ok) return;
    }
    setTags((prev) => [...prev, ...toAdd.map((p) => toTag(p))]);
  };

  const removeFiltered = () => {
    const ids = new Set(filtered.map((e) => e.id));
    setTags((prev) => prev.filter((t) => !t.productId || !ids.has(t.productId)));
  };

  // A scanner types the code and presses Enter: add that product and clear the box.
  const handleSearchKeyDown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const term = searchTerm.trim();
    if (!term) return;
    const match = indexedCatalog.find((entry) => hasBarcode(entry.product, term)) || (filtered.length === 1 ? filtered[0] : null);
    if (!match) return;
    if (!selectedIds.has(match.id)) setTags((prev) => [...prev, toTag(match.product)]);
    setSearchTerm("");
  };

  const addManualProduct = () => {
    setTags((prev) => [...prev, { key: newTagKey(), productId: null, name: "", price: 0, barcode: "", copies: 1 }]);
    setVisibleRows((n) => Math.max(n, tags.length + 1));
  };

  const updateTag = (key, field, value) => {
    setTags((prev) => prev.map((t) => (t.key === key ? { ...t, [field]: value } : t)));
  };

  const removeTag = (key) => setTags((prev) => prev.filter((t) => t.key !== key));

  const applyBulkCopies = () => {
    const copies = toCopies(bulkCopies);
    setTags((prev) => prev.map((t) => ({ ...t, copies })));
    setBulkCopies("");
  };

  const clearList = async () => {
    if (tags.length === 0) return;
    const ok = await showConfirmDialog({
      title: "Clear the tag list?",
      message: `Remove all ${tags.length.toLocaleString()} products from the tag list?`,
      confirmLabel: "Clear list",
      tone: "danger",
    });
    if (ok) {
      setTags([]);
      setVisibleRows(TABLE_PAGE);
    }
  };

  const handleExcelUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // the same file can be chosen again
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      await showAlertDialog({ title: "Unsupported file", message: "Only .xlsx files are supported.", tone: "warning" });
      return;
    }

    try {
      // read-excel-file v8+: readSheet returns the first sheet's rows (the default export returns all sheets)
      const { readSheet } = await import("read-excel-file/browser");
      const rows = await readSheet(file);

      if (rows.length < 2) {
        await showAlertDialog({ title: "Empty file", message: "The file needs a header row and at least one data row.", tone: "warning" });
        return;
      }

      const headers = rows[0].map((h) => String(h || "").toLowerCase().trim());
      const nameIdx = headers.findIndex((h) => ["product name", "product", "name", "item", "description"].includes(h));
      const priceIdx = headers.findIndex((h) => ["price", "amount", "selling price", "unit price", "cost"].includes(h));
      const barcodeIdx = headers.findIndex((h) => ["barcode", "bar code", "code", "sku"].includes(h));
      const copiesIdx = headers.findIndex((h) => ["copies", "copy", "qty", "quantity", "labels", "tags"].includes(h));

      if (nameIdx === -1 || priceIdx === -1) {
        await showAlertDialog({
          title: "Columns not found",
          message: "Could not find Product Name and Price columns. Name the columns 'Product Name' and 'Price'.",
          tone: "warning",
        });
        return;
      }

      const parsed = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const name = String(row[nameIdx] || "").trim();
        if (!name) continue;
        parsed.push({
          key: newTagKey(),
          productId: null,
          name,
          price: Number(String(row[priceIdx] || "0").replace(/[^0-9.]/g, "")) || 0,
          barcode: barcodeIdx >= 0 ? String(row[barcodeIdx] || "").trim() : "",
          copies: copiesIdx >= 0 ? toCopies(row[copiesIdx]) : 1,
        });
      }

      // Added to the list rather than replacing it, like every other way in.
      setTags((prev) => [...prev, ...parsed]);
      await showAlertDialog({
        title: "File added",
        message: `${parsed.length.toLocaleString()} row${parsed.length === 1 ? "" : "s"} added to the tag list.`,
        tone: "success",
      });
    } catch (err) {
      console.error("Excel parse error:", err);
      await showAlertDialog({ title: "Could not read file", message: "Failed to read the Excel file.", tone: "danger" });
    }
  }, []);

  /* ─── Tags and printing ──────────────────────────────────────── */

  // Generate tags with copies
  const allTags = useMemo(
    () => tags.flatMap((t, idx) => Array.from({ length: toCopies(t.copies) }, () => ({ ...t, idx }))),
    [tags]
  );
  const previewTags = useMemo(() => allTags.slice(0, 16), [allTags]);
  const size = TAG_SIZES[tagSize];

  // Only the tags on screen get barcodes drawn. Drawing every tag's barcode on every
  // change is what made long lists crawl.
  useEffect(() => {
    renderBarcodes(previewRef.current);
  }, [previewTags, tagSize]);

  const openPrintPreview = async () => {
    if (!allTags.length) {
      await showAlertDialog({ title: "Nothing to print", message: "Add products to the tag list first.", tone: "warning" });
      return;
    }
    setPrintPreviewOpen(true);
  };

  // The print sheet is built when printing and taken down afterwards, so thousands
  // of hidden tags are not sitting in the page the rest of the time.
  const handleConfirmPrint = () => {
    setPrintPreviewOpen(false);
    setPrintJob(Date.now());
  };

  useEffect(() => {
    if (!printJob) return undefined;
    const done = () => setPrintJob(0);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, [printJob]);

  return (
    <div className="space-y-6">
      {/* Controls - hidden during print */}
      <div className="print:hidden space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="form-label">Tag Size</label>
            <select value={tagSize} onChange={(e) => setTagSize(e.target.value)} className="form-select !w-auto">
              {Object.entries(TAG_SIZES).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Currency</label>
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.slice(0, 4))}
              className="form-input !w-16"
              maxLength={4}
            />
          </div>
          <div>
            <label className="form-label">Brand Name</label>
            <input value={brandName} onChange={(e) => setBrandName(e.target.value)} className="form-input !w-44" />
          </div>
        </div>

        {/* Sources */}
        <div className="flex gap-2 flex-wrap items-center">
          {(catalog.length > 0 || catalogLoading) && (
            <button
              onClick={() => setPickerOpen((open) => !open)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                pickerOpen ? "theme-toggle-active" : "theme-toggle-neutral"
              }`}
            >
              {pickerOpen ? "Hide Product Picker" : "Select from Products"}
            </button>
          )}
          <button onClick={addManualProduct} className="btn-action btn-action-secondary">
            + Add Product Manually
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="btn-action btn-action-secondary">
            Upload Excel (.xlsx)
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleExcelUpload} className="hidden" />
          {allTags.length > 0 && (
            <button onClick={openPrintPreview} className="btn-action btn-action-primary sm:ml-auto">
              🖨️ Print {allTags.length.toLocaleString()} Tag{allTags.length === 1 ? "" : "s"}
            </button>
          )}
        </div>

        {/* Product picker */}
        {pickerOpen && (
          <div className="border rounded-lg bg-white overflow-hidden theme-border-soft">
            <div className="border-b theme-border-soft p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] gap-3">
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search by name or barcode, or scan and press Enter…"
                  className="form-input"
                  autoFocus={!autoLoad}
                />
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="form-select"
                  disabled={categoryIndex.options.length === 0}
                >
                  <option value="all">All categories ({catalog.length.toLocaleString()})</option>
                  {categoryIndex.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} ({option.count.toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-gray-600 mr-auto">
                  {catalogLoading ? (
                    "Loading products…"
                  ) : (
                    <>
                      <strong>{filtered.length.toLocaleString()}</strong> product{filtered.length === 1 ? "" : "s"}
                      {categoryLabel && <> in <strong>{categoryLabel}</strong></>}
                      {searchTerm.trim() && <> matching “{searchTerm.trim()}”</>}
                      {filteredOnList > 0 && <> · {filteredOnList.toLocaleString()} on the tag list</>}
                    </>
                  )}
                </p>
                {!allFilteredOnList && filtered.length > 0 && (
                  <button onClick={addFiltered} className="btn-action btn-action-primary btn-sm">
                    Add {filtered.length - filteredOnList === filtered.length ? "all " : ""}
                    {(filtered.length - filteredOnList).toLocaleString()}
                    {categoryLabel && !searchTerm.trim() ? ` from ${categoryLabel}` : ""} to list
                  </button>
                )}
                {filteredOnList > 0 && (
                  <button onClick={removeFiltered} className="btn-action btn-action-secondary btn-sm">
                    Remove {filteredOnList.toLocaleString()} from list
                  </button>
                )}
              </div>
            </div>

            <div className="max-h-[28rem] overflow-y-auto">
              {filtered.length > 0 ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 p-2">
                    {filtered.slice(0, PICKER_RENDER_CAP).map(({ product, id }) => {
                      const selected = selectedIds.has(id);
                      const packSize = Number(product.qtyPerPack) || 1;
                      const category = categoryIndex.labelFor(product.category);
                      return (
                        <label
                          key={id}
                          className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                            selected ? "shadow-sm" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                          }`}
                          style={selected ? { borderColor: "var(--accent)", background: "var(--accent-soft-bg)" } : undefined}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleProduct(product)}
                            className="w-4 h-4 rounded cursor-pointer flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-gray-900 truncate" title={product.name}>
                              {product.name}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                              {[product.barcode && `SKU: ${product.barcode}`, category, product.packType === "pack" && packSize > 1 && `Pack of ${packSize}`]
                                .filter(Boolean)
                                .join(" · ") || "No barcode"}
                            </p>
                            <p className="text-sm font-semibold theme-accent-text mt-1">
                              {formatPrice(product.salePriceIncTax ?? product.sellingPrice ?? product.price ?? 0, currency)}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {filtered.length > PICKER_RENDER_CAP && (
                    <p className="text-xs text-gray-500 text-center px-4 pb-4">
                      Showing the first {PICKER_RENDER_CAP} of {filtered.length.toLocaleString()}. Search or pick a category
                      to narrow it down — “Add to list” still adds all {filtered.length.toLocaleString()}.
                    </p>
                  )}
                </>
              ) : (
                <div className="p-8 text-center text-gray-500">
                  <p className="text-sm">{catalogLoading ? "Loading products…" : "No products found"}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tag list */}
        {tags.length > 0 && (
          <div className="border rounded-lg overflow-hidden theme-border-soft">
            <div className="flex flex-wrap items-center gap-3 px-3 py-2.5 border-b theme-border-soft theme-surface-soft">
              <p className="text-sm font-semibold text-gray-800 mr-auto">
                Tag list · {tags.length.toLocaleString()} product{tags.length === 1 ? "" : "s"} ·{" "}
                {allTags.length.toLocaleString()} tag{allTags.length === 1 ? "" : "s"}
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  value={bulkCopies}
                  onChange={(e) => setBulkCopies(e.target.value)}
                  placeholder="Copies"
                  className="form-input !w-24 !py-1.5 text-sm"
                />
                <button onClick={applyBulkCopies} disabled={!bulkCopies} className="btn-action btn-action-secondary btn-sm disabled:opacity-50">
                  Set for all
                </button>
              </div>
              <button onClick={clearList} className="btn-action btn-action-danger btn-sm">
                Clear list
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Product Name</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 w-32">Price</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 w-44">Barcode</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600 w-20">Copies</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {tags.slice(0, visibleRows).map((t) => (
                    <tr key={t.key} className="border-t">
                      <td className="px-3 py-1.5">
                        <input
                          value={t.name}
                          onChange={(e) => updateTag(t.key, "name", e.target.value)}
                          className="w-full border rounded px-2 py-1 text-sm"
                          placeholder="Product name"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          value={t.price}
                          onChange={(e) => updateTag(t.key, "price", Number(e.target.value))}
                          onWheel={(e) => e.currentTarget.blur()}
                          className="w-full border rounded px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          value={t.barcode}
                          onChange={(e) => updateTag(t.key, "barcode", e.target.value)}
                          className="w-full border rounded px-2 py-1 text-sm"
                          placeholder="Auto-generated if empty"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          min="1"
                          value={t.copies}
                          onChange={(e) => updateTag(t.key, "copies", e.target.value === "" ? "" : Number(e.target.value))}
                          onBlur={() => updateTag(t.key, "copies", toCopies(t.copies))}
                          onWheel={(e) => e.currentTarget.blur()}
                          className="w-full border rounded px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <button
                          onClick={() => removeTag(t.key)}
                          className="text-red-500 hover:bg-red-50 rounded px-2 py-1"
                          aria-label={`Remove ${t.name || "row"}`}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tags.length > visibleRows && (
              <div className="flex justify-center gap-3 p-3 border-t theme-border-soft">
                <button onClick={() => setVisibleRows((n) => n + TABLE_PAGE)} className="btn-action btn-action-secondary btn-sm">
                  Show {Math.min(TABLE_PAGE, tags.length - visibleRows)} more
                </button>
                <button onClick={() => setVisibleRows(tags.length)} className="btn-action btn-action-secondary btn-sm">
                  Show all {tags.length.toLocaleString()}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tag Preview */}
      {allTags.length > 0 && (
        <div className="print:hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-800">Preview ({allTags.length.toLocaleString()} tags)</h3>
            <button onClick={openPrintPreview} className="btn-action btn-action-primary">
              🖨️ Review & Print
            </button>
          </div>

          <div ref={previewRef} className="border rounded-lg p-4 bg-gray-50">
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(160px, 1fr))` }}>
              {previewTags.map((tag, i) => (
                <PriceTag key={`${tag.key}-${i}`} tag={tag} currency={currency} brandName={brandName} size={size} tagIdx={tag.idx} />
              ))}
            </div>
            {allTags.length > previewTags.length && (
              <p className="text-sm text-gray-600 mt-4 text-center">
                ... and {(allTags.length - previewTags.length).toLocaleString()} more tags — click Review & Print to see them
              </p>
            )}
          </div>
        </div>
      )}

      {printPreviewOpen && (
        <PrintPreviewModal
          tags={allTags}
          currency={currency}
          brandName={brandName}
          columns={printColumns}
          onColumnsChange={setPrintColumns}
          onClose={() => setPrintPreviewOpen(false)}
          onPrint={handleConfirmPrint}
        />
      )}

      {printJob > 0 && (
        <>
          <div className="print:hidden fixed bottom-4 right-4 z-50 rounded-lg bg-gray-900 text-white text-sm px-4 py-3 shadow-lg">
            Preparing {allTags.length.toLocaleString()} tags for printing…
          </div>
          <PrintArea
            key={printJob}
            tags={allTags}
            currency={currency}
            brandName={brandName}
            columns={printColumns}
            onReady={() => window.print()}
          />
        </>
      )}

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print-area {
            visibility: visible;
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .print-area * {
            visibility: visible;
          }
        }
      `}</style>
    </div>
  );
}

// Individual Price Tag Component
function PriceTag({ tag, currency, brandName, size, tagIdx }) {
  const barcodeValue = buildBarcodeValue(tag, tagIdx);
  return (
    <article
      className="border border-gray-400 bg-white flex flex-col justify-between overflow-hidden print:border print:border-gray-500"
      style={{
        width: "100%",
        minHeight: size.height,
        padding: "4px 6px",
        pageBreakInside: "avoid",
        boxSizing: "border-box",
      }}
    >
      {/* Top section - Brand */}
      <div className="border-b border-dashed border-gray-300 pb-1 mb-1">
        <span className="text-[7px] font-extrabold text-gray-800 uppercase tracking-wider block text-center">
          {brandName}
        </span>
      </div>

      {/* Product Name - wraps. React escapes text itself; escaping it again here
          printed "M&M" as "M&amp;M". */}
      <p
        className="text-[8px] text-gray-700 leading-snug font-medium text-center"
        style={{
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          wordBreak: "break-word",
          minHeight: "1.6em",
        }}
        title={tag.name}
      >
        {tag.name}
      </p>

      {/* Price */}
      <div className="text-center my-1 border-y border-dashed border-gray-300 py-1">
        <p className="text-sm font-extrabold text-gray-900 leading-none">{formatPrice(tag.price, currency)}</p>
      </div>

      {/* Barcode */}
      <div className="text-center flex flex-col items-center justify-end">
        <svg className="tag-barcode" style={{ width: "90%", height: "18px" }} data-barcode={barcodeValue} />
        <p className="text-[7px] text-gray-600 font-mono mt-0.5 leading-none font-semibold">{barcodeValue}</p>
      </div>
    </article>
  );
}

// Print Preview Modal
function PrintPreviewModal({ tags, currency, brandName, columns, onColumnsChange, onClose, onPrint }) {
  const layout = PRINT_LAYOUTS[columns];
  const tagsPerPage = layout.cols * layout.rows;
  const pages = Math.ceil(tags.length / tagsPerPage);
  const pagesRef = useRef(null);

  useEffect(() => {
    renderBarcodes(pagesRef.current);
  }, [tags, columns]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 print:hidden">
      <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="border-b p-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Print Preview</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 bg-gray-50">
          {/* Column Selector */}
          <div className="mb-6 bg-white p-4 rounded-lg border border-gray-200">
            <p className="text-sm font-semibold text-gray-700 mb-3">Tags per row on A4 paper:</p>
            <div className="flex gap-2 flex-wrap">
              {[2, 3, 4].map((col) => (
                <button
                  key={col}
                  onClick={() => onColumnsChange(col)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    columns === col ? "theme-toggle-active" : "theme-toggle-neutral"
                  }`}
                >
                  {PRINT_LAYOUTS[col].label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-3">
              📄 <strong>{tags.length.toLocaleString()} tags</strong> → <strong>{tagsPerPage} per A4 page</strong> ({layout.cols} cols ×{" "}
              {layout.rows} rows) → <strong>{pages} page{pages > 1 ? "s" : ""}</strong>
            </p>
          </div>

          {/* Page Preview */}
          <div ref={pagesRef} className="space-y-6">
            {Array.from({ length: Math.min(pages, 3) }).map((_, pageNum) => {
              const start = pageNum * tagsPerPage;
              const end = Math.min(start + tagsPerPage, tags.length);
              const pageTags = tags.slice(start, end);

              return (
                <div key={pageNum} className="relative">
                  <p className="text-xs text-gray-500 mb-2 font-medium">
                    Page {pageNum + 1} of {pages}
                  </p>
                  <div
                    className="bg-white rounded-lg border-2 border-gray-300 shadow-sm overflow-hidden"
                    style={{ aspectRatio: "210 / 297", maxHeight: "500px", padding: "12px" }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
                        gap: "4px",
                        width: "100%",
                        height: "100%",
                        alignContent: "start",
                      }}
                    >
                      {pageTags.map((tag, i) => {
                        const barcodeValue = buildBarcodeValue(tag, tag.idx);
                        return (
                          <div
                            key={`preview-${pageNum}-${i}`}
                            className="border border-gray-300 bg-white p-1 flex flex-col justify-between"
                            style={{ minHeight: 0 }}
                          >
                            <div className="border-b border-dashed border-gray-200 pb-0.5 mb-0.5">
                              <span className="text-[5px] font-extrabold text-gray-800 uppercase tracking-wider block text-center">
                                {brandName}
                              </span>
                            </div>
                            <p
                              className="text-[6px] text-gray-700 text-center leading-tight"
                              style={{
                                overflow: "hidden",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                wordBreak: "break-word",
                              }}
                            >
                              {tag.name}
                            </p>
                            <p className="text-[8px] font-extrabold text-gray-900 text-center border-y border-dashed border-gray-200 py-0.5 my-0.5">
                              {formatPrice(tag.price, currency)}
                            </p>
                            <div className="text-center">
                              <svg
                                className="tag-barcode"
                                style={{ width: "80%", height: "10px", margin: "0 auto", display: "block" }}
                                data-barcode={barcodeValue}
                              />
                              <p className="text-[5px] text-gray-600 font-mono font-semibold">{barcodeValue}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
            {pages > 3 && (
              <p className="text-sm text-center text-gray-500">
                ... and {pages - 3} more page{pages - 3 > 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t p-4 bg-gray-50 flex gap-3 justify-end">
          <button onClick={onClose} className="btn-action btn-action-secondary">
            Cancel
          </button>
          <button onClick={onPrint} className="btn-action btn-action-primary">
            🖨️ Print Now
          </button>
        </div>
      </div>
    </div>
  );
}

// Print sheet, A4. Mounted for one print: draws its barcodes, then opens the print dialog.
function PrintArea({ tags, currency, brandName, columns, onReady }) {
  const layout = PRINT_LAYOUTS[columns];
  const tagsPerPage = layout.cols * layout.rows;
  const pages = Math.ceil(tags.length / tagsPerPage);
  const areaRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    renderBarcodes(areaRef.current).then(() => {
      if (!cancelled) requestAnimationFrame(() => !cancelled && onReady());
    });
    return () => {
      cancelled = true;
    };
    // Once per mount: a new print job remounts this with a new key.
  }, []);

  return (
    <div ref={areaRef} className="print-area hidden print:block" style={{ printColorAdjust: "exact" }}>
      {Array.from({ length: pages }).map((_, pageNum) => {
        const start = pageNum * tagsPerPage;
        const end = Math.min(start + tagsPerPage, tags.length);
        const pageTags = tags.slice(start, end);

        return (
          <div
            key={pageNum}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
              gap: "4px",
              pageBreakAfter: pageNum < pages - 1 ? "always" : "avoid",
              padding: "10mm 12mm",
              minHeight: "297mm",
              alignContent: "start",
            }}
          >
            {pageTags.map((tag, i) => (
              <PriceTag
                key={`print-${pageNum}-${i}`}
                tag={tag}
                currency={currency}
                brandName={brandName}
                size={{ width: layout.tagWidth, height: layout.tagHeight }}
                tagIdx={tag.idx}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
