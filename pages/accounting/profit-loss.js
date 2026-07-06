"use client";

import Layout from "@/components/Layout";
import { Loader } from "@/components/ui";
import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, Printer } from "lucide-react";

export default function ProfitLossPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchPL();
  }, [dateFrom, dateTo]);

  async function fetchPL() {
    try {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ report: "profit-loss" });
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
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
              <Loader size="lg" text="Loading profit & loss..." />
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const netIncome = data?.netIncome || 0;

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
          <div>
            <h1 className="page-title">Profit & Loss Statement</h1>
            <p className="page-subtitle">Income statement for the period</p>
          </div>
          <button onClick={() => window.print()} className="btn-action btn-action-secondary">
            <Printer size={18} /> Print
          </button>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">{error}</div>}

        {/* Date Filter */}
        <div className="flex gap-3 mb-6">
          <div>
            <label className="form-label">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="form-input" />
          </div>
          <div>
            <label className="form-label">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="form-input" />
          </div>
        </div>

        {/* Net Income Summary */}
        <div className={`content-card mb-6 border-l-4 ${netIncome >= 0 ? "border-green-500 bg-green-50" : "border-red-500 bg-red-50"}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {netIncome >= 0 ? <TrendingUp size={32} className="text-green-600" /> : <TrendingDown size={32} className="text-red-600" />}
              <div>
                <p className="text-sm font-semibold text-gray-600">Net {netIncome >= 0 ? "Profit" : "Loss"}</p>
                <p className={`text-3xl font-bold ${netIncome >= 0 ? "text-green-700" : "text-red-700"}`}>
                  {Math.abs(netIncome).toLocaleString()}
                </p>
              </div>
            </div>
            <div className="text-right text-sm text-gray-600">
              <p>Revenue: <span className="font-bold text-green-700">{(data?.totalRevenue || 0).toLocaleString()}</span></p>
              <p>Expenses: <span className="font-bold text-red-700">{(data?.totalExpenses || 0).toLocaleString()}</span></p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Revenue */}
          <div className="content-card !p-0 overflow-hidden">
            <div className="px-4 py-3 bg-green-50 border-b flex items-center justify-between">
              <h2 className="font-bold text-green-800">Revenue</h2>
              <span className="text-green-700 font-bold">{(data?.totalRevenue || 0).toLocaleString()}</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {(data?.revenue || []).length === 0 ? (
                  <tr><td className="px-4 py-6 text-center text-gray-500">No revenue recorded</td></tr>
                ) : data.revenue.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <span className="font-medium text-gray-900">{r.name}</span>
                      {r.subType && <span className="text-xs text-gray-500 ml-2">({r.subType})</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-green-700">{r.amount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-green-300 bg-green-50 font-bold">
                  <td className="px-4 py-2">Total Revenue</td>
                  <td className="px-4 py-2 text-right text-green-800">{(data?.totalRevenue || 0).toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Expenses */}
          <div className="content-card !p-0 overflow-hidden">
            <div className="px-4 py-3 bg-red-50 border-b flex items-center justify-between">
              <h2 className="font-bold text-red-800">Expenses</h2>
              <span className="text-red-700 font-bold">{(data?.totalExpenses || 0).toLocaleString()}</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {(data?.expenses || []).length === 0 ? (
                  <tr><td className="px-4 py-6 text-center text-gray-500">No expenses recorded</td></tr>
                ) : data.expenses.map((e, i) => (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <span className="font-medium text-gray-900">{e.name}</span>
                      {e.subType && <span className="text-xs text-gray-500 ml-2">({e.subType})</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold text-red-700">{e.amount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-red-300 bg-red-50 font-bold">
                  <td className="px-4 py-2">Total Expenses</td>
                  <td className="px-4 py-2 text-right text-red-800">{(data?.totalExpenses || 0).toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        </div>
      </div>
    </Layout>
  );
}
