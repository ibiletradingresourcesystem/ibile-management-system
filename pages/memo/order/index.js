import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import Layout from "@/components/Layout";
import OrderMemo from "@/components/OrderMemo";
import axios from "axios";

export default function OrderMemoPage() {
  const router = useRouter();
  const { id } = router.query;
  const memoRef = useRef();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!id) return;

    async function fetchOrder() {
      try {
        const { data } = await axios.get(`/api/purchase-orders/${id}`);
        setOrder(data.order || data);
      } catch (err) {
        console.error("Failed to load order:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchOrder();
  }, [id]);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-gray-500">Loading...</p>
        </div>
      </Layout>
    );
  }

  if (!order) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-red-500">Order not found.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto p-4 md:p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Order Memo</h1>
            <p className="text-sm text-gray-500">
              {order.vendorName || order.supplier} — {new Date(order.date || order.createdAt).toLocaleDateString("en-GB")}
            </p>
          </div>
          <button
            onClick={() => memoRef.current?.generatePDF()}
            disabled={downloading}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {downloading ? "Generating..." : "Download PDF"}
          </button>
        </div>

        <div className="overflow-x-auto">
          <OrderMemo ref={memoRef} order={order} onDownloading={setDownloading} />
        </div>
      </div>
    </Layout>
  );
}
