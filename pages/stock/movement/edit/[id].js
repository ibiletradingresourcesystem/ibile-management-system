/**
 * Edit / Receive a stock movement.
 *
 * The movement detail page has always had an "EDIT / RECEIVE" button, but it
 * linked to this route and no page existed here, so it returned a 404. This is
 * the receiving screen: it shows what was sent, takes the quantity that
 * actually arrived, and posts the difference so stock stays truthful.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";
import { ArrowLeft, Save, PackageCheck, RotateCcw, AlertTriangle } from "lucide-react";

const STATUS_OPTIONS = ["Pending", "Sent", "Received"];

export default function EditStockMovementPage() {
  const router = useRouter();
  const { id } = router.query;

  const [movement, setMovement] = useState(null);
  const [lines, setLines] = useState([]);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("Received");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadMovement = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await apiClient.get(`/api/stock-movement/${id}`);
      setMovement(data);
      setNotes(data.notes || "");
      setStatus(data.status || "Received");
      setLines(
        (data.products || []).map((p) => ({
          productId: p.productId,
          productName: p.productName,
          barcode: p.barcode || "",
          costPrice: Number(p.costPrice) || 0,
          sentQty: Number(p.quantity) || 0,
          receivedQty: String(Number(p.quantity) || 0),
          notes: p.notes || "",
        }))
      );
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load movement");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!router.isReady || !id) return;
    loadMovement();
  }, [router.isReady, id, loadMovement]);

  const updateLine = (index, field, value) => {
    setLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const receiveAll = () => {
    setLines((prev) => prev.map((line) => ({ ...line, receivedQty: String(line.sentQty) })));
  };

  const resetChanges = () => {
    setLines((prev) => prev.map((line) => ({ ...line, receivedQty: String(line.sentQty) })));
    setNotes(movement?.notes || "");
    setStatus(movement?.status || "Received");
  };

  const totals = useMemo(() => {
    let sent = 0;
    let received = 0;
    let value = 0;
    let variances = 0;
    lines.forEach((line) => {
      const receivedQty = Number(line.receivedQty);
      const safeReceived = Number.isFinite(receivedQty) ? receivedQty : 0;
      sent += line.sentQty;
      received += safeReceived;
      value += safeReceived * line.costPrice;
      if (safeReceived !== line.sentQty) variances += 1;
    });
    return { sent, received, value, variances, difference: received - sent };
  }, [lines]);

  const invalidLine = lines.find((line) => {
    const n = Number(line.receivedQty);
    return line.receivedQty === "" || !Number.isFinite(n) || n < 0;
  });

  const handleSave = async () => {
    if (invalidLine) {
      await showAlertDialog({
        title: "Check the quantities",
        message: `"${invalidLine.productName}" needs a received quantity of zero or more.`,
        tone: "danger",
      });
      return;
    }

    if (totals.variances > 0) {
      const confirmed = await showConfirmDialog({
        title: "Save with variances?",
        message: `${totals.variances} line(s) differ from what was sent. Stock will be adjusted by ${
          totals.difference > 0 ? "+" : ""
        }${totals.difference} unit(s). Continue?`,
        confirmLabel: "Save changes",
      });
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      await apiClient.put(`/api/stock-movement/${id}`, {
        products: lines.map((line) => ({
          productId: line.productId,
          quantity: Number(line.receivedQty),
          notes: line.notes,
        })),
        notes,
        status,
      });
      router.push(`/stock/movement/${id}`);
    } catch (err) {
      await showAlertDialog({
        title: "Update failed",
        message: err.response?.data?.message || err.message || "Could not save the movement",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout title="Edit Stock Movement">
        <div className="page-container">
          <div className="page-content flex items-center justify-center min-h-[60vh]">
            <Loader size="lg" text="Loading movement..." />
          </div>
        </div>
      </Layout>
    );
  }

  if (error || !movement) {
    return (
      <Layout title="Edit Stock Movement">
        <div className="page-container">
          <div className="page-content">
            <div className="content-card text-center py-12">
              <AlertTriangle size={40} className="mx-auto mb-4 text-amber-500" />
              <h2 className="text-lg font-semibold text-gray-800 mb-2">Movement not available</h2>
              <p className="text-sm text-gray-500 mb-6">{error || "This stock movement could not be found."}</p>
              <Link href="/stock/movement" className="btn-action btn-action-primary inline-flex items-center gap-2">
                <ArrowLeft size={16} /> Back to Stock Movement
              </Link>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Edit Stock Movement">
      <div className="page-container">
        <div className="page-content">
          <div className="mb-4 text-sm">
            <Link href="/stock/movement" className="theme-link">
              Stock Movement
            </Link>
            <span className="mx-2 text-gray-400">/</span>
            <Link href={`/stock/movement/${id}`} className="theme-link">
              {movement.transRef}
            </Link>
            <span className="mx-2 text-gray-400">/</span>
            <span className="text-gray-600">Edit &amp; Receive</span>
          </div>

          <div className="page-header">
            <div>
              <h1 className="page-title">Edit &amp; Receive</h1>
              <p className="page-subtitle">
                {movement.reason} &middot; {movement.fromLocation} &rarr; {movement.toLocation}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button onClick={resetChanges} className="btn-action btn-action-secondary inline-flex items-center gap-2">
                <RotateCcw size={16} /> Reset
              </button>
              <button onClick={receiveAll} className="btn-action btn-action-secondary inline-flex items-center gap-2">
                <PackageCheck size={16} /> Receive all as sent
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-action btn-action-primary inline-flex items-center gap-2 disabled:opacity-60"
              >
                <Save size={16} /> {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>

          {/* Movement summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <SummaryTile label="Reference" value={movement.transRef} />
            <SummaryTile label="Units sent" value={totals.sent.toLocaleString()} />
            <SummaryTile
              label="Units received"
              value={totals.received.toLocaleString()}
              tone={totals.difference === 0 ? "neutral" : totals.difference > 0 ? "up" : "down"}
            />
            <SummaryTile label="Received value" value={formatCurrency(totals.value)} />
          </div>

          {totals.variances > 0 && (
            <div className="alert alert-warning mb-6 flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
              <p className="text-sm">
                {totals.variances} line(s) differ from the sent quantity. Saving adjusts stock by{" "}
                <strong>
                  {totals.difference > 0 ? "+" : ""}
                  {totals.difference}
                </strong>{" "}
                unit(s) on this movement&apos;s reason ({movement.reason}).
              </p>
            </div>
          )}

          {/* Lines */}
          <div className="data-table-container mb-6">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th style={{ textAlign: "right" }}>Unit Cost</th>
                  <th style={{ textAlign: "right" }}>Sent</th>
                  <th style={{ textAlign: "right", width: "130px" }}>Received</th>
                  <th style={{ textAlign: "right" }}>Variance</th>
                  <th style={{ textAlign: "right" }}>Line Value</th>
                  <th style={{ minWidth: "180px" }}>Line Note</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const receivedQty = Number(line.receivedQty);
                  const safeReceived = Number.isFinite(receivedQty) ? receivedQty : 0;
                  const variance = safeReceived - line.sentQty;
                  const invalid = line.receivedQty === "" || !Number.isFinite(receivedQty) || receivedQty < 0;
                  return (
                    <tr key={`${line.productId}-${index}`}>
                      <td>
                        <span className="font-medium text-gray-800 block">{line.productName}</span>
                        {line.barcode && <span className="text-xs text-gray-500 font-mono">{line.barcode}</span>}
                      </td>
                      <td style={{ textAlign: "right" }}>{formatCurrency(line.costPrice)}</td>
                      <td style={{ textAlign: "right" }}>{line.sentQty.toLocaleString()}</td>
                      <td style={{ textAlign: "right" }}>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="numeric"
                          value={line.receivedQty}
                          onChange={(e) => updateLine(index, "receivedQty", e.target.value)}
                          className={`form-input text-right ${invalid ? "border-red-500" : ""}`}
                          style={{ maxWidth: "110px", marginLeft: "auto" }}
                          aria-label={`Received quantity for ${line.productName}`}
                        />
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span
                          className={`font-semibold ${
                            variance === 0 ? "text-gray-400" : variance > 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {variance > 0 ? `+${variance}` : variance}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>{formatCurrency(safeReceived * line.costPrice)}</td>
                      <td>
                        <input
                          type="text"
                          value={line.notes}
                          onChange={(e) => updateLine(index, "notes", e.target.value)}
                          placeholder="Damaged, short, etc."
                          className="form-input"
                          aria-label={`Note for ${line.productName}`}
                        />
                      </td>
                    </tr>
                  );
                })}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-gray-500 py-8">
                      This movement has no product lines.
                    </td>
                  </tr>
                )}
              </tbody>
              {lines.length > 0 && (
                <tfoot>
                  <tr className="theme-table-summary-row">
                    <td colSpan={2}>Totals</td>
                    <td style={{ textAlign: "right" }}>{totals.sent.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>{totals.received.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>
                      {totals.difference > 0 ? `+${totals.difference}` : totals.difference}
                    </td>
                    <td style={{ textAlign: "right" }}>{formatCurrency(totals.value)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Status & notes */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="content-card">
              <h3 className="text-base font-semibold text-gray-800 mb-3">Status</h3>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="form-select">
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-2">
                Marking a movement as Received stamps the received date if it has none.
              </p>
            </div>

            <div className="content-card lg:col-span-2">
              <h3 className="text-base font-semibold text-gray-800 mb-3">Movement Notes</h3>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Anything the next person should know about this delivery…"
                className="form-input"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mt-6">
            <Link href={`/stock/movement/${id}`} className="btn-action btn-action-secondary inline-flex items-center gap-2">
              <ArrowLeft size={16} /> Cancel
            </Link>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-action btn-action-primary inline-flex items-center gap-2 disabled:opacity-60"
            >
              <Save size={16} /> {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function SummaryTile({ label, value, tone = "neutral" }) {
  const toneClass =
    tone === "up" ? "text-emerald-600" : tone === "down" ? "text-red-600" : "text-gray-900";
  return (
    <div className="stat-card">
      <p className="stat-card-label">{label}</p>
      <p className={`stat-card-value ${toneClass}`}>{value}</p>
    </div>
  );
}
