"use client";

import Layout from "@/components/Layout";
import { Loader } from "@/components/ui";
import { useState, useEffect } from "react";
import { Scale, Printer } from "lucide-react";

const TYPE_ORDER = { ASSET: 0, LIABILITY: 1, EQUITY: 2, REVENUE: 3, EXPENSE: 4 };

export default function TrialBalancePage() {
  const [rows, setRows] = useState([]);
  const [totalDebit, setTotalDebit] = useState(0);
  const [totalCredit, setTotalCredit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetchTrialBalance();
  }, [dateFrom, dateTo]);

  async function fetchTrialBalance() {
    try {
      setLoading(true);
      setError("");
      const params = new URLSearchParams({ report: "trial-balance" });
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      const res = await fetch(`/api/accounting/reports?${params}`);
      if (res.ok) {
        const data = await res.json();
        setRows((data.rows || []).sort((a, b) => (TYPE_ORDER[a.type] || 0) - (TYPE_ORDER[b.type] || 0) || a.code.localeCompare(b.code)));
        setTotalDebit(data.totalDebit || 0);
        setTotalCredit(data.totalCredit || 0);
      }
    } catch (err) {
      setError("Failed to load trial balance");
    } finally {
      setLoading(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  if (loading) {
    return (
      <Layout>
        <div className="page-container">
          <div className="page-content">
            <div className="flex justify-center items-center py-20">
              <Loader size="lg" text="Calculating trial balance..." />
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
          <div>
            <h1 className="page-title">Trial Balance</h1>
            <p className="page-subtitle">
              {isBalanced ? (
                <span className="text-green-600 font-semibold">✓ Books are balanced</span>
              ) : (
                <span className="text-red-600 font-semibold">✗ Out of balance by {Math.abs(totalDebit - totalCredit).toLocaleString()}</span>
              )}
            </p>
          </div>
          <button onClick={handlePrint} className="btn-action btn-action-secondary">
            <Printer size={18} /> Print
          </button>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">{error}</div>}

        {/* Date Filter */}
        <div className="flex gap-3 mb-4">
          <div>
            <label className="form-label">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="form-input" />
          </div>
          <div>
            <label className="form-label">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="form-input" />
          </div>
        </div>

        <div className="content-card !p-0 overflow-hidden print-area">
          <div className="px-6 py-4 border-b bg-gray-50 text-center print:block hidden">
            <h2 className="text-xl font-bold">Trial Balance</h2>
            {dateFrom || dateTo ? (
              <p className="text-sm text-gray-600">{dateFrom || "Start"} to {dateTo || "Present"}</p>
            ) : (
              <p className="text-sm text-gray-600">As of {new Date().toLocaleDateString()}</p>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left px-4 py-3 font-semibold w-24">Code</th>
                  <th className="text-left px-4 py-3 font-semibold">Account</th>
                  <th className="text-left px-4 py-3 font-semibold w-24">Type</th>
                  <th className="text-right px-4 py-3 font-semibold w-32">Debit</th>
                  <th className="text-right px-4 py-3 font-semibold w-32">Credit</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-500">No posted journal entries found</td></tr>
                ) : rows.map((row) => (
                  <tr key={row._id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono theme-accent-text">{row.code}</td>
                    <td className="px-4 py-2 font-medium text-gray-900">{row.name}</td>
                    <td className="px-4 py-2 text-xs text-gray-500">{row.type}</td>
                    <td className="px-4 py-2 text-right font-medium">{row.debit > 0 ? row.debit.toLocaleString() : ""}</td>
                    <td className="px-4 py-2 text-right font-medium">{row.credit > 0 ? row.credit.toLocaleString() : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold text-lg">
                  <td colSpan={3} className="px-4 py-3 text-right">Totals</td>
                  <td className="px-4 py-3 text-right">{totalDebit.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{totalCredit.toLocaleString()}</td>
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
