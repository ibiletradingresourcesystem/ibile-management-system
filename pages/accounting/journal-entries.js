"use client";

import Layout from "@/components/Layout";
import { Loader } from "@/components/ui";
import { formatCurrency } from "@/lib/format";
import { useState, useEffect } from "react";
import { showConfirmDialog, showPromptDialog, showToast } from "@/lib/dialogs";
import { Plus, Trash2, Check, X, FileText, Play, Ban, Eye, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

const REF_TYPES = ["SALE", "EXPENSE", "PURCHASE_ORDER", "SALARY", "REFUND", "OTHER"];
const STATUS_COLORS = {
  DRAFT: "bg-yellow-100 text-yellow-800",
  POSTED: "bg-green-100 text-green-800",
  VOIDED: "bg-red-100 text-red-800",
};

function formatSyncTime(value) {
  if (!value) return "No recent sync";
  return new Date(value).toLocaleString("en-NG");
}

export default function JournalEntriesPage() {
  const [entries, setEntries] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [expandedEntry, setExpandedEntry] = useState(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    description: "",
    reference: "",
    referenceType: "SALE",
    location: "",
    status: "DRAFT",
    lines: [
      { account: "", debit: "", credit: "", description: "" },
      { account: "", debit: "", credit: "", description: "" },
    ],
  });

  useEffect(() => {
    Promise.all([fetchEntries(), fetchAccounts()]);
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
      // Journal entries remain usable even if sync status cannot be read.
    }
  }

  async function fetchEntries() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterType) params.set("referenceType", filterType);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      params.set("limit", "50");
      params.set("skip", String(page * 50));

      const res = await fetch(`/api/accounting/journal-entries?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        setTotal(data.total || 0);
        void refreshSyncStatus();
      }
    } catch (err) {
      setError("Failed to load journal entries");
    } finally {
      setLoading(false);
    }
  }

  async function fetchAccounts() {
    try {
      const res = await fetch("/api/accounting/accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts((data.accounts || []).filter((a) => a.isActive));
      }
    } catch (err) {
      console.error("Failed to load accounts", err);
    }
  }

  useEffect(() => {
    fetchEntries();
  }, [filterStatus, filterType, dateFrom, dateTo, page]);

  useEffect(() => {
    if (!error) return;
    showToast({ title: "Journal entries", message: error, tone: "danger" });
    setError("");
  }, [error]);

  useEffect(() => {
    if (!success) return;
    showToast({ title: "Journal entries", message: success, tone: "success" });
    setSuccess("");
  }, [success]);

  function addLine() {
    setForm({ ...form, lines: [...form.lines, { account: "", debit: "", credit: "", description: "" }] });
  }

  function removeLine(idx) {
    if (form.lines.length <= 2) return;
    setForm({ ...form, lines: form.lines.filter((_, i) => i !== idx) });
  }

  function updateLine(idx, field, value) {
    const lines = [...form.lines];
    lines[idx] = { ...lines[idx], [field]: value };
    // Auto-clear the opposite field
    if (field === "debit" && value) lines[idx].credit = "";
    if (field === "credit" && value) lines[idx].debit = "";
    setForm({ ...form, lines });
  }

  const formTotalDebit = form.lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const formTotalCredit = form.lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const isBalanced = Math.abs(formTotalDebit - formTotalCredit) < 0.01;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!form.description) return setError("Description is required");
    if (form.lines.some((l) => !l.account)) return setError("All lines must have an account selected");
    if (!isBalanced) return setError("Debits must equal credits");

    try {
      const res = await fetch("/api/accounting/journal-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setSuccess("Journal entry created");
      resetForm();
      fetchEntries();
    } catch (err) {
      setError(err.message);
    }
  }

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

      await fetchEntries();
    } catch (syncError) {
      setError(syncError.message || "Failed to sync accounting");
    } finally {
      setSyncing(false);
    }
  }

  const syncSummary = syncStatus?.lastSummary
    ? `${syncStatus.lastSummary.salesSynced || 0} sales, ${syncStatus.lastSummary.expensesSynced || 0} expenses, ${syncStatus.lastSummary.purchaseOrdersSynced || 0} purchase orders`
    : "";

  async function postEntry(id) {
    try {
      const res = await fetch(`/api/accounting/entries/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "post" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setSuccess("Entry posted");
      fetchEntries();
    } catch (err) {
      setError(err.message);
    }
  }

  async function voidEntry(id) {
    const reason = await showPromptDialog({
      title: "Void journal entry",
      message: "Provide a reason for voiding this entry.",
      label: "Void reason",
      placeholder: "Enter reason",
      required: true,
      requiredMessage: "A void reason is required.",
      confirmLabel: "Void entry",
      cancelLabel: "Cancel",
      tone: "warning",
      multiline: true,
    });
    if (!reason) return;
    try {
      const res = await fetch(`/api/accounting/entries/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", voidReason: reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setSuccess("Entry voided");
      fetchEntries();
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteEntry(id) {
    const shouldDelete = await showConfirmDialog({
      title: "Delete draft entry?",
      message: "This draft journal entry will be removed permanently.",
      tone: "danger",
      confirmLabel: "Delete entry",
      cancelLabel: "Keep entry",
    });
    if (!shouldDelete) return;
    try {
      const res = await fetch(`/api/accounting/entries/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setSuccess("Entry deleted");
      fetchEntries();
    } catch (err) {
      setError(err.message);
    }
  }

  function resetForm() {
    setForm({
      date: new Date().toISOString().split("T")[0],
      description: "",
      reference: "",
      referenceType: "SALE",
      location: "",
      status: "DRAFT",
      lines: [
        { account: "", debit: "", credit: "", description: "" },
        { account: "", debit: "", credit: "", description: "" },
      ],
    });
    setShowForm(false);
  }

  if (loading && entries.length === 0) {
    return (
      <Layout>
        <div className="page-container">
          <div className="page-content">
            <div className="flex justify-center items-center py-20">
              <Loader size="lg" text="Loading journal entries..." />
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
            <h1 className="page-title">Journal Entries</h1>
            <p className="page-subtitle">{total} entries total</p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
              <button onClick={handleManualSync} disabled={syncing} className="btn-action btn-action-secondary disabled:opacity-60 disabled:cursor-not-allowed" title={`Last synced: ${formatSyncTime(syncStatus?.lastSyncAt)}${syncSummary ? ` | ${syncSummary}` : ""}`}>
                <RefreshCw size={16} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing..." : "Sync"}
              </button>
              <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="btn-action btn-action-primary">
                <Plus size={18} /> {showForm ? "Close" : "New Entry"}
              </button>
          </div>
        </div>

        {syncMessage && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">{syncMessage}</div>}

        {/* Form */}
        {showForm && (
          <div className="content-card mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">New Journal Entry</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="form-label">Date *</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="form-input" required />
                </div>
                <div>
                  <label className="form-label">Description *</label>
                  <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="form-input" placeholder="What is this entry for?" required />
                </div>
                <div>
                  <label className="form-label">Reference</label>
                  <input type="text" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="form-input" placeholder="Optional ref" />
                </div>
              </div>

              {/* Lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="form-label !mb-0">Journal Lines</label>
                  <button type="button" onClick={addLine} className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1">
                    <Plus size={14} /> Add Line
                  </button>
                </div>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-gray-600 w-1/3">Account</th>
                        <th className="text-left px-3 py-2 font-semibold text-gray-600">Description</th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-600 w-28">Debit</th>
                        <th className="text-right px-3 py-2 font-semibold text-gray-600 w-28">Credit</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.lines.map((line, idx) => (
                        <tr key={idx} className="border-t border-gray-100">
                          <td className="px-3 py-2">
                            <select value={line.account} onChange={(e) => updateLine(idx, "account", e.target.value)} className="form-select !py-1.5 text-sm">
                              <option value="">Select account</option>
                              {accounts.map((a) => <option key={a._id} value={a._id}>{a.code} - {a.name}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input type="text" value={line.description} onChange={(e) => updateLine(idx, "description", e.target.value)} className="form-input !py-1.5 text-sm" placeholder="Line memo" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" value={line.debit} onChange={(e) => updateLine(idx, "debit", e.target.value)} className="form-input !py-1.5 text-sm text-right" step="0.01" min="0" placeholder="0.00" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" value={line.credit} onChange={(e) => updateLine(idx, "credit", e.target.value)} className="form-input !py-1.5 text-sm text-right" step="0.01" min="0" placeholder="0.00" />
                          </td>
                          <td className="px-3 py-2">
                            {form.lines.length > 2 && (
                              <button type="button" onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-700">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                        <td colSpan={2} className="px-3 py-2 text-right">Totals:</td>
                        <td className="px-3 py-2 text-right">{formTotalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td className="px-3 py-2 text-right">{formTotalCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                        <td></td>
                      </tr>
                      {!isBalanced && formTotalDebit + formTotalCredit > 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-2 text-red-600 text-center font-semibold">
                            ⚠ Out of balance by {Math.abs(formTotalDebit - formTotalCredit).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      )}
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={!isBalanced} className={`btn-action btn-action-primary flex-1 ${!isBalanced ? "opacity-50 cursor-not-allowed" : ""}`}>
                  <Check size={16} /> {form.status === "POSTED" ? "Post Entry" : "Save Draft"}
                </button>
                <button type="button" onClick={resetForm} className="btn-action btn-action-secondary flex-1">
                  <X size={16} /> Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }} className="form-select w-full sm:w-40">
            <option value="">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="POSTED">Posted</option>
            <option value="VOIDED">Voided</option>
          </select>
          <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(0); }} className="form-select w-full sm:w-40">
            <option value="">All Types</option>
            {REF_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} className="form-input w-full sm:w-40" />
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} className="form-input w-full sm:w-40" />
        </div>

        {/* Entries List */}
        <div className="content-card !p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Entry #</th>
                  <th className="text-left px-4 py-3 font-semibold">Date</th>
                  <th className="text-left px-4 py-3 font-semibold">Description</th>
                  <th className="text-left px-4 py-3 font-semibold">Type</th>
                  <th className="text-right px-4 py-3 font-semibold">Debit</th>
                  <th className="text-right px-4 py-3 font-semibold">Credit</th>
                  <th className="text-center px-4 py-3 font-semibold">Status</th>
                  <th className="text-right px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-500">No journal entries found</td></tr>
                ) : entries.map((entry) => (
                  <>
                    <tr key={entry._id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setExpandedEntry(expandedEntry === entry._id ? null : entry._id)}>
                      <td className="px-4 py-3 font-mono theme-accent-text font-semibold">{entry.entryNumber}</td>
                      <td className="px-4 py-3 text-gray-600">{new Date(entry.date).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-gray-900 font-medium max-w-xs truncate">{entry.description}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{entry.referenceType}</td>
                      <td className="px-4 py-3 text-right font-medium">{(entry.totalDebit || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-medium">{(entry.totalCredit || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${STATUS_COLORS[entry.status]}`}>{entry.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          {entry.status === "DRAFT" && (
                            <>
                              <button onClick={() => postEntry(entry._id)} className="text-xs px-2.5 py-1 text-green-700 bg-green-50 border border-green-200 rounded hover:bg-green-100 font-medium">
                                Post
                              </button>
                              <button onClick={() => deleteEntry(entry._id)} className="text-xs px-2.5 py-1 text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 font-medium">
                                Delete
                              </button>
                            </>
                          )}
                          {entry.status === "POSTED" && (
                            <button onClick={() => voidEntry(entry._id)} className="text-xs px-2.5 py-1 text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 font-medium">
                              Void
                            </button>
                          )}
                          <button onClick={() => setExpandedEntry(expandedEntry === entry._id ? null : entry._id)} className="text-xs px-2.5 py-1 text-gray-600 bg-gray-50 border border-gray-200 rounded hover:bg-gray-100 font-medium">
                            {expandedEntry === entry._id ? "Less" : "More"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedEntry === entry._id && (
                      <tr key={`${entry._id}-detail`}>
                        <td colSpan={8} className="px-4 pb-4 bg-gray-50">
                          <div className="rounded-lg border border-gray-200 overflow-hidden mt-1">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-100">
                                <tr>
                                  <th className="text-left px-3 py-2">Account</th>
                                  <th className="text-left px-3 py-2">Description</th>
                                  <th className="text-right px-3 py-2">Debit</th>
                                  <th className="text-right px-3 py-2">Credit</th>
                                </tr>
                              </thead>
                              <tbody>
                                {entry.lines?.map((line, i) => (
                                  <tr key={i} className="border-t border-gray-100">
                                    <td className="px-3 py-2 font-medium">
                                      <span className="theme-accent-text font-mono">{line.accountCode}</span> {line.accountName}
                                    </td>
                                    <td className="px-3 py-2 text-gray-600">{line.description || "—"}</td>
                                    <td className="px-3 py-2 text-right font-medium">{line.debit ? line.debit.toLocaleString() : ""}</td>
                                    <td className="px-3 py-2 text-right font-medium">{line.credit ? line.credit.toLocaleString() : ""}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {entry.reference && <p className="text-xs text-gray-500 mt-2">Reference: {entry.reference}</p>}
                          {entry.location && <p className="text-xs text-gray-500">Location: {entry.location}</p>}
                          {entry.voidReason && <p className="text-xs text-red-600 mt-1">Void reason: {entry.voidReason}</p>}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > 50 && (
            <div className="flex justify-center gap-2 py-4 border-t">
              <button disabled={page === 0} onClick={() => setPage(page - 1)} className="btn-action btn-action-secondary btn-sm">Previous</button>
              <span className="text-sm text-gray-600 py-1">Page {page + 1} of {Math.ceil(total / 50)}</span>
              <button disabled={(page + 1) * 50 >= total} onClick={() => setPage(page + 1)} className="btn-action btn-action-secondary btn-sm">Next</button>
            </div>
          )}
        </div>
        </div>
      </div>
    </Layout>
  );
}
