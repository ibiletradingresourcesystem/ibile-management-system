"use client";
import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import AccessDeniedState from "@/components/AccessDeniedState";
import { useAuth } from "@/lib/useAuth";
import { apiClient } from "@/lib/api-client";
import { showToastMessage } from "@/lib/toast-state";
import { Plus, Edit, Trash2, X, Check, UserPlus, Users, Eye, EyeOff, Shield } from "lucide-react";

const ALL_PERMISSIONS = [
  { key: "dashboard", label: "Dashboard", description: "Home dashboard access" },
  { key: "setup", label: "Setup", description: "Company details, receipts, tenders, hero/promo", children: [
    { key: "setup.company", label: "Company Details" },
    { key: "setup.hero-promo", label: "Hero-Promo Setup" },
    { key: "setup.receipts", label: "Receipts" },
    { key: "setup.pos-tenders", label: "POS Tenders" },
    { key: "setup.location-items", label: "Location Tenders" },
    { key: "setup.assets", label: "Assets" },
    { key: "setup.users", label: "Users" },
    { key: "setup.color-theme", label: "Color Theme" },
  ]},
  { key: "manage", label: "Manage", description: "Products, categories, promotions, orders, customers", children: [
    { key: "manage.products", label: "Product List" },
    { key: "manage.archived", label: "Archived Products" },
    { key: "manage.categories", label: "Categories" },
    { key: "manage.promotions", label: "Product Promotions" },
    { key: "manage.promotions-management", label: "Campaign Promotions" },
    { key: "manage.customer-promotions", label: "Customer Promotions" },
    { key: "manage.orders", label: "Orders" },
    { key: "manage.hotel-reservations", label: "Hotel Reservations" },
    { key: "manage.customers", label: "Customers" },
    { key: "manage.campaigns", label: "Campaigns" },
    { key: "manage.staff", label: "Staff" },
    { key: "manage.staff-roles", label: "Staff Roles" },
    { key: "manage.vendors", label: "Vendors" },
    { key: "manage.purchase-orders", label: "Payment Tracker" },
  ]},
  { key: "stock", label: "Stock", description: "Stock management, movement, stock take, reports", children: [
    { key: "stock.management", label: "Stock Management" },
    { key: "stock.movement", label: "Stock Movement" },
    { key: "stock.stock-take", label: "Stock Take" },
    { key: "stock.stock-take-report", label: "Stock Take Report" },
    { key: "stock.expiration-report", label: "Expiration Report" },
    { key: "stock.stock-history-levels", label: "Stock History Levels" },
  ]},
  { key: "reporting", label: "Reporting", description: "Sales reports, EOD reports, transactions", children: [
    { key: "reporting.sales-report", label: "Sales Report" },
    { key: "reporting.eod", label: "End of Day Reports" },
    { key: "reporting.time-intervals", label: "Time Intervals" },
    { key: "reporting.time-comparisons", label: "Time Comparisons" },
    { key: "reporting.products", label: "Sales by Product" },
    { key: "reporting.employees", label: "Employees" },
    { key: "reporting.locations", label: "Locations" },
    { key: "reporting.categories", label: "Categories" },
    { key: "reporting.transactions", label: "Completed Transactions" },
    { key: "reporting.stock-history-levels", label: "Stock History Levels" },
  ]},
  { key: "expenses", label: "Expenses", description: "Expense entry, analysis, tax, credit", children: [
    { key: "expenses.entry", label: "Expenses Entry" },
    { key: "expenses.analysis", label: "Expenses Analysis" },
    { key: "expenses.tax-analysis", label: "Tax Analysis" },
    { key: "expenses.tax-personal", label: "Personal Tax Calculator" },
    { key: "expenses.credit-management", label: "Credit Management" },
  ]},
  { key: "accounting", label: "Accounting", description: "Chart of accounts, journals, ledger, reports", children: [
    { key: "accounting.chart-of-accounts", label: "Chart of Accounts" },
    { key: "accounting.journal-entries", label: "Journal Entries" },
    { key: "accounting.general-ledger", label: "General Ledger" },
    { key: "accounting.reports", label: "Financial Reports" },
  ]},
  { key: "support", label: "Support", description: "Support tickets" },
];

const ROLES = [
  { value: "admin", label: "Admin", description: "Full access to everything" },
  { value: "sub-admin", label: "Sub Admin", description: "Custom access via checkboxes" },
  { value: "inventory", label: "Inventory", description: "Manage & Stock pages" },
  { value: "account", label: "Account", description: "Expenses & Reporting pages" },
  { value: "manager", label: "Manager", description: "Custom access via checkboxes" },
  { value: "staff", label: "Staff", description: "Custom access via checkboxes" },
  { value: "viewer", label: "Viewer", description: "Read-only, custom access via checkboxes" },
];

const ROLE_COLORS = {
  admin: "bg-red-100 text-red-700",
  "sub-admin": "bg-purple-100 text-purple-700",
  inventory: "bg-green-100 text-green-700",
  account: "theme-badge-soft",
  manager: "bg-yellow-100 text-yellow-700",
  staff: "bg-gray-100 text-gray-700",
  viewer: "bg-gray-50 text-gray-500",
};

function getAllPermissionKeys() {
  const keys = [];
  ALL_PERMISSIONS.forEach((p) => {
    keys.push(p.key);
    if (p.children) p.children.forEach((c) => keys.push(c.key));
  });
  return keys;
}

function getDefaultPermissions(role) {
  switch (role) {
    case "admin": return getAllPermissionKeys();
    case "inventory": return [
      "manage", "manage.products", "manage.archived", "manage.categories", "manage.vendors", "manage.purchase-orders",
      "stock", "stock.management", "stock.movement", "stock.stock-take", "stock.stock-take-report", "stock.expiration-report", "stock.stock-history-levels",
    ];
    case "account": return [
      "expenses", "expenses.entry", "expenses.analysis", "expenses.tax-analysis", "expenses.tax-personal", "expenses.credit-management",
      "reporting", "reporting.sales-report", "reporting.eod", "reporting.transactions", "reporting.stock-history-levels",
      "accounting", "accounting.chart-of-accounts", "accounting.journal-entries", "accounting.general-ledger", "accounting.reports",
    ];
    default: return [];
  }
}

export default function UsersPage() {
  const { user: currentUser, isAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showPin, setShowPin] = useState(false);

  const emptyForm = { name: "", email: "", password: "", role: "staff", permissions: [], isActive: true };
  const [form, setForm] = useState(emptyForm);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("/api/users");
      setUsers(res.data.users || []);
    } catch (err) {
      setMessage({ text: "Failed to load users", type: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  useEffect(() => {
    if (!message.text) return;
    showToastMessage({
      title: "User management",
      text: message.text,
      fallbackTone: message.type === "error" ? "danger" : "success",
    });
    setMessage({ text: "", type: "" });
  }, [message]);

  const handleRoleChange = (role) => {
    const defaults = getDefaultPermissions(role);
    setForm(prev => ({ ...prev, role, permissions: defaults }));
  };

  const togglePermission = (key) => {
    // Don't allow changing permissions for admin or preset roles
    if (form.role === "admin") return;
    if (form.role === "inventory" || form.role === "account") return;

    setForm(prev => {
      const has = prev.permissions.includes(key);
      let next = [...prev.permissions];

      if (has) {
        // Remove this key
        next = next.filter(p => p !== key);
        // If it's a parent, also remove all children
        const parent = ALL_PERMISSIONS.find(p => p.key === key);
        if (parent?.children) {
          const childKeys = parent.children.map(c => c.key);
          next = next.filter(p => !childKeys.includes(p));
        }
        // If it's a child, check if parent should be removed
        const dot = key.indexOf(".");
        if (dot > 0) {
          const parentKey = key.substring(0, dot);
          const parentDef = ALL_PERMISSIONS.find(p => p.key === parentKey);
          if (parentDef?.children) {
            const remainingChildren = parentDef.children.filter(c => next.includes(c.key));
            if (remainingChildren.length === 0) {
              next = next.filter(p => p !== parentKey);
            }
          }
        }
      } else {
        // Add this key
        next.push(key);
        // If it's a parent, also add all children
        const parent = ALL_PERMISSIONS.find(p => p.key === key);
        if (parent?.children) {
          parent.children.forEach(c => {
            if (!next.includes(c.key)) next.push(c.key);
          });
        }
        // If it's a child, ensure parent is also included
        const dot = key.indexOf(".");
        if (dot > 0) {
          const parentKey = key.substring(0, dot);
          if (!next.includes(parentKey)) next.push(parentKey);
        }
      }

      return { ...prev, permissions: next };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email) {
      setMessage({ text: "Name and email are required", type: "error" });
      return;
    }
    if (!editingUser && !form.password) {
      setMessage({ text: "PIN is required for new users", type: "error" });
      return;
    }
    if (form.password && !/^\d{4}$/.test(form.password)) {
      setMessage({ text: "PIN must be exactly 4 digits", type: "error" });
      return;
    }

    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;

      if (editingUser) {
        await apiClient.put(`/api/users/${editingUser._id}`, payload);
        setMessage({ text: "User updated successfully", type: "success" });
      } else {
        await apiClient.post("/api/users", payload);
        setMessage({ text: "User created successfully", type: "success" });
      }
      setShowForm(false);
      setEditingUser(null);
      setForm(emptyForm);
      setShowPin(false);
      fetchUsers();
    } catch (err) {
      setMessage({ text: err.response?.data?.error || "Failed to save user", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (u) => {
    setEditingUser(u);
    setForm({
      name: u.name,
      email: u.email,
      password: "",
      role: u.role,
      permissions: u.permissions || [],
      isActive: u.isActive,
    });
    setShowPin(false);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    try {
      await apiClient.delete(`/api/users/${id}`);
      setMessage({ text: "User deleted", type: "success" });
      setDeleteConfirm(null);
      fetchUsers();
    } catch (err) {
      setMessage({ text: err.response?.data?.error || "Failed to delete user", type: "error" });
    }
  };

  const handleToggleActive = async (u) => {
    try {
      await apiClient.put(`/api/users/${u._id}`, { isActive: !u.isActive });
      fetchUsers();
    } catch (err) {
      setMessage({ text: err.response?.data?.error || "Failed to update user", type: "error" });
    }
  };

  if (!isAdmin) {
    return (
      <Layout title="Users">
        <AccessDeniedState message="Only administrators can access user management." />
      </Layout>
    );
  }

  const isFixedPermissions = form.role === "admin" || form.role === "inventory" || form.role === "account";

  return (
    <Layout title="User Management">
      <div className="max-w-6xl mx-auto py-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              User Management
            </h1>
            <p className="text-gray-500 text-sm mt-1">Create and manage system users with different access levels</p>
          </div>
          <button
            onClick={() => { setShowForm(true); setEditingUser(null); setForm(emptyForm); setShowPin(false); }}
            className="btn-action-primary flex items-center gap-2 px-4 py-2 transition font-semibold"
          >
            <UserPlus size={18} /> Add User
          </button>
        </div>

        {/* Users Table */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader size="lg" text="Loading users..." /></div>
        ) : (
          <div className="overflow-x-auto cursor-grab active:cursor-grabbing" style={{ WebkitOverflowScrolling: "touch" }}>
            <table className="w-full text-sm bg-white rounded-xl shadow border border-gray-200">
              <thead className="table-header-gradient text-white">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-white">Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-white">Email</th>
                  <th className="px-4 py-3 text-left font-semibold text-white">Role</th>
                  <th className="px-4 py-3 text-left font-semibold text-white">Permissions</th>
                  <th className="px-4 py-3 text-left font-semibold text-white">Status</th>
                  <th className="px-4 py-3 text-right font-semibold text-white">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u._id} className="border-b border-gray-100 hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${ROLE_COLORS[u.role] || "bg-gray-100 text-gray-700"}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(u.permissions || []).filter(p => !p.includes(".")).map(p => (
                          <span key={p} className="theme-badge-soft px-1.5 py-0.5 rounded text-xs">{p}</span>
                        ))}
                        {(!u.permissions || u.permissions.filter(p => !p.includes(".")).length === 0) && (
                          <span className="text-gray-400 text-xs">No permissions</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(u)}
                        disabled={u._id === currentUser?.id}
                        className={`px-2 py-1 rounded-full text-xs font-semibold transition ${u.isActive ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-red-100 text-red-600 hover:bg-red-200"} ${u._id === currentUser?.id ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                      >
                        {u.isActive ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => startEdit(u)} className="theme-toggle-neutral px-3 py-1.5 text-sm rounded-lg transition font-medium border">
                          Edit
                        </button>
                        {u._id !== currentUser?.id && (
                          <button onClick={() => setDeleteConfirm(u._id)} className="px-3 py-1.5 text-sm text-red-500 bg-red-50 hover:bg-red-100 rounded-lg transition font-medium">
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-10 text-gray-400">No users found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Delete Confirmation */}
        {deleteConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
            <div className="bg-white rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Delete User?</h3>
              <p className="text-gray-600 text-sm mb-4">This action cannot be undone. The user will lose all access.</p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition">Cancel</button>
                <button onClick={() => handleDelete(deleteConfirm)} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition">Delete</button>
              </div>
            </div>
          </div>
        )}

        {/* Create/Edit Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => { setShowForm(false); setEditingUser(null); }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-xl">
                <h2 className="text-xl font-bold text-gray-900">{editingUser ? "Edit User" : "Create New User"}</h2>
                <button onClick={() => { setShowForm(false); setEditingUser(null); }} className="p-1 hover:bg-gray-100 rounded-full transition">
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-5">
                {/* Name & Email */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Full Name *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                      className="form-input"
                      placeholder="John Doe"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Email *</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                      className="form-input"
                      placeholder="user@email.com"
                      required
                    />
                  </div>
                </div>

                {/* PIN & Role */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">
                      4-Digit PIN {editingUser ? "(leave blank to keep)" : "*"}
                    </label>
                    <div className="relative">
                      <input
                        type={showPin ? "text" : "password"}
                        value={form.password}
                        onChange={e => {
                          const val = e.target.value.replace(/\D/g, "").slice(0, 4);
                          setForm(prev => ({ ...prev, password: val }));
                        }}
                        className="form-input pr-10 text-center text-xl tracking-widest"
                        placeholder="••••"
                        inputMode="numeric"
                        maxLength={4}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPin(!showPin)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Role *</label>
                    <select
                      value={form.role}
                      onChange={e => handleRoleChange(e.target.value)}
                      className="form-input"
                    >
                      {ROLES.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-400 mt-1">
                      {ROLES.find(r => r.value === form.role)?.description}
                    </p>
                  </div>
                </div>

                {/* Active toggle */}
                {editingUser && (
                  <div className="flex items-center gap-3">
                    <label className="text-sm font-semibold text-gray-700">Account Active</label>
                    <button
                      type="button"
                      onClick={() => setForm(prev => ({ ...prev, isActive: !prev.isActive }))}
                      className={`relative w-12 h-6 rounded-full transition ${form.isActive ? "bg-green-500" : "bg-gray-300"}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition ${form.isActive ? "left-6" : "left-0.5"}`} />
                    </button>
                    <span className={`text-sm ${form.isActive ? "text-green-600" : "text-red-500"}`}>
                      {form.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                )}

                {/* Permissions Checkboxes */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                    <Shield size={16} /> Page Access Permissions
                  </label>
                  {isFixedPermissions && (
                    <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg mb-3">
                      {form.role === "admin" ? "Admin has full access to all pages." : `${form.role === "inventory" ? "Inventory" : "Account"} role has preset permissions.`}
                    </p>
                  )}
                  <div className="space-y-3">
                    {ALL_PERMISSIONS.map(p => {
                      const checked = form.permissions.includes(p.key);
                      const disabled = isFixedPermissions;
                      return (
                        <div key={p.key} className={`rounded-lg border-2 transition ${checked ? "border-blue-500 bg-blue-50/50" : "border-gray-200"} ${disabled ? "opacity-60" : ""}`}>
                          <label className={`flex items-start gap-3 p-3 cursor-pointer ${disabled ? "cursor-not-allowed" : ""}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePermission(p.key)}
                              disabled={disabled}
                              className="mt-0.5 w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                            />
                            <div>
                              <div className="text-sm font-semibold text-gray-800">{p.label}</div>
                              <div className="text-xs text-gray-500">{p.description}</div>
                            </div>
                          </label>
                          {p.children && checked && !disabled && (
                            <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-3 gap-2 border-t border-gray-200 pt-2 ml-7">
                              {p.children.map(c => {
                                const cChecked = form.permissions.includes(c.key);
                                return (
                                  <label key={c.key} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition ${cChecked ? "theme-badge-soft" : "bg-gray-50 text-gray-600 hover:bg-gray-100"}`}>
                                    <input
                                      type="checkbox"
                                      checked={cChecked}
                                      onChange={() => togglePermission(c.key)}
                                      className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                    />
                                    {c.label}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                          {p.children && checked && disabled && (
                            <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-3 gap-2 border-t border-gray-200 pt-2 ml-7">
                              {p.children.map(c => {
                                const cChecked = form.permissions.includes(c.key);
                                return (
                                  <label key={c.key} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-not-allowed ${cChecked ? "theme-badge-soft" : "bg-gray-50 text-gray-600"}`}>
                                    <input type="checkbox" checked={cChecked} disabled className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300" />
                                    {c.label}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 justify-end pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => { setShowForm(false); setEditingUser(null); }}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition font-medium"
                  >
                    Cancel
                  </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="btn-action-primary px-6 py-2 transition font-semibold disabled:opacity-50 flex items-center gap-2"
                    >
                    {saving ? <Loader size="sm" /> : <Check size={18} />}
                    {editingUser ? "Update User" : "Create User"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
