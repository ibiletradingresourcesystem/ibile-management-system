import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import PriceTagGenerator from "@/components/PriceTagGenerator";
import { apiClient } from "@/lib/api-client";

export default function PriceTagsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // "all" | "price-changed"
  const [dateRange, setDateRange] = useState(7); // days back to check

  useEffect(() => {
    async function loadProducts() {
      setLoading(true);
      try {
        if (filter === "price-changed") {
          const { data } = await apiClient.get("/api/products/price-changed", {
            params: { days: dateRange },
          });
          const list = Array.isArray(data) ? data : Array.isArray(data.products) ? data.products : [];
          setProducts(list);
        } else {
          const { data } = await apiClient.get("/api/products", {
            params: { limit: 200 },
          });
          const list = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : Array.isArray(data.products) ? data.products : [];
          setProducts(list);
        }
      } catch (err) {
        console.error("Failed to load products:", err);
      } finally {
        setLoading(false);
      }
    }
    loadProducts();
  }, [filter, dateRange]);

  return (
    <Layout>
      <div className="max-w-6xl mx-auto p-4 md:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Price Tag Studio</h1>
          <p className="text-sm text-gray-500 mt-1">
            Generate branded price tags from your product catalog or an Excel file.
            Tags include product name, price, and barcode.
          </p>
        </div>

        {/* Filter Controls */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <button
              onClick={() => setFilter("all")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === "all"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              All Products
            </button>
            <button
              onClick={() => setFilter("price-changed")}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === "price-changed"
                  ? "bg-orange-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Price Changed
            </button>
          </div>
          {filter === "price-changed" && (
            <select
              value={dateRange}
              onChange={(e) => setDateRange(Number(e.target.value))}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value={1}>Last 24 hours</option>
              <option value={3}>Last 3 days</option>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          )}
          {filter === "price-changed" && !loading && (
            <span className="text-sm text-orange-700 font-medium">
              {products.length} product{products.length !== 1 ? "s" : ""} with price changes
            </span>
          )}
        </div>

        {loading ? (
          <p className="text-center text-gray-500 py-8">Loading products...</p>
        ) : (
          <PriceTagGenerator products={products} />
        )}
      </div>
    </Layout>
  );
}
