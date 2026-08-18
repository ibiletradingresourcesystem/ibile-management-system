"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Layout from "@/components/Layout";
import { getCachedSetup } from "@/lib/setupCache";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileExcel, faDownload, faUpload, faCheck, faExclamationTriangle } from "@fortawesome/free-solid-svg-icons";

const EXPECTED_HEADERS = ["Name", "Description", "Cost", "Sale", "Barcode", "Category"];

function normalizeHeader(h) {
  const lower = String(h || "").toLowerCase().trim();
  if (["name", "product name", "product", "item", "item name"].includes(lower)) return "name";
  if (["description", "desc", "details", "product description"].includes(lower)) return "description";
  if (["cost", "cost price", "costprice", "buying price", "purchase price"].includes(lower)) return "costPrice";
  if (["sale", "sale price", "saleprice", "selling price", "salePriceIncTax", "price", "retail price"].includes(lower)) return "salePriceIncTax";
  if (["barcode", "bar code", "code", "sku", "upc", "ean"].includes(lower)) return "barcode";
  if (["category", "cat", "product category", "group", "department"].includes(lower)) return "category";
  return null;
}

function parseCSVLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      values.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

function fixBarcodeOverflow(row, values, mapped) {
  const barcodeIdx = mapped.indexOf("barcode");
  if (barcodeIdx < 0) return;
  const extraValues = values.slice(mapped.length);
  // If category looks like a barcode (5+ digits), it overflowed from the barcode column
  if (row.category && /^\d{5,}$/.test(row.category)) {
    row.barcode = [row.barcode, row.category].filter(Boolean).join(", ");
    row.category = extraValues.find((v) => v && !/^\d+$/.test(v)) || "";
  }
  const extraBarcodes = extraValues.filter((v) => v && /^\d{5,}$/.test(v));
  if (extraBarcodes.length > 0) {
    row.barcode = [row.barcode, ...extraBarcodes].filter(Boolean).join(", ");
  }
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const mapped = headers.map(normalizeHeader);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    mapped.forEach((key, idx) => {
      if (key) row[key] = values[idx] || "";
    });
    fixBarcodeOverflow(row, values, mapped);
    if (row.name) rows.push(row);
  }
  return rows;
}

export default function ProductImportPage() {
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [parsedData, setParsedData] = useState([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    async function loadLocations() {
      try {
        const setup = await getCachedSetup();
        const locs = (setup?.store?.locations || []).map((loc) => ({
          _id: loc?._id || loc?.name || String(loc),
          name: loc?.name || String(loc),
        }));
        setLocations(locs);
        if (locs.length === 1) setSelectedLocation(locs[0].name);
      } catch {}
    }
    loadLocations();
  }, []);

  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");
    setResult(null);
    setFileName(file.name);

    try {
      if (file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
        const text = await file.text();
        const rows = parseCSV(text);
        if (rows.length === 0) throw new Error("No valid rows found. Ensure your CSV has a header row.");
        setParsedData(rows);
      } else if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
        const { default: readXlsxFile } = await import("read-excel-file/browser");
        const rawRows = await readXlsxFile(file);
        if (rawRows.length < 2) throw new Error("Excel file needs at least a header row and one data row.");

        const headers = rawRows[0].map((h) => String(h || "").trim());
        const mapped = headers.map(normalizeHeader);

        const rows = [];
        for (let i = 1; i < rawRows.length; i++) {
          const values = rawRows[i].map((v) => v != null ? String(v).trim() : "");
          const row = {};
          mapped.forEach((key, idx) => {
            if (key) row[key] = values[idx] || "";
          });
          fixBarcodeOverflow(row, values, mapped);
          if (row.name) rows.push(row);
        }
        if (rows.length === 0) throw new Error("No valid products found. Check your column headers.");
        setParsedData(rows);
      } else {
        throw new Error("Unsupported file format. Please use .csv or .xlsx");
      }
    } catch (err) {
      setError(err.message);
      setParsedData([]);
    }
  }, []);

  const handleImport = async () => {
    if (!selectedLocation) { setError("Please select a location"); return; }
    if (parsedData.length === 0) { setError("No data to import"); return; }

    setImporting(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: parsedData, location: selectedLocation }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult(data);
      setParsedData([]);
      setFileName("");
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const csv = EXPECTED_HEADERS.join(",") + "\n" +
      "Indomie Noodles 70g,Instant noodle snack,80,120,5012345678901,Noodles\n" +
      "Peak Milk 400g,Powdered milk tin,950,1350,5012345678902|5012345678905,Beverages\n" +
      "Dettol Soap 65g,Antibacterial bath soap,180,280,5012345678903,Personal Care\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "product_import_template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const uniqueCategories = [...new Set(parsedData.map((r) => r.category).filter(Boolean))];

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          <div className="page-header">
            <h1 className="page-title">Import Products</h1>
            <p className="page-subtitle">Bulk import products from CSV or Excel file</p>
          </div>

          {/* Instructions Card */}
          <div className="content-card mb-6">
            <h3 className="text-sm font-bold text-gray-700 mb-3">Expected File Format</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-gray-200 rounded">
                <thead className="bg-gray-50">
                  <tr>
                    {EXPECTED_HEADERS.map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-bold text-gray-600 border-b">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="text-gray-500">
                    <td className="px-3 py-1.5 border-b">Indomie 70g</td>
                    <td className="px-3 py-1.5 border-b">Instant noodles</td>
                    <td className="px-3 py-1.5 border-b">80</td>
                    <td className="px-3 py-1.5 border-b">120</td>
                    <td className="px-3 py-1.5 border-b">5012345678901</td>
                    <td className="px-3 py-1.5 border-b">Noodles</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              <strong>Required:</strong> Name, Cost, Sale &nbsp;|&nbsp; <strong>Optional:</strong> Description, Barcode (use | or ; for multiple), Category
            </p>
            <button onClick={downloadTemplate} className="mt-3 btn-action btn-action-secondary flex items-center gap-2 text-xs">
              <FontAwesomeIcon icon={faDownload} className="w-3.5 h-3.5" />
              Download CSV Template
            </button>
          </div>

          {/* Upload & Location */}
          <div className="content-card mb-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Location *</label>
                <select
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  className="form-select w-full"
                >
                  <option value="">Select location</option>
                  {locations.map((loc) => (
                    <option key={loc._id} value={loc.name}>{loc.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">All imported products will be assigned to this location</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Upload File *</label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                >
                  <FontAwesomeIcon icon={faFileExcel} className="w-8 h-8 text-gray-400 mb-2" />
                  <p className="text-sm text-gray-600 font-medium">
                    {fileName || "Click to upload CSV or Excel file"}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Supports .csv, .xlsx</p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm flex items-center gap-2">
              <FontAwesomeIcon icon={faExclamationTriangle} className="w-4 h-4" />
              {error}
            </div>
          )}

          {/* Preview */}
          {parsedData.length > 0 && (
            <div className="content-card mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-700">
                  Preview — {parsedData.length} product{parsedData.length !== 1 ? "s" : ""}
                  {uniqueCategories.length > 0 && ` • ${uniqueCategories.length} categor${uniqueCategories.length !== 1 ? "ies" : "y"}`}
                </h3>
                <button
                  onClick={handleImport}
                  disabled={importing || !selectedLocation}
                  className="btn-action btn-action-primary flex items-center gap-2"
                >
                  <FontAwesomeIcon icon={faUpload} className="w-4 h-4" />
                  {importing ? "Importing..." : `Import ${parsedData.length} Products`}
                </button>
              </div>

              <div className="overflow-x-auto max-h-96">
                <table className="data-table text-xs">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Name</th>
                      <th>Description</th>
                      <th>Cost</th>
                      <th>Sale</th>
                      <th>Barcode</th>
                      <th>Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedData.slice(0, 50).map((row, i) => (
                      <tr key={i}>
                        <td className="text-gray-400">{i + 1}</td>
                        <td className="font-medium">{row.name}</td>
                        <td className="text-gray-500 max-w-[150px] truncate">{row.description || "—"}</td>
                        <td>{row.costPrice || "0"}</td>
                        <td>{row.salePriceIncTax || "0"}</td>
                        <td className="font-mono text-gray-600">{row.barcode || "—"}</td>
                        <td><span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-bold">{row.category || "Top Level"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedData.length > 50 && (
                  <p className="text-xs text-gray-500 mt-2 text-center">Showing first 50 of {parsedData.length} rows</p>
                )}
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="content-card bg-green-50 border-green-200">
              <div className="flex items-center gap-3 mb-3">
                <FontAwesomeIcon icon={faCheck} className="w-5 h-5 text-green-600" />
                <h3 className="text-sm font-bold text-green-800">Import Complete</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span className="text-gray-600">Total rows:</span> <strong>{result.summary.total}</strong></div>
                <div><span className="text-gray-600">Created:</span> <strong className="text-green-700">{result.summary.created}</strong></div>
                <div><span className="text-gray-600">Skipped:</span> <strong className="text-orange-600">{result.summary.skipped}</strong></div>
                <div><span className="text-gray-600">New categories:</span> <strong className="text-blue-600">{result.summary.categoriesCreated}</strong></div>
              </div>
              {result.skipped?.length > 0 && (
                <details className="mt-3">
                  <summary className="text-xs font-semibold text-gray-600 cursor-pointer">Skipped items ({result.skipped.length})</summary>
                  <ul className="mt-2 text-xs text-gray-600 space-y-1 max-h-40 overflow-y-auto">
                    {result.skipped.map((s, i) => (
                      <li key={i}><strong>{s.name}</strong> — {s.reason}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
