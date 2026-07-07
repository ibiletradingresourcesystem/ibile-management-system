import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import PriceTagGenerator from "@/components/PriceTagGenerator";
import { apiClient } from "@/lib/api-client";

export default function PriceTagsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProducts() {
      try {
        const { data } = await apiClient.get("/api/products", {
          params: { limit: 500, fields: "name,sellingPrice,barcode,price" },
        });
        setProducts(data.products || data || []);
      } catch (err) {
        console.error("Failed to load products:", err);
      } finally {
        setLoading(false);
      }
    }
    loadProducts();
  }, []);

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

        {loading ? (
          <p className="text-center text-gray-500 py-8">Loading products...</p>
        ) : (
          <PriceTagGenerator products={products} />
        )}
      </div>
    </Layout>
  );
}
