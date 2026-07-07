import { useState, useRef, useEffect, useCallback } from "react";
import { X } from "lucide-react";

function formatPrice(val, currency = "₦") {
  const num = Number(String(val).replace(/[^0-9.]/g, ""));
  if (isNaN(num)) return `${currency}0.00`;
  return `${currency}${num.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildBarcodeValue(product, index) {
  if (product.barcode) return String(product.barcode).trim();
  const prefix = "IBIL";
  const idx = String(index).padStart(3, "0");
  const nameChars = String(product.name || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 5);
  return `${prefix}${idx}${nameChars}`.slice(0, 12);
}

const TAG_SIZES = {
  compact: { width: "58mm", height: "35mm", label: "Compact (58×35mm)" },
  standard: { width: "68mm", height: "42mm", label: "Standard (68×42mm)" },
  wide: { width: "90mm", height: "42mm", label: "Wide (90×42mm)" },
};

// Print column layouts for A4 paper
const PRINT_LAYOUTS = {
  2: { cols: 2, label: "2 columns (Large tags)", tagWidth: 95 },
  3: { cols: 3, label: "3 columns (Standard)", tagWidth: 63 },
  4: { cols: 4, label: "4 columns (Compact)", tagWidth: 47 },
};

export default function PriceTagGenerator({ products: productsProp = [] }) {
  const safeProducts = Array.isArray(productsProp) ? productsProp : [];
  const [products, setProducts] = useState([]);
  const [tagSize, setTagSize] = useState("standard");
  const [currency, setCurrency] = useState("₦");
  const [brandName, setBrandName] = useState("Ibile mart");
  const [source, setSource] = useState("manual"); // manual | excel | database
  const [selectedDbProducts, setSelectedDbProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [printColumns, setPrintColumns] = useState(3);
  const fileInputRef = useRef(null);
  const previewRef = useRef(null);

  // Load from database products prop
  useEffect(() => {
    if (source === "database" && selectedDbProducts.length > 0) {
      const tags = selectedDbProducts.map((p, i) => ({
        name: p.name || p.productName || "",
        price: p.sellingPrice || p.price || 0,
        barcode: p.barcode || "",
        copies: 1,
      }));
      setProducts(tags);
    }
  }, [selectedDbProducts, source]);

  const handleExcelUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".xlsx")) {
      alert("Only .xlsx files are supported");
      return;
    }

    try {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const rows = await readXlsxFile(file);

      if (rows.length < 2) {
        alert("Excel file needs at least a header row and one data row.");
        return;
      }

      const headers = rows[0].map((h) => String(h || "").toLowerCase().trim());
      const nameIdx = headers.findIndex((h) =>
        ["product name", "product", "name", "item", "description"].includes(h)
      );
      const priceIdx = headers.findIndex((h) =>
        ["price", "amount", "selling price", "unit price", "cost"].includes(h)
      );
      const barcodeIdx = headers.findIndex((h) =>
        ["barcode", "bar code", "code", "sku"].includes(h)
      );
      const copiesIdx = headers.findIndex((h) =>
        ["copies", "copy", "qty", "quantity", "labels", "tags"].includes(h)
      );

      if (nameIdx === -1 || priceIdx === -1) {
        alert("Could not detect Product Name and Price columns. Please ensure your Excel has columns named 'Product Name' and 'Price'.");
        return;
      }

      const parsed = [];
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const name = String(row[nameIdx] || "").trim();
        if (!name) continue;

        parsed.push({
          name,
          price: Number(String(row[priceIdx] || "0").replace(/[^0-9.]/g, "")) || 0,
          barcode: barcodeIdx >= 0 ? String(row[barcodeIdx] || "").trim() : "",
          copies: copiesIdx >= 0 ? Number(row[copiesIdx]) || 1 : 1,
        });
      }

      setProducts(parsed);
      setSource("excel");
    } catch (err) {
      console.error("Excel parse error:", err);
      alert("Failed to parse Excel file.");
    }
  }, []);

  const addManualProduct = () => {
    setProducts((prev) => [...prev, { name: "", price: 0, barcode: "", copies: 1 }]);
    setSource("manual");
  };

  const updateProduct = (index, field, value) => {
    setProducts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeProduct = (index) => {
    setProducts((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePrint = () => {
    if (!products.length) return alert("No products to print.");
    handlePrintPreview();
  };

  const toggleDbProduct = useCallback((product) => {
    setSelectedDbProducts((prev) => {
      const exists = prev.find((p) => p._id === product._id);
      if (exists) return prev.filter((p) => p._id !== product._id);
      return [...prev, product];
    });
  }, []);

  const handlePrintPreview = useCallback(() => {
    if (!products.length) {
      alert("No products to print.");
      return;
    }
    setPrintPreviewOpen(true);
  }, [products.length]);

  const handleConfirmPrint = useCallback(() => {
    setPrintPreviewOpen(false);
    setTimeout(() => window.print(), 100);
  }, []);

  const filteredDbProducts = safeProducts.filter(
    (p) =>
      (p.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.barcode || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Generate tags with copies
  const allTags = products.flatMap((p, idx) =>
    Array.from({ length: p.copies || 1 }, () => ({ ...p, idx }))
  );

  const size = TAG_SIZES[tagSize];

  return (
    <div className="space-y-6">
      {/* Controls - hidden during print */}
      <div className="print:hidden space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs font-medium text-gray-600 block">Tag Size</label>
            <select
              value={tagSize}
              onChange={(e) => setTagSize(e.target.value)}
              className="border rounded px-3 py-2 text-sm mt-1"
            >
              {Object.entries(TAG_SIZES).map(([key, s]) => (
                <option key={key} value={key}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block">Currency</label>
            <input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.slice(0, 4))}
              className="border rounded px-3 py-2 text-sm mt-1 w-16"
              maxLength={4}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block">Brand Name</label>
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className="border rounded px-3 py-2 text-sm mt-1 w-40"
            />
          </div>
        </div>

        {/* Source Selection */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={addManualProduct}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
          >
            + Add Product Manually
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="border border-blue-600 text-blue-600 px-4 py-2 rounded text-sm font-medium hover:bg-blue-50"
          >
            Upload Excel (.xlsx)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            onChange={handleExcelUpload}
            className="hidden"
          />
          {safeProducts.length > 0 && (
            <button
              onClick={() => setSource(source === "database" ? "manual" : "database")}
              className={`px-4 py-2 rounded text-sm font-medium border ${
                source === "database"
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "border-emerald-600 text-emerald-600 hover:bg-emerald-50"
              }`}
            >
              Select from Products
            </button>
          )}
          {products.length > 0 && (
            <button
              onClick={handlePrint}
              className="bg-gray-800 text-white px-4 py-2 rounded text-sm font-medium hover:bg-gray-900 ml-auto"
            >
              🖨️ Print Tags
            </button>
          )}
        </div>

        {/* Database Product Picker - Improved Layout with Search Outside */}
        {source === "database" && (
          <div className="border rounded-lg bg-white overflow-hidden">
            {/* Search Bar - Outside scrollable area */}
            <div className="border-b p-4">
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by product name or barcode..."
                className="w-full border rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-2">
                {selectedDbProducts.length > 0 && `${selectedDbProducts.length} selected • `}
                {filteredDbProducts.length} products found
              </p>
            </div>
            
            {/* Product List - Scrollable */}
            <div className="max-h-96 overflow-y-auto">
              {filteredDbProducts.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0 p-2">
                  {filteredDbProducts.slice(0, 100).map((p) => {
                    const selected = selectedDbProducts.find((s) => s._id === p._id);
                    return (
                      <label
                        key={p._id}
                        className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${ 
                          selected 
                            ? "bg-blue-50 border-blue-400 shadow-sm" 
                            : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={!!selected}
                          onChange={() => toggleDbProduct(p)}
                          className="w-4 h-4 rounded cursor-pointer flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-900 truncate">{p.name}</p>
                          {p.barcode && (
                            <p className="text-xs text-gray-500 truncate">SKU: {p.barcode}</p>
                          )}
                          <p className="text-sm font-semibold text-blue-600 mt-1">
                            {currency}{Number(p.sellingPrice || p.price || 0).toLocaleString()}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="p-8 text-center text-gray-500">
                  <p className="text-sm">No products found</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Manual/Excel Product Table */}
        {source !== "database" && products.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Product Name</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Price</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Barcode</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600 w-16">Copies</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5">
                      <input
                        value={p.name}
                        onChange={(e) => updateProduct(i, "name", e.target.value)}
                        className="w-full border rounded px-2 py-1 text-sm"
                        placeholder="Product name"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number"
                        value={p.price}
                        onChange={(e) => updateProduct(i, "price", Number(e.target.value))}
                        className="w-full border rounded px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        value={p.barcode}
                        onChange={(e) => updateProduct(i, "barcode", e.target.value)}
                        className="w-full border rounded px-2 py-1 text-sm"
                        placeholder="Auto-generated if empty"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <input
                        type="number"
                        min="1"
                        value={p.copies}
                        onChange={(e) => updateProduct(i, "copies", Number(e.target.value) || 1)}
                        className="w-full border rounded px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => removeProduct(i)}
                        className="text-red-500 hover:bg-red-50 rounded px-2 py-1"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tag Preview / Print Area - Improved Design */}
      {allTags.length > 0 && (
        <>
          {/* Screen Preview */}
          <div className="print:hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">
                Preview ({allTags.length} tags)
              </h3>
              <button
                onClick={handlePrintPreview}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                🖨️ Review & Print
              </button>
            </div>

            {/* On-screen preview grid */}
            <div className="border rounded-lg p-4 bg-gray-50">
              <div
                className="grid gap-3 inline-grid"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(${size.width}, 1fr))`,
                }}
              >
                {allTags.slice(0, 12).map((tag, i) => (
                  <PriceTag key={i} tag={tag} currency={currency} brandName={brandName} size={size} tagIdx={tag.idx} />
                ))}
              </div>
              {allTags.length > 12 && (
                <p className="text-sm text-gray-600 mt-4 text-center">
                  ... and {allTags.length - 12} more tags
                </p>
              )}
            </div>
          </div>

          {/* Print Preview Modal */}
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

          {/* Hidden print area - optimized for A4 paper */}
          <PrintArea
            tags={allTags}
            currency={currency}
            brandName={brandName}
            columns={printColumns}
          />
        </>
      )}

      {/* Render barcodes with JsBarcode */}
      <BarcodeRenderer dependencies={[allTags, tagSize, printColumns]} />

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
}

// Individual Price Tag Component - Improved Design
function PriceTag({ tag, currency, brandName, size, tagIdx }) {
  const barcodeValue = buildBarcodeValue(tag, tagIdx);
  return (
    <article
      className="border-2 border-gray-200 rounded-lg bg-white flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow print:border print:rounded-none print:shadow-none"
      style={{
        width: size.width,
        height: size.height,
        padding: "5px 6px",
        pageBreakInside: "avoid",
      }}
    >
      {/* Top section - Brand & Title */}
      <div>
        <div className="flex items-center gap-1 mb-1">
          <span className="text-[7px] font-bold text-blue-700 uppercase tracking-wide bg-blue-50 px-1.5 py-0.5 rounded">
            {brandName}
          </span>
        </div>
        <p
          className="text-[9px] text-gray-700 leading-tight font-medium truncate"
          title={tag.name}
        >
          {escapeHtml(tag.name)}
        </p>
      </div>

      {/* Middle section - Price */}
      <div className="text-center my-1">
        <p className="text-xs font-bold text-gray-900 leading-tight">
          {formatPrice(tag.price, currency)}
        </p>
      </div>

      {/* Bottom section - Barcode */}
      <div className="text-center flex flex-col items-center justify-center">
        <svg
          className="tag-barcode w-full"
          style={{ height: "16px", maxHeight: "16px" }}
          data-barcode={barcodeValue}
        />
        <p className="text-[6px] text-gray-500 font-mono mt-0.5">
          {barcodeValue}
        </p>
      </div>
    </article>
  );
}

// Print Preview Modal
function PrintPreviewModal({ tags, currency, brandName, columns, onColumnsChange, onClose, onPrint }) {
  const rows = Math.ceil(tags.length / columns);
  const tagsPerPage = columns * 3; // 3 rows per A4 page for standard layout
  const pages = Math.ceil(tags.length / tagsPerPage);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 print:hidden">
      <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="border-b p-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Print Preview</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 bg-gray-50">
          {/* Column Selector */}
          <div className="mb-6 bg-white p-4 rounded-lg border border-gray-200">
            <p className="text-sm font-semibold text-gray-700 mb-3">Columns per A4 page:</p>
            <div className="flex gap-2">
              {[2, 3, 4].map((col) => (
                <button
                  key={col}
                  onClick={() => onColumnsChange(col)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    columns === col
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`}
                >
                  {PRINT_LAYOUTS[col].label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-600 mt-3">
              📄 Total: <strong>{tags.length} tags</strong> across <strong>{pages} A4 page{pages > 1 ? "s" : ""}</strong>
              ({tagsPerPage} tags per page)
            </p>
          </div>

          {/* Page Preview */}
          <div className="grid gap-6">
            {Array.from({ length: pages }).map((_, pageNum) => {
              const start = pageNum * tagsPerPage;
              const end = Math.min(start + tagsPerPage, tags.length);
              const pageTags = tags.slice(start, end);
              
              return (
                <div
                  key={pageNum}
                  className="bg-white p-6 rounded-lg border-2 border-gray-300 shadow-sm"
                  style={{
                    width: "210mm",
                    height: "297mm",
                    margin: "0 auto",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(${columns}, 1fr)`,
                      gap: "10px",
                      width: "100%",
                    }}
                  >
                    {pageTags.map((tag, i) => (
                      <PriceTag
                        key={`${pageNum}-${i}`}
                        tag={tag}
                        currency={currency}
                        brandName={brandName}
                        size={TAG_SIZES.standard}
                        tagIdx={tag.idx}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t p-4 bg-gray-50 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onPrint}
            className="px-6 py-2 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            🖨️ Print Now
          </button>
        </div>
      </div>
    </div>
  );
}

// Hidden Print Area - Optimized for A4 paper
function PrintArea({ tags, currency, brandName, columns }) {
  const tagsPerPage = columns * 3; // 3 rows per page
  const pages = Math.ceil(tags.length / tagsPerPage);

  return (
    <div className="print-area hidden print:block" style={{ printColorAdjust: "exact" }}>
      {Array.from({ length: pages }).map((_, pageNum) => {
        const start = pageNum * tagsPerPage;
        const end = Math.min(start + tagsPerPage, tags.length);
        const pageTags = tags.slice(start, end);

        return (
          <div
            key={pageNum}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: "0",
              pageBreakAfter: pageNum < pages - 1 ? "always" : "avoid",
              padding: "15mm",
              minHeight: "297mm",
            }}
          >
            {pageTags.map((tag, i) => (
              <PriceTag
                key={`${pageNum}-${i}`}
                tag={tag}
                currency={currency}
                brandName={brandName}
                size={TAG_SIZES.standard}
                tagIdx={tag.idx}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function BarcodeRenderer({ dependencies }) {
  useEffect(() => {
    async function render() {
      try {
        const JsBarcode = (await import("jsbarcode")).default;
        const svgs = document.querySelectorAll(".tag-barcode[data-barcode]");
        svgs.forEach((svg) => {
          const value = svg.getAttribute("data-barcode");
          if (value) {
            try {
              JsBarcode(svg, value, {
                format: "CODE128",
                height: 24,
                displayValue: false,
                margin: 0,
                width: 1.2,
              });
            } catch {
              // Invalid barcode value — skip
            }
          }
        });
      } catch {
        // JsBarcode not available
      }
    }
    render();
  }, dependencies);

  return null;
}
