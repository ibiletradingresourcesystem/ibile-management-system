"use client";

/**
 * Product Promotions: every product on a deal, what the deal is, and when it runs.
 *
 * The till applies these at the sale and prints the promotion's name on the receipt
 * (lib/promotionRules.js). Changing one opens it in the promotion form.
 */
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import Layout from "@/components/Layout";
import axios from "axios";
import Link from "next/link";
import useSWR from "swr";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";
import { PROMOTION_DAY_LABELS } from "@/lib/promotionRules";

const fetcher = (url) => axios.get(url).then((r) => r.data);

const STATUS_STYLES = {
  running: { label: "Running", className: "bg-emerald-100 text-emerald-800" },
  scheduled: { label: "Scheduled", className: "bg-sky-100 text-sky-800" },
  ended: { label: "Ended", className: "bg-gray-200 text-gray-700" },
};

const CUSTOMER_TYPE_LABELS = { REGULAR: "Regular", VIP: "VIP", NEW: "New", BULK_BUYER: "Bulk buyer", ONLINE: "Online", CREDIT: "Credit" };

const PAGE_SIZE = 25;

/** "07 Oct, 08:00" in the shop's time. */
const shopMoment = (value) =>
  value
    ? new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })
    : "—";

export default function Promotions() {
  const { data, error, isLoading, mutate } = useSWR("/api/products/promotions", fetcher, { revalidateOnFocus: true });
  const promotions = useMemo(() => data?.promotions || [], [data]);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState(new Set());

  const counts = useMemo(
    () => promotions.reduce((acc, p) => ({ ...acc, [p.status]: (acc[p.status] || 0) + 1 }), {}),
    [promotions]
  );

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return promotions.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!term) return true;
      return [p.name, p.barcode, p.promoName].some((field) => String(field || "").toLowerCase().includes(term));
    });
  }, [promotions, searchTerm, statusFilter]);

  const visible = filtered.slice(0, visibleCount);

  const endPromotions = async (ids, label) => {
    const confirmed = await showConfirmDialog({
      title: ids.length === 1 ? "End this promotion?" : `End ${ids.length} promotions?`,
      message: `${label} will go back to the normal price.`,
      tone: "danger",
      confirmLabel: ids.length === 1 ? "End promotion" : "End promotions",
      cancelLabel: "Keep",
    });
    if (!confirmed) return;
    try {
      await axios.delete("/api/products/promotions", { data: { productIds: ids } });
      setSelected(new Set());
      await mutate();
    } catch (err) {
      await showAlertDialog({
        title: "Not ended",
        message: err.response?.data?.message || "The promotion could not be ended.",
        tone: "danger",
      });
    }
  };

  const toggleSelected = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p._id));
  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach((p) => next.delete(p._id));
      else visible.forEach((p) => next.add(p._id));
      return next;
    });

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          {/* Header */}
          <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="page-title">Product Promotions</h1>
              <p className="page-subtitle">Deals the till applies by itself, named on the customer&apos;s receipt.</p>
            </div>
            <Link href="/manage/add-promotion" className="btn-action-primary w-full sm:w-auto text-center">
              + Add Promotion
            </Link>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {["running", "scheduled", "ended"].map((key) => (
              <button
                key={key}
                onClick={() => setStatusFilter(statusFilter === key ? "all" : key)}
                className={`content-card text-left transition-shadow hover:shadow-md ${statusFilter === key ? "ring-2 ring-sky-500" : ""}`}
              >
                <p className="text-sm text-gray-500">{STATUS_STYLES[key].label}</p>
                <p className="text-2xl font-bold text-gray-900">{counts[key] || 0}</p>
              </button>
            ))}
          </div>

          {/* Search and filter */}
          <div className="content-card mb-6">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder="Search by promotion, product name or barcode"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setVisibleCount(PAGE_SIZE);
                  }}
                  className="form-input pl-10"
                />
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setVisibleCount(PAGE_SIZE);
                }}
                className="form-select md:w-48"
              >
                <option value="all">All promotions</option>
                <option value="running">Running</option>
                <option value="scheduled">Scheduled</option>
                <option value="ended">Ended</option>
              </select>
              {selected.size > 0 && (
                <button
                  onClick={() => endPromotions([...selected], `${selected.size} product${selected.size === 1 ? "" : "s"}`)}
                  className="border border-red-600 text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap"
                >
                  End selected ({selected.size})
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="data-table-container">
            <table className="data-table min-w-[1000px]">
              <thead>
                <tr>
                  <th className="w-10">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="Select all shown" />
                  </th>
                  <th>Promotion</th>
                  <th>Product</th>
                  <th className="text-right">Normal price</th>
                  <th>Runs</th>
                  <th>Days</th>
                  <th>Customers</th>
                  <th className="text-center">Status</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {error ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-8 text-center text-red-600">
                      Promotions could not be loaded. {error.response?.data?.message || ""}
                    </td>
                  </tr>
                ) : isLoading ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-8 text-center text-gray-500">Loading promotions…</td>
                  </tr>
                ) : visible.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-6 py-10 text-center text-gray-500">
                      {promotions.length === 0 ? (
                        <>
                          No product is on promotion.{" "}
                          <Link href="/manage/add-promotion" className="theme-link font-medium">Add one</Link>.
                        </>
                      ) : (
                        "No promotion matches that search."
                      )}
                    </td>
                  </tr>
                ) : (
                  visible.map((promo) => {
                    const status = STATUS_STYLES[promo.status] || STATUS_STYLES.running;
                    return (
                      <tr key={promo._id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected.has(promo._id)}
                            onChange={() => toggleSelected(promo._id)}
                            aria-label={`Select ${promo.name}`}
                          />
                        </td>
                        <td>
                          <p className="font-semibold text-gray-900">{promo.promoName || "—"}</p>
                          <p className="text-xs text-emerald-700 font-medium">{promo.deal}</p>
                        </td>
                        <td>
                          <p className="text-gray-900">{promo.name}</p>
                          {promo.barcode && <p className="text-xs text-gray-500">{promo.barcode}</p>}
                        </td>
                        <td className="text-right font-mono">{formatCurrency(promo.salePriceIncTax || 0)}</td>
                        <td className="whitespace-nowrap text-sm">
                          {shopMoment(promo.promoStart)}
                          <span className="block text-gray-500">to {shopMoment(promo.promoEnd)}</span>
                        </td>
                        <td className="text-sm">
                          {promo.promoDays?.length ? promo.promoDays.map((d) => PROMOTION_DAY_LABELS[d]).join(", ") : "Every day"}
                        </td>
                        <td className="text-sm">
                          {promo.promoCustomerTypes?.length
                            ? promo.promoCustomerTypes.map((t) => CUSTOMER_TYPE_LABELS[t] || t).join(", ")
                            : "Everyone"}
                        </td>
                        <td className="text-center">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${status.className}`}>{status.label}</span>
                        </td>
                        <td className="text-center">
                          <div className="flex gap-2 justify-center">
                            <Link
                              href={`/manage/add-promotion?productId=${promo._id}`}
                              className="border border-blue-600 text-blue-600 hover:bg-blue-50 px-3 py-1 rounded text-xs font-semibold"
                            >
                              Change
                            </Link>
                            <button
                              onClick={() => endPromotions([promo._id], promo.name)}
                              className="border border-red-600 text-red-600 hover:bg-red-50 px-3 py-1 rounded text-xs font-semibold"
                            >
                              End
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {filtered.length > visibleCount && (
            <div className="text-center mt-6">
              <button onClick={() => setVisibleCount((n) => n + PAGE_SIZE)} className="btn-action-secondary">
                Show more ({filtered.length - visibleCount} left)
              </button>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
