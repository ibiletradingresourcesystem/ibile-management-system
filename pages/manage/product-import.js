"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Layout from "@/components/Layout";
import apiClient from "@/lib/api-client";
import { useAuth } from "@/lib/useAuth";
import { getCachedSetup } from "@/lib/setupCache";
import { clearCache } from "@/lib/useIndexedDBCache";
import { formatCurrency } from "@/lib/format";
import { IMPORT_TEMPLATE_HEADERS, parseDelimitedText, rowsFromTable } from "@/lib/productImport";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileExcel, faDownload, faUpload, faCheck, faExclamationTriangle, faBarcode } from "@fortawesome/free-solid-svg-icons";

const MAX_ROWS = 5000;
const MAX_VISIBLE_ROWS = 300;

const COLUMN_HELP = [
  ["Name", "Required. Existing products are matched by name, then by barcode."],
  ["Description", "Optional. Defaults to the name."],
  ["Cost / Sale", "Prices. For existing products only these are updated when they differ."],
  ["Barcode", "Optional. Several codes in one cell: separate with , ; | or a new line. Codes a spreadsheet broke apart are repaired."],
  ["Category", "Optional. Missing categories are created for new products."],
  ["Qty", "Stock quantity (in packs for a pack product). Ignored for child products."],
  ["Pack Qty", "Makes the row a mother/pack product holding this many units, e.g. 24. \"none\" turns a pack back into an ordinary product and detaches its children."],
  ["Parent", "Name or barcode of the mother/pack product this row is a child of — part of the name is enough, and the match is shown below. \"none\" detaches a child from its pack."],
  ["Units", "Units of the parent's pack in one of this child, e.g. 6, 2 or 1. Change it to re-cut an existing child."],
];

const TEMPLATE_ROWS = [
  ["Soft Drink 50cl Pack of 24", "Pack of 24 bottles", "4800", "6450", "5012345678910", "Drinks", "10", "24", "", ""],
  ["Soft Drink 50cl Pack of 6", "6 bottles", "1200", "1650", "5012345678911", "Drinks", "", "", "Soft Drink 50cl Pack of 24", "6"],
  ["Soft Drink 50cl Pack of 2", "2 bottles", "400", "560", "5012345678912", "Drinks", "", "", "Soft Drink 50cl Pack of 24", "2"],
  ["Soft Drink 50cl Single", "1 bottle", "200", "290", "5012345678913", "Drinks", "", "", "Soft Drink 50cl Pack of 24", "1"],
  ["Peak Milk 400g", "Powdered milk tin", "950", "1350", "5012345678902, 5012345678905", "Beverages", "36", "", "", ""],
];

const ACTION_STYLES = {
  create: { label: "New", className: "bg-green-100 text-green-800" },
  update: { label: "Update", className: "bg-blue-100 text-blue-800" },
  unchanged: { label: "No change", className: "bg-gray-100 text-gray-700" },
  error: { label: "Error", className: "bg-red-100 text-red-700" },
  failed: { label: "Failed", className: "bg-red-100 text-red-700" },
};

const FILTERS = [
  ["all", "All"],
  ["create", "New"],
  ["update", "Update"],
  ["unchanged", "No change"],
  ["error", "Errors"],
  ["warnings", "Warnings"],
];

function quoteCsv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatChangeValue(field, value) {
  if (value === undefined || value === null) return "";
  return ["Cost", "Sale"].includes(field) && typeof value === "number" ? formatCurrency(value) : String(value);
}

function describeChange(change) {
  const to = formatChangeValue(change.field, change.to);
  if (change.from === undefined) return `${change.field}: ${to}`;
  return `${change.field}: ${formatChangeValue(change.field, change.from)} → ${to}`;
}

export default function ProductImportPage() {
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [parsedRows, setParsedRows] = useState([]);
  const [fileInfo, setFileInfo] = useState(null);
  const [updateExistingQty, setUpdateExistingQty] = useState(false);
  const [fixBarcodes, setFixBarcodes] = useState(true);
  const [preview, setPreview] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
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

  const postImport = useCallback(async (payload) => {
    try {
      const { data } = await apiClient.post("/api/products/import", payload);
      return data;
    } catch (err) {
      throw new Error(err.response?.data?.error || err.message || "Import failed");
    }
  }, []);

  // Preview (dry run) whenever the file or the qty option changes
  useEffect(() => {
    if (parsedRows.length === 0) {
      setPreview(null);
      return undefined;
    }
    let active = true;
    setAnalyzing(true);
    setError("");
    postImport({ products: parsedRows, updateExistingQty, fixBarcodes, dryRun: true })
      .then((data) => {
        if (active) setPreview(data);
      })
      .catch((err) => {
        if (active) {
          setPreview(null);
          setError(err.message);
        }
      })
      .finally(() => {
        if (active) setAnalyzing(false);
      });
    return () => {
      active = false;
    };
  }, [parsedRows, updateExistingQty, fixBarcodes, postImport]);

  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError("");
    setResult(null);
    setPreview(null);
    setFilter("all");

    try {
      const lowerName = file.name.toLowerCase();
      let table;
      if (lowerName.endsWith(".csv") || lowerName.endsWith(".txt")) {
        table = parseDelimitedText(await file.text());
      } else if (lowerName.endsWith(".xlsx")) {
        const { readSheet } = await import("read-excel-file/browser");
        table = await readSheet(file);
      } else if (lowerName.endsWith(".xls")) {
        throw new Error("Old .xls files aren't supported. In Excel use Save As → .xlsx or .csv, then upload again.");
      } else {
        throw new Error("Unsupported file format. Please use .csv or .xlsx");
      }

      const { rows, columns, unknownHeaders } = rowsFromTable(table);
      if (!columns.includes("name")) {
        throw new Error("Couldn't find a Name column. Check the header row matches the template.");
      }
      if (rows.length === 0) throw new Error("No product rows found under the header row.");
      if (rows.length > MAX_ROWS) {
        throw new Error(`The file has ${rows.length} rows. Split it into files of up to ${MAX_ROWS} rows.`);
      }

      setFileInfo({ name: file.name, columns, unknownHeaders });
      setParsedRows(rows);
    } catch (err) {
      setError(err.message);
      setParsedRows([]);
      setFileInfo(null);
    }
  }, []);

  const handleImport = async () => {
    if (!preview) return;
    if (preview.summary.create > 0 && !selectedLocation) {
      setError("Please select a location for the new products");
      return;
    }

    setImporting(true);
    setError("");

    try {
      const data = await postImport({
        products: parsedRows,
        location: selectedLocation,
        updateExistingQty,
        fixBarcodes,
        dryRun: false,
      });
      await Promise.allSettled([clearCache("products_cache"), clearCache("stock_products_cache")]);
      if (typeof window !== "undefined") sessionStorage.setItem("products:refresh", "1");
      setResult(data);
      setPreview(null);
      setParsedRows([]);
      setFileInfo(null);
      setFilter("all");
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const csv = [IMPORT_TEMPLATE_HEADERS, ...TEMPLATE_ROWS].map((row) => row.map(quoteCsv).join(",")).join("\n") + "\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "product_import_template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const report = result || preview;
  const reportRows = report?.rows || [];
  const visibleRows = reportRows.filter((row) => {
    if (filter === "all") return true;
    if (filter === "warnings") return row.warnings.length > 0;
    if (filter === "error") return row.action === "error" || row.action === "failed";
    return row.action === filter;
  });
  const actionable = preview ? preview.summary.create + preview.summary.update : 0;

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          <div className="page-header">
            <h1 className="page-title">Import Products</h1>
            <p className="page-subtitle">
              Seed new products, update prices and stock of existing ones, and set up mother (pack) and child products
            </p>
          </div>

          {/* Instructions Card */}
          <div className="content-card mb-6">
            <h3 className="text-sm font-bold text-gray-700 mb-3">File Columns</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-gray-200 rounded">
                <tbody>
                  {COLUMN_HELP.map(([column, help]) => (
                    <tr key={column} className="border-b last:border-b-0">
                      <td className="px-3 py-1.5 font-bold text-gray-700 whitespace-nowrap bg-gray-50">{column}</td>
                      <td className="px-3 py-1.5 text-gray-600">{help}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Mother &amp; child example: &quot;Pack of 24&quot; has <strong>Pack Qty</strong> 24 and its stock in{" "}
              <strong>Qty</strong>. &quot;Pack of 6&quot;, &quot;Pack of 2&quot; and &quot;Single&quot; name it in{" "}
              <strong>Parent</strong> with <strong>Units</strong> 6, 2 and 1 — their stock is worked out from the pack.
            </p>
            <p className="text-xs text-gray-500 mt-2">
              The same columns <strong>edit</strong> products that already exist: point <strong>Parent</strong> at a
              different pack to move a child, change <strong>Units</strong> to re-cut it, or put{" "}
              <strong>none</strong> in <strong>Parent</strong> to detach it and in <strong>Pack Qty</strong> to un-pack
              a mother product. Stock is re-worked across every pack and child the file touches. A blank cell always
              means &quot;leave as it is&quot;, so re-importing an old file changes nothing.
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
                <label className="block text-sm font-semibold text-gray-700 mb-1">Location for new products</label>
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
                <p className="text-xs text-gray-500 mt-1">New products are assigned to this location. Existing products keep theirs.</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Upload File *</label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                >
                  <FontAwesomeIcon icon={faFileExcel} className="w-8 h-8 text-gray-400 mb-2" />
                  <p className="text-sm text-gray-600 font-medium">
                    {fileInfo?.name || "Click to upload CSV or Excel file"}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Supports .csv, .xlsx</p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.xlsx,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>
            </div>

            {fileInfo && (
              <div className="mt-4 text-xs text-gray-600 space-y-1">
                <p>
                  <strong>Columns found:</strong> {fileInfo.columns.join(", ")}
                </p>
                {fileInfo.unknownHeaders.length > 0 && (
                  <p className="text-orange-600">
                    <strong>Ignored columns:</strong> {fileInfo.unknownHeaders.join(", ")}
                  </p>
                )}
              </div>
            )}

            {preview?.canSeedQty && (
              <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={updateExistingQty}
                  onChange={(e) => setUpdateExistingQty(e.target.checked)}
                />
                <span>
                  Also update stock <strong>Qty</strong> of existing products from the file
                  <span className="block text-xs text-gray-500">
                    Off: existing products only get cost &amp; sale price updates. New products always get their Qty.
                  </span>
                </span>
              </label>
            )}

            {preview && (
              <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={fixBarcodes}
                  onChange={(e) => setFixBarcodes(e.target.checked)}
                />
                <span>
                  Repair <strong>disjointed barcodes</strong> on existing products and add the file&apos;s codes
                  <span className="block text-xs text-gray-500">
                    Re-joins codes a spreadsheet broke apart (e.g. &quot;5012 3456 78901&quot;). No barcode is ever removed.
                  </span>
                </span>
              </label>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm flex items-center gap-2">
              <FontAwesomeIcon icon={faExclamationTriangle} className="w-4 h-4" />
              {error}
            </div>
          )}

          {analyzing && (
            <div className="content-card mb-6 text-sm text-gray-600">Checking {parsedRows.length} rows against your products…</div>
          )}

          {/* Result banner */}
          {result && (
            <div className="content-card mb-6 bg-green-50 border-green-200">
              <div className="flex items-center gap-3 mb-3">
                <FontAwesomeIcon icon={faCheck} className="w-5 h-5 text-green-600" />
                <h3 className="text-sm font-bold text-green-800">Import Complete</h3>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div><span className="text-gray-600">Created:</span> <strong className="text-green-700">{result.summary.create}</strong></div>
                <div><span className="text-gray-600">Updated:</span> <strong className="text-blue-700">{result.summary.update}</strong></div>
                <div><span className="text-gray-600">No change:</span> <strong>{result.summary.unchanged}</strong></div>
                <div><span className="text-gray-600">Errors / failed:</span> <strong className="text-red-600">{result.summary.errors + (result.summary.failed || 0)}</strong></div>
                <div><span className="text-gray-600">New categories:</span> <strong className="text-blue-600">{result.summary.categoriesCreated}</strong></div>
              </div>
            </div>
          )}

          {/* Preview / result rows */}
          {report && !analyzing && (
            <div className="content-card mb-6">
              {preview && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
                    <SummaryTile label="New products" value={preview.summary.create} tone="text-green-700" />
                    <SummaryTile label="Updates" value={preview.summary.update} tone="text-blue-700" />
                    <SummaryTile label="No change" value={preview.summary.unchanged} tone="text-gray-700" />
                    <SummaryTile label="Errors (skipped)" value={preview.summary.errors} tone="text-red-600" />
                  </div>
                  {preview.categoriesToCreate?.length > 0 && (
                    <p className="text-xs text-gray-600 mb-2">
                      <strong>New categories:</strong> {preview.categoriesToCreate.join(", ")}
                    </p>
                  )}
                  {preview.summary.qtyNotApplied > 0 && !updateExistingQty && (
                    <p className="text-xs text-orange-600 mb-2">
                      {preview.summary.qtyNotApplied} existing product(s) have a Qty in the file that won&apos;t be applied —
                      tick &quot;Also update stock Qty&quot; above to apply it.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <p className="text-xs text-gray-500">Nothing is saved until you click Import.</p>
                    <button
                      onClick={handleImport}
                      disabled={importing || actionable === 0 || (preview.summary.create > 0 && !selectedLocation)}
                      className="btn-action btn-action-primary flex items-center gap-2"
                    >
                      <FontAwesomeIcon icon={faUpload} className="w-4 h-4" />
                      {importing
                        ? "Importing..."
                        : `Import: create ${preview.summary.create}, update ${preview.summary.update}`}
                    </button>
                  </div>
                  {preview.summary.create > 0 && !selectedLocation && (
                    <p className="text-xs text-red-600 -mt-2 mb-3">Select a location for the new products first.</p>
                  )}
                </>
              )}

              <div className="flex flex-wrap gap-2 mb-3">
                {FILTERS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      filter === key ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto max-h-[32rem]">
                <table className="data-table text-xs">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.slice(0, MAX_VISIBLE_ROWS).map((row) => {
                      const style = ACTION_STYLES[row.action] || ACTION_STYLES.unchanged;
                      return (
                        <tr key={row.rowNumber}>
                          <td className="text-gray-400 align-top">{row.rowNumber}</td>
                          <td className="font-medium align-top">
                            {row.name}
                            {row.existingName && (
                              <span className="block text-[10px] text-gray-500">In system: {row.existingName}</span>
                            )}
                          </td>
                          <td className="align-top">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${style.className}`}>{style.label}</span>
                          </td>
                          <td className="align-top space-y-0.5">
                            {row.error && <p className="text-red-600 font-medium">{row.error}</p>}
                            {row.changes.map((change, i) => (
                              <p key={i} className="text-gray-700">{describeChange(change)}</p>
                            ))}
                            {row.warnings.map((warning, i) => (
                              <p key={`w${i}`} className="text-orange-600">{warning}</p>
                            ))}
                            {row.qtyNotApplied && !updateExistingQty && (
                              <p className="text-gray-500">Qty in file not applied</p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {visibleRows.length === 0 && (
                  <p className="text-xs text-gray-500 mt-3 text-center">No rows in this view.</p>
                )}
                {visibleRows.length > MAX_VISIBLE_ROWS && (
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    Showing first {MAX_VISIBLE_ROWS} of {visibleRows.length} rows
                  </p>
                )}
              </div>
            </div>
          )}
          <BarcodeRepairCard />
        </div>
      </div>
    </Layout>
  );
}

function SummaryTile({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
    </div>
  );
}

/**
 * Clean-up for products that were seeded before, whose barcode the spreadsheet broke apart.
 * Checking is always safe — nothing is saved until "Fix Barcodes" is clicked.
 */
function BarcodeRepairCard() {
  const { isAdmin } = useAuth();
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState("");
  const [error, setError] = useState("");

  const run = async (dryRun) => {
    setRunning(dryRun ? "check" : "fix");
    setError("");
    try {
      const { data } = await apiClient.post("/api/products/repair-barcodes", { dryRun });
      if (!dryRun) {
        await Promise.allSettled([clearCache("products_cache"), clearCache("stock_products_cache")]);
        if (typeof window !== "undefined") sessionStorage.setItem("products:refresh", "1");
      }
      setReport(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Barcode check failed");
      setReport(null);
    } finally {
      setRunning("");
    }
  };

  if (!isAdmin) return null;

  const toFix = report ? report.summary.toFix ?? report.summary.fixed : 0;

  return (
    <div className="content-card mb-6">
      <div className="flex items-center gap-2 mb-1">
        <FontAwesomeIcon icon={faBarcode} className="w-4 h-4 text-gray-500" />
        <h3 className="text-sm font-bold text-gray-700">Disjointed Barcodes</h3>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Products seeded earlier can hold a barcode a spreadsheet broke apart (e.g. &quot;5012 3456 78901&quot; or
        &quot;5012345678901.0&quot;), which stops them being scanned. This re-joins those codes. No barcode is
        ever removed, and products that would end up sharing a code are left for you to fix by hand.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => run(true)}
          disabled={Boolean(running)}
          className="btn-action btn-action-secondary text-xs"
        >
          {running === "check" ? "Checking..." : "Check Barcodes"}
        </button>
        {report?.dryRun && toFix > 0 && (
          <button
            onClick={() => run(false)}
            disabled={Boolean(running)}
            className="btn-action btn-action-primary text-xs"
          >
            {running === "fix" ? "Fixing..." : `Fix ${toFix} Barcode(s)`}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

      {report && (
        <div className="mt-4 text-xs text-gray-700 space-y-2">
          <p>
            Scanned <strong>{report.summary.scanned}</strong> product(s) with a barcode.{" "}
            {report.dryRun ? (
              <>
                <strong>{toFix}</strong> can be repaired.
              </>
            ) : (
              <span className="text-green-700 font-semibold">{toFix} barcode(s) repaired.</span>
            )}
            {report.summary.conflicts > 0 && (
              <> {report.summary.conflicts} skipped because another product already uses the repaired code.</>
            )}
          </p>

          {report.samples.length > 0 && (
            <div className="overflow-x-auto max-h-64">
              <table className="data-table text-xs">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Stored</th>
                    <th>{report.dryRun ? "Would become" : "Now"}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.samples.map((sample, i) => (
                    <tr key={i}>
                      <td className="font-medium">
                        {sample.name}
                        {sample.archived && <span className="block text-[10px] text-gray-400">archived</span>}
                      </td>
                      <td className="text-gray-500 line-through">{sample.from}</td>
                      <td className="font-mono">{sample.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.conflicts.length > 0 && (
            <div className="text-orange-600 space-y-0.5">
              <p className="font-semibold">Fix these by hand — the repaired code is already in use:</p>
              {report.conflicts.map((conflict, i) => (
                <p key={i}>
                  {conflict.name}: {conflict.code} also on &quot;{conflict.conflictsWith}&quot;
                </p>
              ))}
            </div>
          )}

          {report.unrecoverable.length > 0 && (
            <div className="text-orange-600 space-y-0.5">
              <p className="font-semibold">Re-scan these — the code was shortened by a spreadsheet and is lost:</p>
              {report.unrecoverable.map((item, i) => (
                <p key={i}>
                  {item.name}: {item.code}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
