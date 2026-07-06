"use client";

import Layout from "@/components/Layout";
import { Loader } from "@/components/ui";
import { useState, useEffect } from "react";
import { Printer } from "lucide-react";

export default function BalanceSheetPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [asOfDate, setAsOfDate] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchBS();
  }, [asOfDate]);

  async function fetchBS() {
    try {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ report: "balance-sheet" });
      if (asOfDate) params.set("to", asOfDate);
      const res = await fetch(`/api/accounting/reports?${params}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch (err) {
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="page-container">
          <div className="page-content">
            <div className="flex justify-center items-center py-20">
              <Loader size="lg" text="Loading balance sheet..." />
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const totalLE = (data?.totalLiabilities || 0) + (data?.totalEquity || 0);
  const isBalanced = Math.abs((data?.totalAssets || 0) - totalLE) < 0.01;

  function Section({ title, items, total, colorClass }) {
    return (
      <div className="content-card !p-0 overflow-hidden">
        <div className={`px-4 py-3 border-b flex items-center justify-between ${colorClass}`}>
          <h2 className="font-bold">{title}</h2>
          <span className="font-bold text-lg">{total.toLocaleString()}</span>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {items.length === 0 ? (
              <tr><td className="px-4 py-6 text-center text-gray-500">No accounts with balance</td></tr>
            ) : items.map((item, i) => (
              <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2">
                  <span className="font-mono theme-accent-text text-xs mr-2">{item.code}</span>
                  <span className="font-medium text-gray-900">{item.name}</span>
                  {item.subType && <span className="text-xs text-gray-500 ml-2">({item.subType})</span>}
                </td>
                <td className="px-4 py-2 text-right font-semibold">{Math.abs(item.amount).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
          <div>
            <h1 className="page-title">Balance Sheet</h1>
            <p className="page-subtitle">
              {isBalanced ? (
                <span className="text-green-600 font-semibold">✓ Assets = Liabilities + Equity</span>
              ) : (
                <span className="text-red-600 font-semibold">✗ Out of balance</span>
              )}
            </p>
          </div>
          <button onClick={() => window.print()} className="btn-action btn-action-secondary">
            <Printer size={18} /> Print
          </button>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">{error}</div>}

        <div className="flex gap-3 mb-6">
          <div>
            <label className="form-label">As Of Date</label>
            <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="form-input" />
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="content-card text-center border-t-4" style={{ borderTopColor: "var(--btn-primary-bg, #0284c7)" }}>
            <p className="text-sm text-gray-600 font-semibold">Total Assets</p>
            <p className="text-2xl font-bold theme-accent-text">{(data?.totalAssets || 0).toLocaleString()}</p>
          </div>
          <div className="content-card text-center border-t-4 border-red-500">
            <p className="text-sm text-gray-600 font-semibold">Total Liabilities</p>
            <p className="text-2xl font-bold text-red-700">{(data?.totalLiabilities || 0).toLocaleString()}</p>
          </div>
          <div className="content-card text-center border-t-4 border-purple-500">
            <p className="text-sm text-gray-600 font-semibold">Total Equity</p>
            <p className="text-2xl font-bold text-purple-700">{(data?.totalEquity || 0).toLocaleString()}</p>
          </div>
        </div>

        <div className="space-y-6">
          <Section title="Assets" items={data?.assets || []} total={data?.totalAssets || 0} colorClass="theme-surface-soft theme-border-soft" />
          <Section title="Liabilities" items={data?.liabilities || []} total={data?.totalLiabilities || 0} colorClass="bg-red-50 text-red-800" />
          <Section title="Equity" items={data?.equity || []} total={data?.totalEquity || 0} colorClass="bg-purple-50 text-purple-800" />
        </div>

        {/* Accounting Equation */}
        <div className="content-card mt-6 text-center bg-gray-50">
          <p className="text-lg font-bold text-gray-700">
            Assets ({(data?.totalAssets || 0).toLocaleString()}) = Liabilities ({(data?.totalLiabilities || 0).toLocaleString()}) + Equity ({(data?.totalEquity || 0).toLocaleString()})
          </p>
          <p className={`text-sm mt-1 font-semibold ${isBalanced ? "text-green-600" : "text-red-600"}`}>
            {isBalanced ? "✓ Balanced" : `✗ Difference: ${Math.abs((data?.totalAssets || 0) - totalLE).toLocaleString()}`}
          </p>
        </div>
        </div>
      </div>
    </Layout>
  );
}
