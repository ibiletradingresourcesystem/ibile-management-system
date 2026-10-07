"use client";

/**
 * Add or change a product promotion (?productId= to change one product's).
 *
 * A promotion has a name, printed on the receipt; a deal — a promo price each, "buy X for ₦", or
 * "buy X, save %"; a start and an end, each a date and a time; the days it runs; and the customer
 * types it is kept for. The till applies it to the line at the sale (lib/promotionRules.js, the
 * same rules in both apps), and this page shows each product's deal before saving.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import axios from "axios";
import { Search, X } from "lucide-react";
import Layout from "@/components/Layout";
import { showAlertDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";
import {
  PROMOTION_CUSTOMER_TYPES,
  PROMOTION_DAY_LABELS,
  PROMOTION_DAYS,
  describePromotion,
  promotionDiscount,
  promotionProblem,
} from "@/lib/promotionRules";

const SHOP_OFFSET_MS = 60 * 60 * 1000;

/** A moment as the "YYYY-MM-DDTHH:mm" a date-and-time box shows, in Lagos time. */
const toShopInput = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + SHOP_OFFSET_MS).toISOString().slice(0, 16);
};

const CUSTOMER_TYPE_LABELS = {
  REGULAR: "Regular",
  VIP: "VIP",
  NEW: "New",
  BULK_BUYER: "Bulk buyer",
  ONLINE: "Online",
  CREDIT: "Credit",
};

const TYPES = [
  { key: "price", title: "Promo price", hint: "Each one at a lower price" },
  { key: "multibuy", title: "Buy X for ₦", hint: "e.g. Buy 2 for ₦1,500" },
  { key: "percent", title: "% discount", hint: "e.g. Buy 1, save 10%" },
];

function defaultWindow() {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 7 * 86400000);
  // Ends at 23:59 on the seventh day, shop time
  const endText = `${toShopInput(end).slice(0, 10)}T23:59`;
  return { start: toShopInput(start), end: endText };
}

export default function AddPromotion() {
  const router = useRouter();
  const editingId = router.isReady ? String(router.query.productId || "") : "";

  const [name, setName] = useState("");
  const [type, setType] = useState("price");
  const [promoPrice, setPromoPrice] = useState("");
  const [buyQty, setBuyQty] = useState("2");
  const [percent, setPercent] = useState("10");
  const [{ start, end }, setWindow] = useState(defaultWindow);
  const [days, setDays] = useState(PROMOTION_DAYS);
  const [customerTypes, setCustomerTypes] = useState([]);

  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState(null);

  useEffect(() => {
    axios
      .get("/api/categories")
      .then((res) => setCategories(Array.isArray(res.data) ? res.data : res.data?.data || []))
      .catch(() => setCategories([]));
  }, []);

  // Changing one product's promotion: start from what it has
  useEffect(() => {
    if (!editingId) return;
    axios
      .get(`/api/products/promotions?productId=${encodeURIComponent(editingId)}`)
      .then((res) => {
        const product = res.data?.product;
        if (!product) return;
        setPicked([product]);
        if (!product.isPromotion) return;
        setName(product.promoName || "");
        setType(product.promoType || "price");
        setPromoPrice(product.promoPrice ? String(product.promoPrice) : "");
        setBuyQty(String(product.promoBuyQty || (product.promoType === "multibuy" ? 2 : 1)));
        setPercent(product.promoPercent ? String(product.promoPercent) : "10");
        setWindow({ start: toShopInput(product.promoStart), end: toShopInput(product.promoEnd) });
        setDays(product.promoDays?.length ? product.promoDays : PROMOTION_DAYS);
        setCustomerTypes(product.promoCustomerTypes || []);
      })
      .catch(() => {});
  }, [editingId]);

  // Searched on the server, across every product
  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setResults([]);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      axios
        .get(`/api/products?search=${encodeURIComponent(term)}&limit=20`)
        .then((res) => setResults(Array.isArray(res.data) ? res.data : res.data?.data || []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // The deal as the rules read it, to preview each product with
  const promo = useMemo(
    () => ({
      name: name.trim(),
      type,
      buyQty: Math.max(type === "multibuy" ? 2 : 1, Math.floor(Number(buyQty) || 0) || 1),
      price: type === "percent" ? 0 : Number(promoPrice) || 0,
      percent: type === "percent" ? Number(percent) || 0 : 0,
      days: [],
      customerTypes: [],
    }),
    [name, type, buyQty, promoPrice, percent]
  );

  const pickedIds = useMemo(() => new Set(picked.map((p) => p._id)), [picked]);
  const categoryName = categories.find((c) => c._id === category)?.name || "";

  const pick = (product) => {
    if (pickedIds.has(product._id)) return;
    setPicked((prev) => [...prev, product]);
    setOutcome(null);
  };
  const unpick = (id) => setPicked((prev) => prev.filter((p) => p._id !== id));
  const toggleDay = (day) => setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  const toggleCustomerType = (key) =>
    setCustomerTypes((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]));

  const save = async () => {
    if (!name.trim()) {
      await showAlertDialog({ title: "Name needed", message: "Give the promotion a name: customers see it on their receipt.", tone: "warning" });
      return;
    }
    if (picked.length === 0 && !category) {
      await showAlertDialog({ title: "No products", message: "Add at least one product, or pick a category.", tone: "warning" });
      return;
    }
    if (days.length === 0) {
      await showAlertDialog({ title: "No days", message: "Tick at least one day for the promotion to run on.", tone: "warning" });
      return;
    }
    setSaving(true);
    try {
      const res = await axios.put("/api/products/promotions", {
        productIds: picked.map((p) => p._id),
        ...(category ? { category, categoryName } : {}),
        name: name.trim(),
        type,
        buyQty: Number(buyQty),
        promoPrice: Number(promoPrice),
        percent: Number(percent),
        start,
        end,
        days,
        customerTypes,
      });
      setOutcome(res.data);
      if (res.data?.updated?.length && !editingId) {
        setPicked([]);
        setCategory("");
      }
    } catch (err) {
      setOutcome({ success: false, message: err.response?.data?.message || "The promotion could not be saved.", updated: [], skipped: [] });
    } finally {
      setSaving(false);
    }
  };

  const allDays = days.length === PROMOTION_DAYS.length;

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content max-w-5xl">
          <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="page-title">{editingId ? "Change Promotion" : "Add Promotion"}</h1>
              <p className="page-subtitle">A deal the till applies by itself, named on the customer&apos;s receipt.</p>
            </div>
            <Link href="/manage/promotions" className="btn-action-secondary w-full sm:w-auto text-center">
              Back to Promotions
            </Link>
          </div>

          {/* 1. Name and deal */}
          <div className="content-card mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">1. The deal</h2>
            <div className="max-w-md mb-5">
              <label className="form-label">
                Promotion name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Weekend Malt Deal"
                className="form-input"
              />
              <p className="text-xs text-gray-500 mt-1">Printed on the receipt under the item, with what the customer saved.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {TYPES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setType(option.key)}
                  className={`text-left rounded-lg border px-4 py-3 transition-colors ${
                    type === option.key ? "border-sky-500 bg-sky-50 ring-1 ring-sky-500" : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <p className="font-semibold text-gray-900">{option.title}</p>
                  <p className="text-xs text-gray-500">{option.hint}</p>
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-4 items-end">
              {type !== "price" && (
                <div className="w-32">
                  <label className="form-label">Buy</label>
                  <input
                    type="number"
                    min={type === "multibuy" ? 2 : 1}
                    value={buyQty}
                    onChange={(e) => setBuyQty(e.target.value)}
                    className="form-input"
                  />
                </div>
              )}
              {type === "percent" ? (
                <div className="w-32">
                  <label className="form-label">Save (%)</label>
                  <input type="number" min="1" max="99" value={percent} onChange={(e) => setPercent(e.target.value)} className="form-input" />
                </div>
              ) : (
                <div className="w-44">
                  <label className="form-label">{type === "multibuy" ? "For (₦, all together)" : "Promo price each (₦)"}</label>
                  <input type="number" min="0" value={promoPrice} onChange={(e) => setPromoPrice(e.target.value)} className="form-input" />
                </div>
              )}
              <p className="text-sm text-gray-700 pb-2">
                <strong>{describePromotion(promo)}</strong>
              </p>
            </div>
            {type === "percent" && Number(buyQty) > 1 && (
              <p className="text-xs text-gray-500 mt-2">Buying {buyQty} or more of the product takes {percent || 0}% off each one.</p>
            )}
            {type === "multibuy" && (
              <p className="text-xs text-gray-500 mt-2">Every {Math.max(2, Number(buyQty) || 2)} together cost the deal price; any extra are at the normal price.</p>
            )}
          </div>

          {/* 2. When */}
          <div className="content-card mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">2. When it runs</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
              <div>
                <label className="form-label">Starts (date and time)</label>
                <input type="datetime-local" value={start} onChange={(e) => setWindow((w) => ({ ...w, start: e.target.value }))} className="form-input" />
              </div>
              <div>
                <label className="form-label">Ends (date and time)</label>
                <input
                  type="datetime-local"
                  value={end}
                  min={start || undefined}
                  onChange={(e) => setWindow((w) => ({ ...w, end: e.target.value }))}
                  className="form-input"
                />
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center gap-3 mb-2">
                <label className="form-label mb-0">Days it runs</label>
                <button
                  type="button"
                  onClick={() => setDays(allDays ? [] : PROMOTION_DAYS)}
                  className="text-xs theme-link"
                >
                  {allDays ? "Clear" : "Every day"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {PROMOTION_DAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`w-14 py-2 rounded-lg border text-sm font-medium ${
                      days.includes(day) ? "bg-sky-600 border-sky-600 text-white" : "bg-white border-gray-300 text-gray-600"
                    }`}
                  >
                    {PROMOTION_DAY_LABELS[day]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Who (optional) */}
          <div className="content-card mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">3. Customer type (optional)</h2>
            <p className="text-sm text-gray-500 mb-4">
              {customerTypes.length === 0
                ? "Everyone gets it, walk-in customers included."
                : "Only these customers get it, once they are picked on the till."}
            </p>
            <div className="flex flex-wrap gap-2">
              {PROMOTION_CUSTOMER_TYPES.map((key) => (
                <label
                  key={key}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${
                    customerTypes.includes(key) ? "border-sky-500 bg-sky-50" : "border-gray-300"
                  }`}
                >
                  <input type="checkbox" checked={customerTypes.includes(key)} onChange={() => toggleCustomerType(key)} />
                  {CUSTOMER_TYPE_LABELS[key]}
                </label>
              ))}
            </div>
          </div>

          {/* 4. Products */}
          <div className="content-card mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">4. Products</h2>
            <p className="text-sm text-gray-500 mb-4">Search for products, or put a whole category on the promotion.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Search products</label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Name or barcode"
                    className="form-input pl-10"
                  />
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                </div>
                {searchTerm.trim().length >= 2 && (
                  <div className="mt-2 border border-gray-200 rounded-lg max-h-64 overflow-y-auto divide-y">
                    {searching ? (
                      <p className="px-3 py-2 text-sm text-gray-500">Searching…</p>
                    ) : results.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-gray-500">No product matches.</p>
                    ) : (
                      results.map((product) => (
                        <button
                          key={product._id}
                          onClick={() => pick(product)}
                          disabled={pickedIds.has(product._id)}
                          className="w-full flex justify-between items-center px-3 py-2 text-sm text-left hover:bg-sky-50 disabled:opacity-50"
                        >
                          <span>
                            {product.name}
                            {product.isPromotion && <span className="ml-2 text-xs text-amber-700">(on a promotion now)</span>}
                          </span>
                          <span className="font-mono text-gray-600">{formatCurrency(product.salePriceIncTax || 0)}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div>
                <label className="form-label">Or a whole category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="form-select">
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                </select>
                {category && <p className="text-xs text-gray-500 mt-1">Every product in {categoryName} goes on the promotion.</p>}
              </div>
            </div>

            {picked.length > 0 && (
              <div className="mt-5 border-t border-gray-200 pt-4">
                <p className="text-sm font-medium text-gray-700 mb-2">On this promotion ({picked.length})</p>
                <div className="data-table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="text-right">Normal price</th>
                        <th className="text-right">Customer saves</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {picked.map((product) => {
                        const problem = promotionProblem(promo, product.salePriceIncTax);
                        const qty = promo.type === "price" ? 1 : promo.buyQty;
                        const saved = problem ? 0 : promotionDiscount(promo, { unitPrice: product.salePriceIncTax, quantity: qty });
                        return (
                          <tr key={product._id}>
                            <td>{product.name}</td>
                            <td className="text-right font-mono">{formatCurrency(product.salePriceIncTax || 0)}</td>
                            <td className={`text-right ${problem ? "text-red-600" : "text-emerald-700 font-semibold"}`}>
                              {problem || `${formatCurrency(saved)} on ${qty === 1 ? "each" : `every ${qty}`}`}
                            </td>
                            <td className="text-right">
                              <button onClick={() => unpick(product._id)} className="text-gray-400 hover:text-red-600" title="Take off this promotion">
                                <X className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {outcome && (
            <div
              className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
                outcome.updated?.length ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-700"
              }`}
            >
              <p className="font-medium">{outcome.message}</p>
              {outcome.skipped?.length > 0 && (
                <ul className="mt-2 list-disc list-inside">
                  {outcome.skipped.map((s) => (
                    <li key={s._id}>{s.name}: {s.reason}</li>
                  ))}
                </ul>
              )}
              {outcome.updated?.length > 0 && (
                <Link href="/manage/promotions" className="theme-link font-medium mt-2 inline-block">See all promotions</Link>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={save}
              disabled={saving || (picked.length === 0 && !category)}
              className="btn-action-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : editingId ? "Save Changes" : "Save Promotion"}
            </button>
            <Link href="/manage/promotions" className="btn-action-secondary text-center">Cancel</Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}
