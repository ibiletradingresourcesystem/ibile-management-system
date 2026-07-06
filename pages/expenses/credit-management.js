import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import { formatCurrency } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";
import { CreditCard, Plus, RefreshCw, Search, WalletCards } from "lucide-react";

function todayKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function statusLabel(status) {
  switch (status) {
    case "partly_paid": return "Partly paid";
    case "paid": return "Recovered";
    case "written_off": return "Written off";
    case "open": return "Open";
    default: return "Open";
  }
}

function statusClass(status) {
  switch (status) {
    case "paid": return "bg-emerald-100 text-emerald-800";
    case "partly_paid": return "bg-amber-100 text-amber-800";
    case "written_off": return "bg-gray-100 text-gray-700";
    default: return "bg-blue-100 text-blue-800";
  }
}

export default function CreditManagement() {
  const [data, setData] = useState({ credits: [], customers: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [filters, setFilters] = useState({ search: "", status: "" });
  const [customerForm, setCustomerForm] = useState({ name: "", phone: "", email: "", address: "", creditLimit: "", creditNotes: "" });
  const [debtForm, setDebtForm] = useState({ customerId: "", amount: "", dueDate: "", reference: "", notes: "" });
  const [paymentForm, setPaymentForm] = useState({ transactionId: "", amount: "", tenderType: "", reference: "", notes: "", paidAt: todayKey() });
  const [tenders, setTenders] = useState([]);

  const fetchTenders = async () => {
    try {
      const res = await fetch("/api/setup/tenders");
      if (res.ok) {
        const result = await res.json();
        const list = result.tenders || [];
        setTenders(list);
        if (list.length > 0 && !paymentForm.tenderType) {
          setPaymentForm((prev) => ({ ...prev, tenderType: list[0].name }));
        }
      }
    } catch {}
  };

  const fetchCredits = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/credits");
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load credits");
      setData(result);
    } catch (error) {
      console.error("Credit management fetch failed:", error);
      setMessage({ type: "error", text: error.message || "Unable to load credits" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCredits();
    fetchTenders();
  }, []);

  const filteredCredits = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return (data.credits || []).filter((credit) => {
      if (filters.status === "active" && ["paid", "written_off"].includes(credit.creditStatus)) return false;
      if (filters.status !== "active" && filters.status && credit.creditStatus !== filters.status) return false;
      if (!search) return true;
      return `${credit.customerName || ""} ${credit.customerPhone || ""} ${credit.location || ""}`.toLowerCase().includes(search);
    });
  }, [data.credits, filters]);

  const postAction = async (payload, successText) => {
    setSaving(true);
    setMessage({ type: "", text: "" });
    try {
      const response = await fetch("/api/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Request failed");
      setMessage({ type: "success", text: successText });
      await fetchCredits();
      return true;
    } catch (error) {
      console.error("Credit action failed:", error);
      setMessage({ type: "error", text: error.message || "Request failed" });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const createCustomer = async (event) => {
    event.preventDefault();
    const ok = await postAction({ action: "create-customer", ...customerForm }, "Credit customer created.");
    if (ok) setCustomerForm({ name: "", phone: "", email: "", address: "", creditLimit: "", creditNotes: "" });
  };

  const createDebt = async (event) => {
    event.preventDefault();
    const ok = await postAction({ action: "create-debt", ...debtForm }, "Credit debt recorded.");
    if (ok) setDebtForm({ customerId: "", amount: "", dueDate: "", reference: "", notes: "" });
  };

  const recordPayment = async (event) => {
    event.preventDefault();
    const ok = await postAction({ action: "record-payment", ...paymentForm }, "Credit payment recorded.");
    if (ok) setPaymentForm({ transactionId: "", amount: "", tenderType: tenders[0]?.name || "", reference: "", notes: "", paidAt: todayKey() });
  };

  const selectedCredit = (data.credits || []).find((credit) => credit._id === paymentForm.transactionId);
  const summary = data.summary || {};

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          <div className="page-header">
            <h1 className="page-title">Credit Management</h1>
            <p className="page-subtitle">Track credit customers, outstanding debt, and recovery payments.</p>
          </div>

          {message.text && (
            <div className={`content-card mb-6 border-l-4 ${message.type === "success" ? "border-emerald-500 text-emerald-700" : "border-red-500 text-red-700"}`}>
              {message.text}
            </div>
          )}

          <div className="mb-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            <div className="content-card border-l-4 border-blue-500 p-5 md:p-6">
              <p className="text-xs font-semibold text-gray-500 uppercase">Credit Customers</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{summary.creditCustomers || 0}</p>
            </div>
            <div className="content-card border-l-4 border-amber-500 p-5 md:p-6">
              <p className="text-xs font-semibold text-gray-500 uppercase">Outstanding</p>
              <p className="mt-1 text-2xl font-bold text-amber-700">{formatCurrency(summary.outstandingBalance || 0)}</p>
            </div>
            <div className="content-card border-l-4 border-emerald-500 p-5 md:p-6">
              <p className="text-xs font-semibold text-gray-500 uppercase">Recovered</p>
              <p className="mt-1 text-2xl font-bold text-emerald-700">{formatCurrency(summary.totalRecovered || 0)}</p>
            </div>
            <div className="content-card border-l-4 border-purple-500 p-5 md:p-6">
              <p className="text-xs font-semibold text-gray-500 uppercase">Credit Issued</p>
              <p className="mt-1 text-2xl font-bold text-purple-700">{formatCurrency(summary.totalCreditIssued || 0)}</p>
            </div>
          </div>

          <div className="mb-8 grid grid-cols-1 gap-6 xl:grid-cols-3">
            <form onSubmit={createCustomer} className="content-card space-y-4 p-5 md:p-6">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Plus className="w-5 h-5 text-blue-600" /> Create Credit Customer</h2>
              <input required placeholder="Customer name" value={customerForm.name} onChange={(event) => setCustomerForm((prev) => ({ ...prev, name: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              <input required placeholder="Phone" value={customerForm.phone} onChange={(event) => setCustomerForm((prev) => ({ ...prev, phone: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              <input type="email" placeholder="Email" value={customerForm.email} onChange={(event) => setCustomerForm((prev) => ({ ...prev, email: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              <input placeholder="Address" value={customerForm.address} onChange={(event) => setCustomerForm((prev) => ({ ...prev, address: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              <input type="number" min="0" placeholder="Credit limit" value={customerForm.creditLimit} onChange={(event) => setCustomerForm((prev) => ({ ...prev, creditLimit: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              <textarea placeholder="Notes" value={customerForm.creditNotes} onChange={(event) => setCustomerForm((prev) => ({ ...prev, creditNotes: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows={3} />
              <button disabled={saving} className="btn-action-primary w-full">Create Customer</button>
            </form>

            <form onSubmit={createDebt} className="content-card space-y-4 p-5 md:p-6">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><CreditCard className="w-5 h-5 text-amber-600" /> Record Credit Debt</h2>
              <select required value={debtForm.customerId} onChange={(event) => setDebtForm((prev) => ({ ...prev, customerId: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="">Select credit customer</option>
                {(data.customers || []).map((customer) => (
                  <option key={customer._id} value={customer._id}>{customer.name} · {customer.phone}</option>
                ))}
              </select>
              <input required type="number" min="1" placeholder="Amount" value={debtForm.amount} onChange={(event) => setDebtForm((prev) => ({ ...prev, amount: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              <input type="date" value={debtForm.dueDate} onChange={(event) => setDebtForm((prev) => ({ ...prev, dueDate: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              <input placeholder="Reference" value={debtForm.reference} onChange={(event) => setDebtForm((prev) => ({ ...prev, reference: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              <textarea placeholder="Notes" value={debtForm.notes} onChange={(event) => setDebtForm((prev) => ({ ...prev, notes: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows={3} />
              <button disabled={saving} className="btn-action-primary w-full">Record Debt</button>
            </form>

            <form onSubmit={recordPayment} className="content-card space-y-4 p-5 md:p-6">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><WalletCards className="w-5 h-5 text-emerald-600" /> Record Recovery</h2>
              <select required value={paymentForm.transactionId} onChange={(event) => setPaymentForm((prev) => ({ ...prev, transactionId: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="">Select open credit</option>
                {(data.credits || []).filter((credit) => !["paid", "written_off"].includes(credit.creditStatus)).map((credit) => (
                  <option key={credit._id} value={credit._id}>{credit.customerName} · Balance {formatCurrency(credit.creditBalance || 0)}</option>
                ))}
              </select>
              {selectedCredit && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800">
                  Original: {formatCurrency(selectedCredit.creditOriginalTotal || 0)} · Recovered: {formatCurrency(selectedCredit.creditPaidAmount || 0)} · Balance: {formatCurrency(selectedCredit.creditBalance || 0)}
                </div>
              )}
              <input required type="number" min="1" placeholder="Payment amount" value={paymentForm.amount} onChange={(event) => setPaymentForm((prev) => ({ ...prev, amount: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              <select required value={paymentForm.tenderType} onChange={(event) => setPaymentForm((prev) => ({ ...prev, tenderType: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                <option value="">Select payment type</option>
                {tenders.map((tender) => (
                  <option key={tender._id} value={tender.name}>{tender.name}</option>
                ))}
              </select>
              <input type="date" value={paymentForm.paidAt} onChange={(event) => setPaymentForm((prev) => ({ ...prev, paidAt: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              <input placeholder="Reference" value={paymentForm.reference} onChange={(event) => setPaymentForm((prev) => ({ ...prev, reference: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
              <textarea placeholder="Notes" value={paymentForm.notes} onChange={(event) => setPaymentForm((prev) => ({ ...prev, notes: event.target.value }))} className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows={2} />
              <button disabled={saving} className="btn-action-primary w-full">Record Payment</button>
            </form>
          </div>

          <div className="content-card p-5 md:p-6">
            <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Credit Recovery Report</h2>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="Search customer" className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg" />
                </div>
                <select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))} className="px-3 py-2 border border-gray-300 rounded-lg">
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="open">Open</option>
                  <option value="partly_paid">Partly paid</option>
                  <option value="paid">Recovered</option>
                  <option value="written_off">Written off</option>
                </select>
                <button onClick={fetchCredits} className="btn-action-secondary flex items-center justify-center gap-2"><RefreshCw className="w-4 h-4" /> Refresh</button>
              </div>
            </div>

            {loading ? (
              <Loader text="Loading credit records..." />
            ) : filteredCredits.length === 0 ? (
              <div className="p-6 text-gray-500">No credit records found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table min-w-[1100px]">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th className="text-right">Original</th>
                      <th className="text-right">Recovered</th>
                      <th className="text-right">Balance</th>
                      <th>Payments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCredits.map((credit) => (
                      <tr key={credit._id}>
                        <td>
                          <div className="font-semibold text-gray-900">{credit.customerName}</div>
                          <div className="text-xs text-gray-500">{credit.customerPhone || credit.location || "Credit customer"}</div>
                        </td>
                        <td>{credit.createdAt ? new Date(credit.createdAt).toLocaleDateString() : "-"}</td>
                        <td><span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusClass(credit.creditStatus)}`}>{statusLabel(credit.creditStatus)}</span></td>
                        <td className="text-right font-semibold">{formatCurrency(credit.creditOriginalTotal || 0)}</td>
                        <td className="text-right text-emerald-700 font-semibold">{formatCurrency(credit.creditPaidAmount || 0)}</td>
                        <td className="text-right text-amber-700 font-semibold">{formatCurrency(credit.creditBalance || 0)}</td>
                        <td className="text-sm text-gray-600">
                          {credit.creditPayments?.length ? credit.creditPayments.map((payment) => `#${payment.sequence || 1} ${formatCurrency(payment.amount || 0)}`).join(" · ") : "No recovery yet"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}