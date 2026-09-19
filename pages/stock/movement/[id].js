import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import PriceTagGenerator from "@/components/PriceTagGenerator";
import ExportMenu from "@/components/ExportMenu";
import { apiClient } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import { ArrowLeft, Pencil, Tags, AlertTriangle } from "lucide-react";

export default function MovementDetails() {
  const router = useRouter();
  const { id } = router.query;
  const [movement, setMovement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPriceTags, setShowPriceTags] = useState(false);

  useEffect(() => {
    if (!router.isReady || !id) return;

    let cancelled = false;
    async function fetchMovement() {
      setLoading(true);
      setError("");
      try {
        const { data } = await apiClient.get(`/api/stock-movement/${id}`);
        if (!cancelled) setMovement(data);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || err.message || "Failed to load movement");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchMovement();
    return () => {
      cancelled = true;
    };
  }, [router.isReady, id]);

  const products = useMemo(
    () => (Array.isArray(movement?.products) ? movement.products : []),
    [movement]
  );

  // Every line on this delivery, ready for the tag generator. The button used
  // to open an empty picker; the entry list is the whole point, so the tags are
  // pre-built here with one tag per unit received.
  const tagProducts = useMemo(
    () =>
      products.map((p) => ({
        _id: p.productId,
        name: p.productName || "N/A",
        salePriceIncTax: p.salePrice || p.costPrice || 0,
        costPrice: p.costPrice || 0,
        barcode: p.barcode || "",
        quantity: p.quantity || 1,
      })),
    [products]
  );

  const exportColumns = [
    { key: "productName", label: "Product", width: 2.4 },
    { key: "barcode", label: "Barcode", width: 1.2 },
    { key: "costPrice", label: "Unit Cost", type: "currency", align: "right" },
    { key: "quantity", label: "Quantity", type: "number", align: "right" },
    { key: "lineTotal", label: "Total Cost", type: "currency", align: "right", value: (row) => (row.costPrice || 0) * (row.quantity || 0) },
  ];

  const totalUnits = products.reduce((sum, p) => sum + (Number(p.quantity) || 0), 0);
  const totalCost = movement?.totalCostPrice || products.reduce((s, p) => s + (p.costPrice || 0) * (p.quantity || 0), 0);

  if (loading) {
    return (
      <Layout title="Stock Movement">
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
      <Layout title="Stock Movement">
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
    <Layout title="Stock Movement">
      <div className="page-container">
        <div className="page-content">
          <div className="mb-4 text-sm">
            <Link href="/stock/movement" className="theme-link">
              Stock Movement
            </Link>
            <span className="mx-2 text-gray-400">/</span>
            <span className="text-gray-600">{movement.transRef}</span>
          </div>

          <div className="page-header">
            <div>
              <h1 className="page-title">Stock Movement Details</h1>
              <p className="page-subtitle">
                {movement.reason} &middot; {movement.fromLocation} &rarr; {movement.toLocation}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href={`/stock/movement/edit/${id}`}
                className="btn-action btn-action-primary inline-flex items-center gap-2"
              >
                <Pencil size={16} /> Edit / Receive
              </Link>
              <button
                onClick={() => setShowPriceTags((v) => !v)}
                className="btn-action btn-action-secondary inline-flex items-center gap-2"
              >
                <Tags size={16} /> {showPriceTags ? "Hide Price Tags" : "Print Price Tags"}
              </button>
              <ExportMenu
                title="Stock Movement"
                subtitle={`${movement.reason} — ${movement.fromLocation} to ${movement.toLocation}`}
                period={movement.dateSent ? new Date(movement.dateSent).toLocaleDateString("en-NG") : ""}
                columns={exportColumns}
                rows={products}
                totals={{ productName: "Total", quantity: totalUnits, lineTotal: totalCost }}
                summary={[
                  { label: "Reference", value: movement.transRef },
                  { label: "Status", value: movement.status },
                  { label: "Line items", value: String(products.length) },
                  { label: "Total units", value: String(totalUnits) },
                ]}
              />
            </div>
          </div>

          {/* Price tags — pre-loaded with this delivery's items */}
          {showPriceTags && (
            <div className="content-card mb-6">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <Tags size={16} style={{ color: "var(--accent-text)" }} />
                <h3 className="text-base font-semibold text-gray-800">Price Tags for this Delivery</h3>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                All {products.length} item(s) are loaded with one tag per unit received. Adjust the copies before printing
                if you need fewer.
              </p>
              <PriceTagGenerator products={tagProducts} autoLoad copiesFromQuantity />
            </div>
          )}

          {/* Movement info */}
          <div className="content-card mb-6">
            <h3 className="text-base font-semibold text-gray-800 mb-4 pb-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
              Movement Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 text-sm">
              <Field label="From Location" value={movement.fromLocation} />
              <Field label="To Location" value={movement.toLocation} />
              <Field label="Reference Number" value={movement.transRef} mono />
              <Field label="Reason" value={movement.reason} />
              <Field label="Status" value={movement.status} />
              <Field
                label="Date Sent"
                value={movement.dateSent ? new Date(movement.dateSent).toLocaleString("en-NG") : "—"}
              />
              <Field
                label="Date Received"
                value={movement.dateReceived ? new Date(movement.dateReceived).toLocaleString("en-NG") : "—"}
              />
              <Field label="Total Cost" value={formatCurrency(totalCost)} />
              <Field label="Total Units" value={String(totalUnits)} />
            </div>
            {movement.notes && (
              <div className="mt-5 pt-4 border-t" style={{ borderColor: "var(--border-subtle)" }}>
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Notes</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{movement.notes}</p>
              </div>
            )}
          </div>

          {/* Products */}
          <div className="data-table-container mb-6">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Barcode</th>
                  <th style={{ textAlign: "right" }}>Unit Cost</th>
                  <th style={{ textAlign: "right" }}>Quantity</th>
                  <th style={{ textAlign: "right" }}>Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, idx) => {
                  const cost = p.costPrice || 0;
                  const qty = p.quantity || 0;
                  return (
                    <tr key={`${p.productId}-${idx}`}>
                      <td className="font-medium text-gray-800">{p.productName || "N/A"}</td>
                      <td className="font-mono text-xs text-gray-500">{p.barcode || "—"}</td>
                      <td style={{ textAlign: "right" }}>{formatCurrency(cost)}</td>
                      <td style={{ textAlign: "right" }}>{qty.toLocaleString()}</td>
                      <td style={{ textAlign: "right" }} className="font-medium">
                        {formatCurrency(cost * qty)}
                      </td>
                    </tr>
                  );
                })}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-gray-500 py-8">
                      No products on this movement.
                    </td>
                  </tr>
                )}
              </tbody>
              {products.length > 0 && (
                <tfoot>
                  <tr className="theme-table-summary-row">
                    <td colSpan={3}>Total</td>
                    <td style={{ textAlign: "right" }}>{totalUnits.toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>{formatCurrency(totalCost)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/stock/movement" className="btn-action btn-action-secondary inline-flex items-center gap-2">
              <ArrowLeft size={16} /> Back
            </Link>
            <Link
              href={`/stock/movement/edit/${id}`}
              className="btn-action btn-action-primary inline-flex items-center gap-2"
            >
              <Pencil size={16} /> Edit / Receive
            </Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function Field({ label, value, mono = false }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">{label}</p>
      <p className={`text-sm text-gray-800 ${mono ? "font-mono" : ""}`}>{value || "—"}</p>
    </div>
  );
}
