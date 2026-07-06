"use client";

import Layout from "@/components/Layout";
import { Loader } from "@/components/ui";
import useProgress from "@/lib/useProgress";
import Link from "next/link";
import { showConfirmDialog } from "@/lib/dialogs";
import { showToastMessage } from "@/lib/toast-state";
import { formatCurrency } from "@/lib/format";
import { useState, useEffect } from "react";
import { Search, Users, Megaphone } from "lucide-react";

const EMPTY_CUSTOMER_FORM = {
  name: "",
  email: "",
  phone: "",
  address: "",
  type: "REGULAR",
  isCreditCustomer: false,
  creditLimit: "",
  creditNotes: "",
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(EMPTY_CUSTOMER_FORM);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchCustomers();
  }, []);

  useEffect(() => {
    if (!error) return;
    showToastMessage({ title: "Customers", text: error, fallbackTone: "danger" });
    setError("");
  }, [error]);

  useEffect(() => {
    if (!success) return;
    showToastMessage({ title: "Customers", text: success, fallbackTone: "success" });
    setSuccess("");
  }, [success]);

  async function fetchCustomers() {
    try {
      setLoading(true);
      start();
      onFetch();
      const res = await fetch("/api/customers");
      const data = await res.json();
      onProcess();
      setCustomers(data.customers || []);
    } catch (err) {
      console.error("Error fetching customers:", err);
      setError("Failed to load customers");
    } finally {
      complete();
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!formData.name || !formData.phone) {
      setError("Name and phone are required");
      return;
    }

    try {
      const url = editing ? `/api/customers/${editing}` : "/api/customers";
      const method = editing ? "PUT" : "POST";
      const creditEnabled = Boolean(formData.isCreditCustomer || formData.type === "CREDIT");
      const payload = {
        ...formData,
        email: formData.email?.trim() || undefined,
        type: creditEnabled ? "CREDIT" : formData.type || "REGULAR",
        isCreditCustomer: creditEnabled,
        creditLimit: Number(formData.creditLimit || 0),
        creditNotes: formData.creditNotes || "",
      };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to save customer");
      }

      setSuccess(`Customer ${editing ? "updated" : "created"} successfully!`);
  setFormData(EMPTY_CUSTOMER_FORM);
      setEditing(null);
      setShowForm(false);
      fetchCustomers();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleEdit(customer) {
    setFormData({
      ...EMPTY_CUSTOMER_FORM,
      ...customer,
      email: customer.email || "",
      address: customer.address || "",
      type: customer.isCreditCustomer || customer.type === "CREDIT" ? "CREDIT" : customer.type || "REGULAR",
      isCreditCustomer: Boolean(customer.isCreditCustomer || customer.type === "CREDIT"),
      creditLimit: customer.creditLimit ?? "",
      creditNotes: customer.creditNotes || "",
    });
    setEditing(customer._id);
    setShowForm(true);
  }

  function handleCreditToggle(checked) {
    setFormData((prev) => ({
      ...prev,
      isCreditCustomer: checked,
      type: checked ? "CREDIT" : prev.type === "CREDIT" ? "REGULAR" : prev.type,
    }));
  }

  function handleTypeChange(type) {
    setFormData((prev) => ({
      ...prev,
      type,
      isCreditCustomer: type === "CREDIT",
    }));
  }

  async function handleDelete(id) {
    const shouldDelete = await showConfirmDialog({
      title: "Delete customer?",
      message: "This customer record will be removed permanently.",
      tone: "danger",
      confirmLabel: "Delete customer",
      cancelLabel: "Keep customer",
    });
    if (!shouldDelete) return;

    try {
      const res = await fetch(`/api/customers/${id}`, { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to delete customer");
      }

      setSuccess("Customer deleted successfully!");
      fetchCustomers();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader size="lg" text="Loading customers..." progress={progress} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          {/* Header */}
          <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h1 className="page-title">Customers</h1>
            <button
              onClick={() => {
                setShowForm(!showForm);
                setEditing(null);
                setFormData(EMPTY_CUSTOMER_FORM);
              }}
              className="btn-action-primary w-full sm:w-auto"
            >
              + Add Customer
            </button>
          </div>

          {/* Search Bar */}
          <div className="content-card mb-6">
            <div className="relative">
              <input
                type="text"
                placeholder="Search by name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="form-input w-full pl-10"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" />
            </div>
            {searchQuery && (
              <p className="text-sm text-gray-500 mt-2">
                Found {customers.filter(c =>
                  c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  c.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  c.phone?.includes(searchQuery)
                ).length} result(s)
              </p>
            )}
          </div>

          {/* Navigation Links */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <Link href="/manage/customers">
              <div className="content-card hover:shadow-md cursor-pointer border-l-4 border-l-sky-600 transition-shadow">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-sky-600 flex-shrink-0" />
                  <p className="font-bold text-gray-900 text-sm md:text-base">Customers</p>
                </div>
                <p className="text-xs md:text-sm text-gray-600 mt-1">Manage all customers</p>
              </div>
            </Link>
            <Link href="/manage/promotions-management">
              <div className="content-card hover:shadow-md cursor-pointer border-l-4 border-l-sky-600 transition-shadow">
                <div className="flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-sky-600 flex-shrink-0" />
                  <p className="font-bold text-gray-900 text-sm md:text-base">Promotions &amp; Campaigns</p>
                </div>
                <p className="text-xs md:text-sm text-gray-600 mt-1">Manage customer promotions</p>
              </div>
            </Link>
          </div>

          {/* Form */}
          {showForm && (
            <div className="content-card mb-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4">
                {editing ? "Edit Customer" : "Add New Customer"}
              </h2>
              <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Customer Name *"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="form-input"
                  required
                />
                <input
                  type="email"
                  placeholder="Email Address"
                  value={formData.email || ""}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="form-input"
                />
                <input
                  type="tel"
                  placeholder="Phone Number *"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="form-input"
                  required
                />
                <input
                  type="text"
                  placeholder="Address"
                  value={formData.address || ""}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  className="form-input"
                />
                <select
                  value={formData.type}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  className="form-select"
                >
                  <option value="REGULAR">Regular Customer</option>
                  <option value="VIP">VIP Customer</option>
                  <option value="NEW">New Customer</option>
                  <option value="INACTIVE">Inactive</option>
                  <option value="BULK_BUYER">Bulk Buyer</option>
                  <option value="CREDIT">Credit Customer</option>
                </select>
                <label className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                  <span>
                    <span className="block text-sm font-semibold text-gray-900">Credit customer</span>
                    <span className="block text-xs text-gray-500">Allow this customer to use credit checkout on POS.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(formData.isCreditCustomer || formData.type === "CREDIT")}
                    onChange={(event) => handleCreditToggle(event.target.checked)}
                    className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </label>
                {Boolean(formData.isCreditCustomer || formData.type === "CREDIT") && (
                  <>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Credit Limit"
                      value={formData.creditLimit ?? ""}
                      onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })}
                      className="form-input"
                    />
                    <textarea
                      placeholder="Credit Notes"
                      value={formData.creditNotes || ""}
                      onChange={(e) => setFormData({ ...formData, creditNotes: e.target.value })}
                      className="form-input md:col-span-2 min-h-[96px]"
                    />
                  </>
                )}
                <div className="md:col-span-2 flex flex-col sm:flex-row gap-3">
                  <button
                    type="submit"
                    className="btn-action-primary flex-1"
                  >
                    {editing ? "Update" : "Create"} Customer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      setEditing(null);
                      setFormData(EMPTY_CUSTOMER_FORM);
                    }}
                    className="btn-action-secondary flex-1"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Customers Table */}
          <div className="data-table-container">
            {customers.length === 0 ? (
              <div className="empty-state">
                <p className="empty-state-title">No customers found</p>
                <p className="empty-state-description">Create one to get started!</p>
              </div>
            ) : (() => {
              const filtered = customers.filter(c =>
                !searchQuery ||
                c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                c.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                c.phone?.includes(searchQuery)
              );
              return filtered.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-gray-500 text-lg font-medium">No customers match &quot;{searchQuery}&quot;</p>
                  <p className="text-gray-400 text-sm mt-1">Try a different search term</p>
                </div>
              ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="hidden sm:table-cell">Email</th>
                    <th className="hidden lg:table-cell">Phone</th>
                    <th className="hidden xl:table-cell">Address</th>
                    <th>Type</th>
                    <th className="hidden md:table-cell text-right">Credit Balance</th>
                    <th className="text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((customer) => (
                    <tr key={customer._id}>
                      <td className="font-semibold text-gray-900">{customer.name}</td>
                      <td className="hidden sm:table-cell">{customer.email}</td>
                      <td className="hidden lg:table-cell">{customer.phone}</td>
                      <td className="hidden xl:table-cell">{customer.address || "N/A"}</td>
                      <td className="text-center">
                        <span className={`px-2 sm:px-3 py-1 rounded-full text-xs font-semibold ${
                          customer.isCreditCustomer || customer.type === "CREDIT" ? "bg-amber-100 text-amber-800" :
                          customer.type === "VIP" ? "bg-purple-100 text-purple-800" :
                          customer.type === "NEW" ? "bg-blue-100 text-blue-800" :
                          customer.type === "BULK_BUYER" ? "bg-orange-100 text-orange-800" :
                          customer.type === "INACTIVE" ? "bg-gray-100 text-gray-800" :
                          "bg-green-100 text-green-800"
                        }`}>
                          {customer.type || "REGULAR"}
                        </span>
                      </td>
                      <td className="hidden md:table-cell text-right font-semibold text-gray-800">
                        {customer.isCreditCustomer || customer.type === "CREDIT"
                          ? formatCurrency(customer.creditBalance || 0)
                          : "-"}
                      </td>
                      <td className="px-2 md:px-6 py-2 md:py-4 text-center">
                        <div className="flex justify-center gap-2">
                          <button
                            onClick={() => handleEdit(customer)}
                            className="text-xs px-3 py-1 border border-blue-500 text-blue-600 rounded-md hover:bg-blue-500 hover:text-white transition font-semibold"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(customer._id)}
                            className="text-xs px-3 py-1 border border-red-500 text-red-600 rounded-md hover:bg-red-500 hover:text-white transition font-semibold"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              );
            })()}
        </div>
      </div>
      </div>
    </Layout>
  );
}
