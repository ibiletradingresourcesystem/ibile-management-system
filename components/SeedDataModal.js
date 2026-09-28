import { useState } from "react";
import { X, Upload, Download, FileSpreadsheet, Info } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { SEED_COLUMN_HELP, buildSeedTemplateCsv, seedDataFromCsv } from "@/lib/seedOrdersCsv";

/**
 * Seeds vendors and stock orders, from either route.
 *
 * The expense app writes a .json export; anyone without that app fills in the CSV
 * template instead, which is turned into the same payload here. Either way the
 * file is checked by the server without writing anything, and only imported once
 * the counts have been seen. This replaced Sync Stock Orders, which needed both
 * apps on one database and pulled in records that were never orders.
 */
export default function SeedDataModal({ onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState([]);
  const [showColumns, setShowColumns] = useState(false);

  /** The blank sheet, with the columns and a couple of filled-in orders to copy. */
  const downloadTemplate = () => {
    // The byte order mark keeps Excel from mangling the naira amounts and accents.
    const blob = new Blob(["\uFEFF" + buildSeedTemplateCsv()], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vendor_orders_seed_template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const pickFile = async (event) => {
    const chosen = event.target.files?.[0];
    event.target.value = ""; // the same file can be chosen again after a failure
    if (!chosen) return;

    setError("");
    setIssues([]);
    setSummary(null);
    setResult(null);
    setFile(chosen);
    setBusy(true);
    const isCsv = /\.(csv|txt)$/i.test(chosen.name);
    try {
      const text = await chosen.text();
      let parsed;

      if (isCsv) {
        const fromSheet = seedDataFromCsv(text);
        setIssues(fromSheet.issues);
        if (!fromSheet.data) {
          setData(null);
          setError(fromSheet.issues[0] || "Nothing in that sheet could be read as an order.");
          return;
        }
        parsed = fromSheet.data;
      } else {
        parsed = JSON.parse(text);
      }

      setData(parsed);

      // Ask the server what this file would do, before anything is written.
      const res = await apiClient.post("/api/purchase-orders/seed-import", { data: parsed, preview: true });
      setSummary(res.data.summary);
    } catch (err) {
      setData(null);
      setError(
        err instanceof SyntaxError
          ? "That file is not readable JSON. Use the expense app Download Data file, or the CSV template."
          : err.response?.data?.error || err.message || "Could not read that file."
      );
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await apiClient.post("/api/purchase-orders/seed-import", { data });
      setResult(res.data);
      onImported?.();
    } catch (err) {
      setError(err.response?.data?.error || "The import failed.");
    } finally {
      setBusy(false);
    }
  };

  const nothingToDo =
    summary && summary.vendors.toCreate === 0 && summary.orders.purchaseOrders === 0 && summary.orders.stockOrders === 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-lg font-bold">Seed Data</h2>
          <button onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            Import vendors and stock orders. From the expense app, open{" "}
            <span className="font-medium">Expenses → Stock Ordering</span>, press{" "}
            <span className="font-medium">Download Data</span> and choose that file here. Without that app, fill in the CSV
            template instead.
          </p>

          <div className="rounded-lg border theme-border-soft bg-gray-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <FileSpreadsheet size={18} className="text-emerald-600" />
                <span>
                  <span className="font-medium">No export file?</span> Start from the template: one row per order, with what it
                  came to and what has been paid on it.
                </span>
              </div>
              <button onClick={downloadTemplate} className="btn-action btn-action-secondary flex items-center gap-2 text-xs">
                <Download size={14} />
                Download CSV Template
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowColumns((open) => !open)}
              className="mt-3 flex items-center gap-1.5 text-xs font-medium text-sky-700 hover:text-sky-900"
            >
              <Info size={13} />
              {showColumns ? "Hide the columns" : "What goes in each column"}
            </button>
            {showColumns && (
              <dl className="mt-2 space-y-1.5 text-xs text-gray-600">
                {SEED_COLUMN_HELP.map(([column, help]) => (
                  <div key={column}>
                    <dt className="font-semibold text-gray-800">{column}</dt>
                    <dd>{help}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed theme-border-soft rounded-lg p-6 cursor-pointer hover:bg-gray-50 transition">
            <Upload size={22} className="text-gray-400" />
            <span className="text-sm font-medium text-gray-700">
              {file ? file.name : "Choose the export file (.json) or a filled-in template (.csv)"}
            </span>
            <span className="text-xs text-gray-500">Nothing is written until you press Import</span>
            <input type="file" accept="application/json,.json,text/csv,.csv,.txt" onChange={pickFile} className="hidden" />
          </label>

          {busy && <p className="text-sm text-gray-500">Working…</p>}
          {error && <div className="alert alert-error text-sm">{error}</div>}

          {issues.length > 0 && (
            <div className="alert alert-warning text-sm">
              <p className="font-semibold">Read from the sheet, with these left out:</p>
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                {issues.slice(0, 6).map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
              </ul>
              {issues.length > 6 && <p className="mt-1">…and {issues.length - 6} more.</p>}
            </div>
          )}

          {summary && !result && (
            <div className="rounded-lg border theme-border-soft p-4 text-sm space-y-2">
              <p className="font-semibold text-gray-800">This file holds:</p>
              <ul className="space-y-1 text-gray-700">
                <li>
                  {summary.vendors.inFile} vendors — <strong>{summary.vendors.toCreate} new</strong>, {summary.vendors.matched} already here
                </li>
                <li>
                  {summary.orders.inFile} stock orders — <strong>{summary.orders.purchaseOrders}</strong> received (become purchase
                  orders), <strong>{summary.orders.stockOrders}</strong> still on order (join Submitted Stock Orders)
                </li>
                {summary.orders.alreadySeeded > 0 && (
                  <li className="text-gray-500">{summary.orders.alreadySeeded} were seeded before and will be skipped</li>
                )}
              </ul>
              {summary.exportedAt && (
                <p className="text-xs text-gray-500">Exported {new Date(summary.exportedAt).toLocaleString("en-NG")}</p>
              )}
              {nothingToDo && <p className="text-xs text-amber-700">Everything in this file is already here.</p>}
            </div>
          )}

          {result && (
            <div className="alert alert-success text-sm space-y-2">
              <p>{result.message}</p>
              {result.summary?.unmatchedOrders?.length > 0 && (
                <div>
                  <p className="font-semibold">Skipped — no vendor to attach them to:</p>
                  <ul className="list-disc pl-5">
                    {result.summary.unmatchedOrders.slice(0, 8).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                  {result.summary.unmatchedOrders.length > 8 && (
                    <p>…and {result.summary.unmatchedOrders.length - 8} more</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t">
          <button onClick={onClose} className="flex-1 btn-action btn-action-secondary">
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              onClick={runImport}
              disabled={!summary || busy || nothingToDo}
              className="flex-1 btn-action btn-action-primary disabled:opacity-50"
            >
              {busy ? "Importing…" : "Import"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
