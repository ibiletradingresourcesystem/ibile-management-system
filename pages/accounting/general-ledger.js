"use client";

import Layout from "@/components/Layout";
import { Loader } from "@/components/ui";
import { formatCurrency } from "@/lib/format";
import { useState, useEffect } from "react";
import { BookOpen, RefreshCw } from "lucide-react";

const PAGE_SIZE = 50;

function formatSyncTime(value) {
  if (!value) return "No recent sync";
  return new Date(value).toLocaleString("en-NG");
}

export default function GeneralLedgerPage() {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [ledgerData, setLedgerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [error, setError] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    refreshSyncStatus();
  }, []);

  async function refreshSyncStatus() {
    try {
      const res = await fetch("/api/accounting/sync");
      if (!res.ok) return;

      const payload = await res.json();
      setSyncStatus(payload.status || null);
    } catch {
      // Keep ledger page usable even if sync status cannot be read.
    }
  }

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
      if (res.ok) {
        const data = await res.json();
        setLedgerData(data);
        void refreshSyncStatus();
      } else {
        const data = await res.json();
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

  async function handleManualSync() {
    try {
      setSyncing(true);
      setError("");
      setSyncMessage("");

      const res = await fetch("/api/accounting/sync", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.message || "Failed to sync accounting");
      }

      const result = payload.result || {};
      setSyncStatus(payload.status || null);
      setSyncMessage(
        `Accounting synced. ${result.salesSynced || 0} sales, ${result.expensesSynced || 0} expenses, ${result.purchaseOrdersSynced || 0} purchase orders refreshed.`
      );

      if (selectedAccount) {
        await fetchLedger();
      } else {
        await refreshSyncStatus();
      }
    } catch (syncError) {
      setError(syncError.message || "Failed to sync accounting");
    } finally {
      setSyncing(false);
    }
  }

  const syncSummary = syncStatus?.lastSummary
    ? `${syncStatus.lastSummary.salesSynced || 0} sales, ${syncStatus.lastSummary.expensesSynced || 0} expenses, ${syncStatus.lastSummary.purchaseOrdersSynced || 0} purchase orders`
    : "";

  // Group accounts by type for the dropdown
  const groupedAccounts = {};
  for (const acc of accounts) {
    if (!groupedAccounts[acc.type]) groupedAccounts[acc.type] = [];
    groupedAccounts[acc.type].push(acc);
  }

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
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
          <div>
            <h1 className="page-title">General Ledger</h1>
            <p className="page-subtitle">View transaction history for any account</p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
              <button onClick={handleManualSync} disabled={syncing} className="btn-action btn-action-secondary disabled:opacity-60 disabled:cursor-not-allowed" title={`Last synced: ${formatSyncTime(syncStatus?.lastSyncAt)}${syncSummary ? ` | ${syncSummary}` : ""}`}>
                <RefreshCw size={16} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing..." : "Sync"}
              </button>
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">{error}</div>}
        {syncMessage && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">{syncMessage}</div>}

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
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="form-input" />
            </div>
            <div>
              <label className="form-label">To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="form-input" />
            </div>
          </div>
        </div>

        {/* Ledger */}
        {loadingLedger ? (
          <div className="flex justify-center py-10"><Loader size="md" text="Loading ledger..." /></div>
        ) : ledgerData ? (
          <div className="content-card !p-0 overflow-hidden">
            {/* Account Header */}
            <div className="px-6 py-4 border-b" style={{ backgroundColor: 'var(--surface-card-alt)' }}>
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <BookOpen size={20} className="theme-accent-text" />
                    {ledgerData.account?.code} - {ledgerData.account?.name}
                  </h2>
                  <p className="text-sm text-gray-500">{ledgerData.account?.type}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-500">Closing Balance</p>
                  <p className="text-2xl font-bold text-gray-900">{(ledgerData.closingBalance || 0).toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Date</th>
                    <th className="text-left px-4 py-3 font-semibold">Entry #</th>
                    <th className="text-left px-4 py-3 font-semibold">Description</th>
                    <th className="text-left px-4 py-3 font-semibold">Type</th>
                    <th className="text-right px-4 py-3 font-semibold">Debit</th>
                    <th className="text-right px-4 py-3 font-semibold">Credit</th>
                    <th className="text-right px-4 py-3 font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Opening Balance Row */}
                  <tr className="theme-surface-soft font-medium">
                    <td colSpan={4} className="px-4 py-2 theme-accent-text">Opening Balance</td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2"></td>
                    <td className="px-4 py-2 text-right font-bold theme-accent-text">{(ledgerData.openingBalance || 0).toLocaleString()}</td>
                  </tr>
                  {ledgerData.rows?.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No transactions found for this account</td></tr>
                  ) : ledgerData.rows?.slice(0, visibleCount).map((row, i) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-600">{new Date(row.date).toLocaleDateString()}</td>
                      <td className="px-4 py-2 font-mono theme-accent-text">{row.entryNumber}</td>
                      <td className="px-4 py-2 text-gray-900">{row.description}{row.lineDescription ? ` — ${row.lineDescription}` : ""}</td>
                      <td className="px-4 py-2 text-xs text-gray-500">{row.referenceType}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{row.debit ? row.debit.toLocaleString() : ""}</td>
                      <td className="px-4 py-2 text-right text-gray-700">{row.credit ? row.credit.toLocaleString() : ""}</td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">{row.balance.toLocaleString()}</td>
                    </tr>
                  ))}
                  {/* Closing Balance Row */}
                  <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                    <td colSpan={4} className="px-4 py-3 text-gray-800">Closing Balance</td>
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
                  Showing <span className="font-semibold">{Math.min(visibleCount, ledgerData.rows.length)}</span> of <span className="font-semibold">{ledgerData.rows.length}</span> entries
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
