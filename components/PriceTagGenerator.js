import { useState, useRef, useEffect, useCallback } from "react";

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

export default function PriceTagGenerator({ products: productsProp = [] }) {
  const [products, setProducts] = useState([]);
  const [tagSize, setTagSize] = useState("standard");
  const [currency, setCurrency] = useState("₦");
  const [brandName, setBrandName] = useState("Ibile mart");
  const [source, setSource] = useState("manual"); // manual | excel | database
  const [selectedDbProducts, setSelectedDbProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
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
    window.print();
  };

  const toggleDbProduct = (product) => {
    setSelectedDbProducts((prev) => {
      const exists = prev.find((p) => p._id === product._id);
      if (exists) return prev.filter((p) => p._id !== product._id);
      return [...prev, product];
    });
  };

  const filteredDbProducts = productsProp.filter(
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
          {productsProp.length > 0 && (
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

        {/* Database Product Picker */}
        {source === "database" && (
          <div className="border rounded-lg p-4 bg-gray-50 max-h-60 overflow-y-auto">
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search products..."
              className="w-full border rounded px-3 py-2 text-sm mb-3"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredDbProducts.slice(0, 50).map((p) => {
                const selected = selectedDbProducts.find((s) => s._id === p._id);
                return (
                  <label
                    key={p._id}
                    className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-sm ${
                      selected ? "bg-blue-50 border-blue-300" : "hover:bg-gray-100"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!!selected}
                      onChange={() => toggleDbProduct(p)}
                      className="rounded"
                    />
                    <span className="truncate">{p.name}</span>
                    <span className="ml-auto text-xs text-gray-500">
                      {currency}{Number(p.sellingPrice || p.price || 0).toLocaleString()}
                    </span>
                  </label>
                );
              })}
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

      {/* Tag Preview / Print Area */}
      {allTags.length > 0 && (
        <div
          ref={previewRef}
          className="print:m-0 print:p-0"
          style={{ printColorAdjust: "exact" }}
        >
          <h3 className="text-sm font-semibold text-gray-500 mb-3 print:hidden">
            Preview ({allTags.length} tags)
          </h3>
          <div
            className="grid gap-2 print:gap-0"
            style={{
              gridTemplateColumns: `repeat(auto-fill, ${size.width})`,
            }}
          >
            {allTags.map((tag, i) => {
              const barcodeValue = buildBarcodeValue(tag, tag.idx);
              return (
                <article
                  key={i}
                  className="border border-gray-300 rounded bg-white flex flex-col justify-between overflow-hidden print:border print:rounded-none"
                  style={{
                    width: size.width,
                    height: size.height,
                    padding: "4px 6px",
                    pageBreakInside: "avoid",
                  }}
                >
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="text-[8px] font-bold text-gray-700 uppercase tracking-wide">
                        {brandName}
                      </span>
                    </div>
                    <p
                      className="text-[9px] text-gray-600 leading-tight truncate"
                      title={tag.name}
                    >
                      {escapeHtml(tag.name)}
                    </p>
                    <p className="text-sm font-bold text-gray-900 mt-0.5">
                      {formatPrice(tag.price, currency)}
                    </p>
                  </div>
                  <div className="text-center">
                    <svg
                      className="tag-barcode w-full h-6"
                      data-barcode={barcodeValue}
                    />
                    <p className="text-[7px] text-gray-500 font-mono">
                      {barcodeValue}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* Render barcodes with JsBarcode */}
      <BarcodeRenderer dependencies={[allTags, tagSize]} />

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:hidden {
            display: none !important;
          }
          [class*="print:m-0"] ,
          [class*="print:m-0"] * {
            visibility: visible;
          }
          [class*="print:m-0"] {
            position: absolute;
            left: 0;
            top: 0;
          }
        }
      `}</style>
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
