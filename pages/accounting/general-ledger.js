"use client";

import Layout from "@/components/Layout";
import { Loader } from "@/components/ui";
import Link from "next/link";
import { useState, useEffect } from "react";
import { BookOpen, Info } from "lucide-react";
import { getTodayDateKey } from "@/lib/dateFilter";

const PAGE_SIZE = 50;

/** A record id is long; its last six characters are enough to find it on its page. */
function shortReference(reference) {
  const text = String(reference || "");
  return /^[0-9a-f]{24}$/i.test(text) ? `#${text.slice(-6).toUpperCase()}` : text;
}

export default function GeneralLedgerPage() {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [ledgerData, setLedgerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingLedger, setLoadingLedger] = useState(false);
  // The current month to start with: all of history is a lot to work out on first open
  const [dateFrom, setDateFrom] = useState(() => `${getTodayDateKey().slice(0, 7)}-01`);
  const [dateTo, setDateTo] = useState(() => getTodayDateKey());
  const [error, setError] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    fetchAccounts();
  }, []);

  async function fetchAccounts() {
    try {
      setLoading(true);
      const res = await fetch("/api/accounting/accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts((data.accounts || []).filter((a) => a.isActive));
      }
    } catch (err) {
      setError("Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }

  async function fetchLedger() {
    if (!selectedAccount) return;
    try {
      setLoadingLedger(true);
      setError("");
      setVisibleCount(PAGE_SIZE);
      const params = new URLSearchParams({ report: "general-ledger", accountId: selectedAccount });
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      const res = await fetch(`/api/accounting/reports?${params}`);
      const data = await res.json();
      if (res.ok) {
        setLedgerData(data);
      } else {
        setError(data.message || "Failed to load ledger");
      }
    } catch (err) {
      setError("Failed to load ledger");
    } finally {
      setLoadingLedger(false);
    }
  }

  useEffect(() => {
    if (selectedAccount) fetchLedger();
  }, [selectedAccount, dateFrom, dateTo]);

  // Group accounts by type for the dropdown
  const groupedAccounts = {};
  for (const acc of accounts) {
    if (!groupedAccounts[acc.type]) groupedAccounts[acc.type] = [];
    groupedAccounts[acc.type].push(acc);
  }

  const chosenAccount = accounts.find((a) => a._id === selectedAccount);
  const guide = ledgerData?.account?.guide || chosenAccount?.guide || "";

  if (loading) {
    return (
      <Layout>
        <div className="page-container">
          <div className="page-content">
            <div className="flex justify-center items-center py-20">
              <Loader size="lg" text="Loading..." />
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
        <div className="mb-6">
          <h1 className="page-title">General Ledger</h1>
          <p className="page-subtitle">Every line posted to an account, and the record it came from</p>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">{error}</div>}

        {/* Filters */}
        <div className="content-card mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-2">
              <label className="form-label">Account</label>
              <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)} className="form-select">
                <option value="">Select an account...</option>
                {Object.entries(groupedAccounts).map(([type, accs]) => (
                  <optgroup key={type} label={type}>
                    {accs.map((a) => <option key={a._id} value={a._id}>{a.code} - {a.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">From</label>
              <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="form-label">To</label>
              <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="form-input" />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            The ledger is worked out from the sales, refunds, expenses, vendor payments, quick entries and stock
            records themselves each time it opens, so it is always up to date. Clear "From" to see the whole history.
          </p>
        </div>

        {/* Ledger */}
        {loadingLedger ? (
          <div className="flex justify-center py-10"><Loader size="md" text="Loading ledger..." /></div>
        ) : ledgerData ? (
          <div className="content-card !p-0 overflow-hidden">
            {/* Account Header */}
            <div className="px-6 py-4 border-b" style={{ backgroundColor: 'var(--surface-card-alt)' }}>
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <BookOpen size={20} className="theme-accent-text" />
                    {ledgerData.account?.code} - {ledgerData.account?.name}
                  </h2>
                  <p className="text-sm text-gray-500">{ledgerData.account?.type}</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-sm text-gray-500">Closing Balance</p>
                  <p className="text-2xl font-bold text-gray-900">{(ledgerData.closingBalance || 0).toLocaleString()}</p>
                </div>
              </div>
              {guide && (
                <p className="mt-3 text-sm text-gray-600 flex items-start gap-2">
                  <Info size={16} className="mt-0.5 shrink-0 theme-accent-text" />
                  <span><span className="font-semibold">What posts here:</span> {guide}</span>
                </p>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Date</th>
                    <th className="text-left px-4 py-3 font-semibold">Source</th>
                    <th className="text-left px-4 py-3 font-semibold">Description</th>
                    <th className="text-right px-4 py-3 font-semibold">Debit</th>
                    <th className="text-right px-4 py-3 font-semibold">Credit</th>
                    <th className="text-right px-4 py-3 font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Opening Balance Row */}
                  <tr className="theme-surface-soft font-medium">
                    <td colSpan={3} className="px-4 py-2 theme-accent-text">
                      Opening Balance{dateFrom ? ` (before ${new Date(`${dateFrom}T00:00:00`).toLocaleDateString()})` : ""}
                    </td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2 text-right font-bold theme-accent-text">{(ledgerData.openingBalance || 0).toLocaleString()}</td>
                  </tr>
                  {ledgerData.rows?.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Nothing was posted to this account in these dates</td></tr>
                  ) : ledgerData.rows?.slice(0, visibleCount).map((row, i) => (
                    <tr key={`${row.referenceId || ""}-${i}`} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{new Date(row.date).toLocaleDateString()}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {row.sourceHref ? (
                          <Link href={row.sourceHref} className="theme-accent-text hover:underline">{row.sourceLabel || row.referenceType}</Link>
                        ) : (
                          <span className="text-gray-500">{row.sourceLabel || row.referenceType}</span>
                        )}
                        {row.reference && <div className="text-xs font-mono text-gray-400" title={row.reference}>{shortReference(row.reference)}</div>}
                      </td>
                      <td className="px-4 py-2 text-gray-900">{row.description}{row.lineDescription ? ` — ${row.lineDescription}` : ""}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{row.debit ? row.debit.toLocaleString() : ""}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{row.credit ? row.credit.toLocaleString() : ""}</td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">{row.balance.toLocaleString()}</td>
                    </tr>
                  ))}
                  {/* Closing Balance Row */}
                  <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                    <td colSpan={3} className="px-4 py-3 text-gray-800">Closing Balance</td>
                    <td className="px-4 py-3 text-right">
                      {ledgerData.rows?.reduce((s, r) => s + (r.debit || 0), 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {ledgerData.rows?.reduce((s, r) => s + (r.credit || 0), 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-lg">{(ledgerData.closingBalance || 0).toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Load More + row count */}
            {ledgerData.rows?.length > 0 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
                <p className="text-sm text-gray-600">
                  Showing <span className="font-semibold">{Math.min(visibleCount, ledgerData.rows.length)}</span> of <span className="font-semibold">{ledgerData.rows.length}</span> lines
                </p>
                {visibleCount < ledgerData.rows.length && (
                  <button
                    onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                    className="btn-action btn-action-primary min-w-[160px]"
                  >
                    Load More
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="content-card text-center py-12">
            <BookOpen size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">Select an account to view its ledger</p>
          </div>
        )}
        </div>
      </div>
    </Layout>
  );
}
