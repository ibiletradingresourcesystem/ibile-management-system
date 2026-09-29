import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
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
  const [selectedAccount, setSelectedAccount] = useState("");
  const [selectedDirector, setSelectedDirector] = useState("");
  const [memoDirectors, setMemoDirectors] = useState([]);
  const [memoAccounts, setMemoAccounts] = useState([]);
  const [form, setForm] = useState({
    accountName: "",
    accountNumber: "",
    bankName: "",
    amount: 0,
  });

  useEffect(() => {
    if (!id) return;

    /**
     * A memo is raised for a vendor order or for a payment that never had a
     * vendor — a refund to a customer, cash taken by the owner. They are separate
     * records, so the order is looked for first and the cash entry after.
     */
    async function loadPayable() {
      try {
        const order = await axios.get(`/api/purchase-orders/${id}`);
        return order.data?.order || order.data;
      } catch {
        const cash = await axios.get(`/api/cash-entries/${id}`);
        const entry = cash.data?.entry;
        if (!entry) return null;
        return {
          _id: entry._id,
          vendorName: entry.party || "Cash payment",
          date: entry.date,
          grandTotal: entry.amount,
          balance: entry.amount,
          paymentMade: 0,
          notes: entry.notes || "",
          products: [],
          isCashEntry: true,
          cashPurpose: entry.purpose,
          accountName: entry.accountName || "",
          accountNumber: entry.accountNumber || "",
          bankName: entry.bankName || "",
        };
      }
    }

    async function fetchOrder() {
      try {
        const [o, setupRes] = await Promise.all([
          loadPayable(),
          fetch("/api/setup/get").then(r => r.ok ? r.json() : null).catch(() => null),
        ]);
        if (!o) { setOrder(null); return; }
        setOrder(o);

        // Load store settings for directors and accounts
        const store = setupRes?.store;
        const directors = store?.memoDirectors || [];
        const accounts = store?.memoAccounts || [];
        // Add legacy single-value if present and not in list
        if (store?.directorName && !directors.includes(store.directorName)) {
          directors.unshift(store.directorName);
        }
        if (store?.companyAccountName && !accounts.find(a => a.accountName === store.companyAccountName)) {
          accounts.unshift({ accountName: store.companyAccountName, accountNumber: store.companyAccountNumber, bankName: store.companyBankName });
        }
        setMemoDirectors(directors);
        setMemoAccounts(accounts);
        if (directors.length > 0) setSelectedDirector(directors[0]);
        if (accounts.length > 0) setSelectedAccount(accounts[0].accountNumber || accounts[0].accountName);

        // A cash entry carries its own bank details; there is no vendor record
        // behind it to read them from.
        if (o.isCashEntry) {
          setForm({
            accountName: o.accountName || o.vendorName || "",
            accountNumber: o.accountNumber || "",
            bankName: o.bankName || "",
            amount: o.grandTotal || 0,
          });
          return;
        }

        // Pre-fill from vendor bank details
        // Note: some vendors have accountName/accountNumber swapped in DB
        const vendor = o.vendor || {};
        const vAccountName = vendor.accountNumber || vendor.accountName || o.vendorName || "";
        const vAccountNumber = vendor.accountName || vendor.accountNumber || "";
        const vBankName = vendor.bankName || "";
        // Detect if accountName looks like a number (likely swapped)
        const nameIsNumeric = /^\d{8,}$/.test(String(vendor.accountName || "").trim());
        setForm({
          accountName: nameIsNumeric ? (vendor.accountNumber || o.vendorName || "") : (vendor.accountName || o.vendorName || ""),
          accountNumber: nameIsNumeric ? (vendor.accountName || "") : (vendor.accountNumber || ""),
          bankName: vBankName,
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
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <p className="text-gray-500">Loading memo...</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <p className="text-red-500">Order not found.</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Payment Memo — {order.vendorName || "Vendor"}</title>
      </Head>
      <div className="min-h-screen bg-gray-50 py-6 px-4">
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
              {memoAccounts.length > 0 ? (
                memoAccounts.map((acc, i) => (
                  <option key={i} value={acc.accountNumber || acc.accountName}>{acc.accountName} — {acc.bankName}</option>
                ))
              ) : (
                <>
                  <option value="Main Account">Main Account</option>
                  <option value="Savings Account">Savings Account</option>
                </>
              )}
            </select>
            <select
              value={selectedDirector}
              onChange={(e) => setSelectedDirector(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            >
              {memoDirectors.length > 0 ? (
                memoDirectors.map((name, i) => (
                  <option key={i} value={name}>{name}</option>
                ))
              ) : (
                <option value="Director">Director</option>
              )}
            </select>
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
    </>
  );
}
