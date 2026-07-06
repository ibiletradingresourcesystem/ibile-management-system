"use client";

import Layout from "@/components/Layout";
import { Loader } from "@/components/ui";
import { useState, useEffect } from "react";
import { showConfirmDialog } from "@/lib/dialogs";
import { showToastMessage } from "@/lib/toast-state";
import { Plus, Pencil, Trash2, X, Check, ChevronDown, ChevronRight } from "lucide-react";

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
const TYPE_COLORS = {
  ASSET: "theme-badge-soft",
  LIABILITY: "bg-red-100 text-red-800",
  EQUITY: "bg-purple-100 text-purple-800",
  REVENUE: "bg-green-100 text-green-800",
  EXPENSE: "bg-orange-100 text-orange-800",
};

const EMPTY_FORM = {
  code: "",
  name: "",
  type: "ASSET",
  subType: "",
  normalBalance: "DEBIT",
  description: "",
  openingBalance: 0,
};

export default function ChartOfAccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [filterType, setFilterType] = useState("");
  const [search, setSearch] = useState("");
  const [expandedTypes, setExpandedTypes] = useState(new Set(ACCOUNT_TYPES));

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    if (!error) return;
    showToastMessage({ title: "Chart of accounts", text: error, fallbackTone: "danger" });
    setError("");
  }, [error]);

  useEffect(() => {
    if (!success) return;
    showToastMessage({ title: "Chart of accounts", text: success, fallbackTone: "success" });
    setSuccess("");
  }, [success]);

  async function fetchAccounts() {
    try {
      setLoading(true);
      const res = await fetch("/api/accounting/accounts");
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch (err) {
      setError("Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!form.code || !form.name) {
      setError("Code and name are required");
      return;
    }

    try {
      const url = editing ? `/api/accounting/accounts/${editing}` : "/api/accounting/accounts";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setSuccess(editing ? "Account updated" : "Account created");
      resetForm();
      fetchAccounts();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    const shouldDelete = await showConfirmDialog({
      title: "Delete account?",
      message: "This chart of accounts entry will be removed.",
      tone: "danger",
      confirmLabel: "Delete account",
      cancelLabel: "Keep account",
    });
    if (!shouldDelete) return;
    try {
      const res = await fetch(`/api/accounting/accounts/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setSuccess("Account deleted");
      fetchAccounts();
    } catch (err) {
      setError(err.message);
    }
  }

  function startEdit(acc) {
    setForm({
      code: acc.code,
      name: acc.name,
      type: acc.type,
      subType: acc.subType || "",
      normalBalance: acc.normalBalance,
      description: acc.description || "",
      openingBalance: acc.openingBalance || 0,
    });
    setEditing(acc._id);
    setShowForm(true);
  }

  function resetForm() {
    setForm({ ...EMPTY_FORM });
    setEditing(null);
    setShowForm(false);
  }

  function toggleType(type) {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  }

  // Auto-set normal balance when type changes
  function handleTypeChange(type) {
    const normalBalance = type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT";
    setForm({ ...form, type, normalBalance });
  }

  // Group accounts by type
  const grouped = {};
  for (const type of ACCOUNT_TYPES) grouped[type] = [];
  const filtered = accounts.filter((a) => {
    if (filterType && a.type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
    }
    return true;
  });
  for (const acc of filtered) {
    if (grouped[acc.type]) grouped[acc.type].push(acc);
  }

  if (loading) {
    return (
      <Layout>
        <div className="page-container">
          <div className="page-content">
            <div className="flex justify-center items-center py-20">
              <Loader size="lg" text="Loading chart of accounts..." />
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
            <h1 className="page-title">Chart of Accounts</h1>
            <p className="page-subtitle">{accounts.length} accounts configured</p>
          </div>
          <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="btn-action btn-action-primary">
            <Plus size={18} /> {showForm ? "Close" : "Add Account"}
          </button>
        </div>

        {/* Form */}
        {showForm && (
          <div className="content-card mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">{editing ? "Edit Account" : "New Account"}</h2>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="form-label">Account Code *</label>
                <input
                  type="text"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="form-input"
                  placeholder="e.g. 1000"
                  required
                />
              </div>
              <div>
                <label className="form-label">Account Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="form-input"
                  placeholder="e.g. Cash"
                  required
                />
              </div>
              <div>
                <label className="form-label">Type *</label>
                <select value={form.type} onChange={(e) => handleTypeChange(e.target.value)} className="form-select">
                  {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Sub-Type</label>
                <input
                  type="text"
                  value={form.subType}
                  onChange={(e) => setForm({ ...form, subType: e.target.value })}
                  className="form-input"
                  placeholder="e.g. Current Asset"
                />
              </div>
              <div>
                <label className="form-label">Normal Balance</label>
                <select value={form.normalBalance} onChange={(e) => setForm({ ...form, normalBalance: e.target.value })} className="form-select">
                  <option value="DEBIT">Debit</option>
                  <option value="CREDIT">Credit</option>
                </select>
              </div>
              <div>
                <label className="form-label">Opening Balance</label>
                <input
                  type="number"
                  value={form.openingBalance}
                  onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
                  className="form-input"
                  step="0.01"
                />
              </div>
              <div className="md:col-span-2">
                <label className="form-label">Description</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="form-input"
                  placeholder="Optional description"
                />
              </div>
              <div className="flex items-end gap-2">
                <button type="submit" className="btn-action btn-action-primary flex-1">
                  <Check size={16} /> {editing ? "Update" : "Create"}
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
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input flex-1"
            placeholder="Search by code or name..."
          />
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="form-select w-full sm:w-48">
            <option value="">All Types</option>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* Accounts grouped by type */}
        <div className="space-y-3">
          {ACCOUNT_TYPES.filter((type) => !filterType || filterType === type).map((type) => (
            <div key={type} className="content-card !p-0 overflow-hidden">
              <button
                onClick={() => toggleType(type)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition"
              >
                <div className="flex items-center gap-2">
                  {expandedTypes.has(type) ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${TYPE_COLORS[type]}`}>{type}</span>
                  <span className="font-semibold text-gray-700">{grouped[type]?.length || 0} accounts</span>
                </div>
              </button>
              {expandedTypes.has(type) && grouped[type]?.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <th className="text-left px-4 py-2 font-semibold text-gray-600 w-24">Code</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Name</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600">Sub-Type</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600 w-20">Balance</th>
                        <th className="text-left px-4 py-2 font-semibold text-gray-600 w-20">Opening</th>
                        <th className="text-right px-4 py-2 font-semibold text-gray-600 w-28">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grouped[type].map((acc) => (
                        <tr key={acc._id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono theme-accent-text font-semibold">{acc.code}</td>
                          <td className="px-4 py-2 font-medium text-gray-900">
                            {acc.name}
                            {acc.isSystem && <span className="ml-2 text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">System</span>}
                          </td>
                          <td className="px-4 py-2 text-gray-600">{acc.subType || "—"}</td>
                          <td className="px-4 py-2 text-gray-600">{acc.normalBalance === "DEBIT" ? "Dr" : "Cr"}</td>
                          <td className="px-4 py-2 text-gray-700 font-medium">{(acc.openingBalance || 0).toLocaleString()}</td>
                          <td className="px-4 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <button onClick={() => startEdit(acc)} className="text-xs px-2.5 py-1 text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 font-medium transition">
                                Edit
                              </button>
                              {!acc.isSystem && (
                                <button onClick={() => handleDelete(acc._id)} className="text-xs px-2.5 py-1 text-red-700 bg-red-50 border border-red-200 rounded hover:bg-red-100 font-medium transition">
                                  Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
        </div>
      </div>
    </Layout>
  );
}
