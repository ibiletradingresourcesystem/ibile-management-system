import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import PriceTagGenerator from "@/components/PriceTagGenerator";
import { apiClient } from "@/lib/api-client";

function listFrom(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.products)) return data.products;
  return [];
}

export default function PriceTagsPage() {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("all"); // "all" | "price-changed"
  const [dateRange, setDateRange] = useState(7); // days back to check

  useEffect(() => {
    apiClient
      .get("/api/categories")
      .then(({ data }) => setCategories(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to load categories:", err));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadProducts() {
      setLoading(true);
      setLoadError("");
      try {
        // The whole catalogue, trimmed to what a tag needs. This used to ask for 200
        // products, so everything after the first 200 could never be tagged.
        const { data } =
          filter === "price-changed"
            ? await apiClient.get("/api/products/price-changed", { params: { days: dateRange } })
            : await apiClient.get("/api/products", { params: { priceTags: true } });
        if (!cancelled) setProducts(listFrom(data));
      } catch (err) {
        console.error("Failed to load products:", err);
        if (!cancelled) {
          setProducts([]);
          setLoadError(err.response?.data?.message || err.message || "Could not load products.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadProducts();
    return () => {
      cancelled = true;
    };
  }, [filter, dateRange]);

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          <div className="page-header">
            <div>
              <h1 className="page-title">Price Tag Studio</h1>
              <p className="page-subtitle">
                Print branded price tags for any product, a whole category, or an Excel list.
              </p>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex gap-2">
              <button
                onClick={() => setFilter("all")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === "all" ? "theme-toggle-active" : "theme-toggle-neutral"
                }`}
              >
                All Products
              </button>
              <button
                onClick={() => setFilter("price-changed")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === "price-changed" ? "theme-toggle-active" : "theme-toggle-neutral"
                }`}
              >
                Price Changed
              </button>
            </div>
            {filter === "price-changed" && (
              <select
                value={dateRange}
                onChange={(e) => setDateRange(Number(e.target.value))}
                className="form-select !w-auto"
              >
                <option value={1}>Last 24 hours</option>
                <option value={3}>Last 3 days</option>
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
              </select>
            )}
            {!loading && !loadError && (
              <span className="text-sm text-gray-600">
                {filter === "price-changed"
                  ? `${products.length.toLocaleString()} product${products.length !== 1 ? "s" : ""} updated in this period`
                  : `${products.length.toLocaleString()} products available`}
              </span>
            )}
          </div>

          {loadError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {loadError}
            </div>
          )}

          {/* Kept mounted while the catalogue reloads, so switching between All and
              Price Changed never throws away the tag list being built. */}
          <div className="content-card">
            <PriceTagGenerator products={products} categories={categories} catalogLoading={loading} stockAware />
          </div>
        </div>
      </div>
    </Layout>
  );
}
