import { useState } from "react";
import { X, Upload } from "lucide-react";
import { apiClient } from "@/lib/api-client";

/**
 * Seeds the data exported from the expense app.
 *
 * The file is read here, checked by the server without writing anything, and only
 * imported once the counts have been seen. It replaced Sync Stock Orders, which
 * needed both apps on one database and pulled in records that were never orders.
 */
export default function SeedDataModal({ onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pickFile = async (event) => {
    const chosen = event.target.files?.[0];
    event.target.value = ""; // the same file can be chosen again after a failure
    if (!chosen) return;

    setError("");
    setSummary(null);
    setResult(null);
    setFile(chosen);
    setBusy(true);
    try {
      const text = await chosen.text();
      const parsed = JSON.parse(text);
      setData(parsed);

      // Ask the server what this file would do, before anything is written.
      const res = await apiClient.post("/api/purchase-orders/seed-import", { data: parsed, preview: true });
      setSummary(res.data.summary);
    } catch (err) {
      setData(null);
      setError(
        err instanceof SyntaxError
          ? "That file is not readable JSON. Use the file from the expense app's Download Data button."
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
            Import vendors and stock orders from the expense app. In that app, open{" "}
            <span className="font-medium">Expenses → Stock Ordering</span> and press{" "}
            <span className="font-medium">Download Data</span>, then choose that file here.
          </p>

          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed theme-border-soft rounded-lg p-6 cursor-pointer hover:bg-gray-50 transition">
            <Upload size={22} className="text-gray-400" />
            <span className="text-sm font-medium text-gray-700">{file ? file.name : "Choose the export file (.json)"}</span>
            <span className="text-xs text-gray-500">Nothing is written until you press Import</span>
            <input type="file" accept="application/json,.json" onChange={pickFile} className="hidden" />
          </label>

          {busy && <p className="text-sm text-gray-500">Working…</p>}
          {error && <div className="alert alert-error text-sm">{error}</div>}

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
