import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import Layout from "@/components/Layout";
import PrintMemo from "@/components/PrintMemo";
import axios from "axios";

export default function PaymentMemoPage() {
  const router = useRouter();
  const { id } = router.query;
  const memoRef = useRef();

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState("Main Account");
  const [selectedDirector, setSelectedDirector] = useState("Director");
  const [form, setForm] = useState({
    accountName: "",
    accountNumber: "",
    bankName: "",
    amount: 0,
  });

  useEffect(() => {
    if (!id) return;

    async function fetchOrder() {
      try {
        const { data } = await axios.get(`/api/purchase-orders/${id}`);
        const o = data.order || data;
        setOrder(o);

        // Pre-fill from vendor bank details
        setForm({
          accountName: o.vendor?.accountName || o.vendorName || "",
          accountNumber: o.vendor?.accountNumber || "",
          bankName: o.vendor?.bankName || "",
          amount: o.balance || o.grandTotal || 0,
        });
      } catch (err) {
        console.error("Failed to load order:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchOrder();
  }, [id]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: name === "amount" ? Number(value) : value,
    }));
  };

  const handleDownload = () => {
    memoRef.current?.generatePDF();
  };

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
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Payment Transfer Memo</h1>
            <p className="text-sm text-gray-500">
              Generate bank transfer instruction for {order.vendorName || order.supplier}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            >
              <option value="Main Account">Main Account</option>
              <option value="Savings Account">Savings Account</option>
            </select>
            <input
              value={selectedDirector}
              onChange={(e) => setSelectedDirector(e.target.value)}
              className="border rounded px-3 py-2 text-sm w-40"
              placeholder="Director name"
            />
            <button
              onClick={() => setEditing(!editing)}
              className={`px-3 py-2 rounded text-sm font-medium ${
                editing
                  ? "bg-yellow-100 text-yellow-800 border border-yellow-300"
                  : "border hover:bg-gray-50"
              }`}
            >
              {editing ? "Stop Editing" : "Edit Details"}
            </button>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {downloading ? "Generating..." : "Download PDF"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <PrintMemo
            ref={memoRef}
            order={order}
            form={form}
            editing={editing}
            handleChange={handleChange}
            onDownloading={setDownloading}
            selectedAccount={selectedAccount}
            selectedDirector={selectedDirector}
          />
        </div>
      </div>
    </Layout>
  );
}
