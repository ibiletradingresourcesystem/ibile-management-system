"use client";

/**
 * Add a product promotion: pick products (or a whole category), a discount, and the days it runs.
 *
 * This page used to save the promotion by sending its own name and description into every product
 * it touched — renaming them all to the promotion's name — saved a "percentage" as a price (10%
 * became ₦10), ignored the categories added to it, could only find the first 100 products, and
 * offered deal types, quantities, days and customer types that were never stored. It now sets just
 * the promo price and dates, worked out per product, and shows each new price before saving.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { Search, X } from "lucide-react";
import Layout from "@/components/Layout";
import { showAlertDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";
import { addDays, dayKeyOf } from "@/lib/tradingDay";
import { priceAfterPercentOff, promoPriceProblem } from "@/lib/promotions";

const today = () => dayKeyOf(new Date());

export default function AddPromotion() {
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState([]);

  const [discountMode, setDiscountMode] = useState("percent");
  const [percentOff, setPercentOff] = useState("10");
  const [promoPrice, setPromoPrice] = useState("");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(addDays(today(), 7));
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState(null);

  useEffect(() => {
    axios
      .get("/api/categories")
      .then((res) => setCategories(Array.isArray(res.data) ? res.data : res.data?.data || []))
      .catch(() => setCategories([]));
  }, []);

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

  const pickedIds = useMemo(() => new Set(picked.map((p) => p._id)), [picked]);
  const categoryName = categories.find((c) => c._id === category)?.name || "";

  const pick = (product) => {
    if (pickedIds.has(product._id)) return;
    setPicked((prev) => [...prev, product]);
    setOutcome(null);
  };
  const unpick = (id) => setPicked((prev) => prev.filter((p) => p._id !== id));

  const priceFor = (product) =>
    discountMode === "percent" ? priceAfterPercentOff(product.salePriceIncTax, percentOff) : Number(promoPrice) || 0;

  const save = async () => {
    if (picked.length === 0 && !category) {
      await showAlertDialog({ title: "No products", message: "Add at least one product, or pick a category.", tone: "warning" });
      return;
    }
    setSaving(true);
    try {
      const res = await axios.put("/api/products/promotions", {
        productIds: picked.map((p) => p._id),
        ...(category ? { category, categoryName } : {}),
        ...(discountMode === "percent" ? { percentOff: Number(percentOff) } : { promoPrice: Number(promoPrice) }),
        start,
        end,
      });
      setOutcome(res.data);
      if (res.data?.updated?.length) {
        setPicked([]);
        setCategory("");
      }
    } catch (err) {
      setOutcome({ success: false, message: err.response?.data?.message || "The promotion could not be saved.", updated: [], skipped: [] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content max-w-5xl">
          <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="page-title">Add Promotion</h1>
              <p className="page-subtitle">Put products on a promo price for a set number of days.</p>
            </div>
            <Link href="/manage/promotions" className="btn-action-secondary w-full sm:w-auto text-center">
              Back to Promotions
            </Link>
          </div>

          {/* 1. Products */}
          <div className="content-card mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">1. Products</h2>
            <p className="text-sm text-gray-500 mb-4">Search for products, or put a whole category on promotion.</p>
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
                            {product.isPromotion && <span className="ml-2 text-xs text-amber-700">(already on promotion)</span>}
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
                {category && (
                  <p className="text-xs text-gray-500 mt-1">
                    Every product in {categoryName} goes on promotion, each at its own price less the discount.
                  </p>
                )}
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
                        <th className="text-right">Promo price</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {picked.map((product) => {
                        const price = priceFor(product);
                        const problem = price ? promoPriceProblem(product, price) : "";
                        return (
                          <tr key={product._id}>
                            <td>{product.name}</td>
                            <td className="text-right font-mono">{formatCurrency(product.salePriceIncTax || 0)}</td>
                            <td className={`text-right font-mono ${problem ? "text-red-600" : "text-emerald-700 font-semibold"}`}>
                              {price ? formatCurrency(price) : "—"}
                              {problem && <span className="block text-xs font-sans">{problem}</span>}
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

          {/* 2. Discount */}
          <div className="content-card mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">2. Discount</h2>
            <div className="flex flex-col sm:flex-row gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={discountMode === "percent"} onChange={() => setDiscountMode("percent")} />
                Percentage off each product&apos;s price
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={discountMode === "price"} onChange={() => setDiscountMode("price")} />
                One promo price
              </label>
            </div>
            <div className="mt-4 max-w-xs">
              {discountMode === "percent" ? (
                <>
                  <label className="form-label">Percentage off</label>
                  <input type="number" min="1" max="99" value={percentOff} onChange={(e) => setPercentOff(e.target.value)} className="form-input" />
                </>
              ) : (
                <>
                  <label className="form-label">Promo price (₦)</label>
                  <input type="number" min="0" value={promoPrice} onChange={(e) => setPromoPrice(e.target.value)} className="form-input" />
                  {picked.length + (category ? 1 : 0) > 1 && (
                    <p className="text-xs text-amber-700 mt-1">Every product gets this same price. Use a percentage for products at different prices.</p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* 3. Dates */}
          <div className="content-card mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">3. Dates</h2>
            <p className="text-sm text-gray-500 mb-4">It runs from the start of the first day to the end of the last.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
              <div>
                <label className="form-label">Starts</label>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="form-input" />
              </div>
              <div>
                <label className="form-label">Ends</label>
                <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className="form-input" />
              </div>
            </div>
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
              {saving ? "Saving…" : "Save Promotion"}
            </button>
            <Link href="/manage/promotions" className="btn-action-secondary text-center">Cancel</Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}
