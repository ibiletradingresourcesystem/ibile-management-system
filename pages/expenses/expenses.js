import { useState, useEffect, useMemo } from "react";
import Layout from "@/components/Layout";
import ExpenseForm from "@/components/ExpenseForm";
import { formatCurrency } from "@/lib/format";
import { showAlertDialog } from "@/lib/dialogs";
import { RefreshCw, Search, Save, X, DollarSign } from "lucide-react";

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState([]);
  const [cashEntries, setCashEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState([]);
  const [userLocation, setUserLocation] = useState("");
  const [userName, setUserName] = useState("");

  // Filters
  const [filterLocation, setFilterLocation] = useState("All");
  const [filterDate, setFilterDate] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Cash form
  const [cashDate, setCashDate] = useState(new Date().toISOString().split("T")[0]);
  const [cashAmount, setCashAmount] = useState("");
  const [cashSaving, setCashSaving] = useState(false);

  // Inline edit
  const [editingExpense, setEditingExpense] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editingCash, setEditingCash] = useState(null);
  const [editCashAmount, setEditCashAmount] = useState("");

  // Pagination
  const [expenseLimit, setExpenseLimit] = useState(10);
  const [cashLimit, setCashLimit] = useState(10);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    setUserLocation(user.location || "");
    setUserName(user.name || "");
    fetchAll();
  }, []);

  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : "";
  const authHeaders = { Authorization: `Bearer ${token}` };

  async function fetchAll() {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${localStorage.getItem("auth_token")}` };
      const [expRes, cashRes, locRes] = await Promise.all([
        fetch("/api/expenses", { headers }),
        fetch("/api/daily-cash", { headers }),
        fetch("/api/setup/get"),
      ]);
      const expData = await expRes.json();
      setExpenses(expData.expenses || expData || []);
      const cashData = await cashRes.json();
      setCashEntries(Array.isArray(cashData) ? cashData : []);
      const locData = await locRes.json();
      if (locData.store?.locations) {
        setLocations(locData.store.locations.map(l => typeof l === "string" ? l : l.name));
      }
    } catch (err) {
      console.error("Fetch error:", err);
    }
    setLoading(false);
  }

  // === Cash Handlers ===
  const handleSaveCash = async () => {
    if (!cashAmount || Number(cashAmount) <= 0) return;
    setCashSaving(true);
    try {
      const loc = userLocation || locations[0] || "";
      const res = await fetch("/api/daily-cash", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
        body: JSON.stringify({ date: cashDate, amount: Number(cashAmount), location: loc, staffName: userName }),
      });
      if (res.ok) {
        setCashAmount("");
        fetchAll();
      }
    } catch (err) {
      console.error(err);
    }
    setCashSaving(false);
  };

  const handleEditCash = (entry) => {
    setEditingCash(entry._id);
    setEditCashAmount(String(entry.amount));
  };

  const handleSaveCashEdit = async (id) => {
    const res = await fetch(`/api/daily-cash/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      body: JSON.stringify({ amount: Number(editCashAmount) }),
    });
    if (res.ok) {
      setEditingCash(null);
      fetchAll();
    }
  };

  // === Expense Handlers ===
  const handleEditExpense = (exp) => {
    setEditingExpense(exp._id);
    setEditForm({ title: exp.title, amount: exp.amount, categoryName: exp.categoryName });
  };

  const handleSaveExpenseEdit = async (id) => {
    const res = await fetch(`/api/expenses/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      body: JSON.stringify(editForm),
    });
    if (res.ok) {
      setEditingExpense(null);
      fetchAll();
    }
  };

  const handleDeleteExpense = async (id) => {
    const confirmed = await showAlertDialog({
      title: "Delete Expense",
      message: "Are you sure you want to delete this expense?",
      tone: "danger",
      confirm: "Delete",
    });
    if (!confirmed) return;
    const res = await fetch(`/api/expenses/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
    });
    if (res.ok) fetchAll();
  };

  // === Filtered Data ===
  const filteredExpenses = useMemo(() => {
    let list = [...expenses];
    if (filterLocation !== "All") list = list.filter(e => e.locationName === filterLocation);
    if (filterDate) {
      list = list.filter(e => {
        const d = new Date(e.createdAt || e.expenseDate);
        return d.toISOString().split("T")[0] === filterDate;
      });
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(e => e.title?.toLowerCase().includes(q) || e.categoryName?.toLowerCase().includes(q));
    }
    return list;
  }, [expenses, filterLocation, filterDate, searchTerm]);

  const visibleExpenses = filteredExpenses.slice(0, expenseLimit);

  const filteredCash = useMemo(() => {
    let list = [...cashEntries];
    if (filterLocation !== "All") list = list.filter(c => c.location === filterLocation);
    return list;
  }, [cashEntries, filterLocation]);

  const visibleCash = filteredCash.slice(0, cashLimit);

  return (
    <Layout>
      <div className="page-container">
        {/* Header */}
        <div className="mb-6">
          <h1 className="page-title">Expense Management</h1>
          <p className="page-subtitle">Manage expenses and daily cash. Edit items inline by admins.</p>
        </div>

        {/* Staff Info & Filters */}
        <div className="content-card mb-4">
          <p className="text-sm text-gray-600 mb-3">Logged in: <strong>{userName}</strong> | Location: <strong>{userLocation}</strong></p>
          <div className="flex flex-wrap gap-3 items-center">
            <label className="text-sm font-medium text-gray-700">Location:</label>
            <select value={filterLocation} onChange={e => setFilterLocation(e.target.value)} className="form-select text-sm w-auto">
              <option value="All">All</option>
              {locations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <label className="text-sm font-medium text-gray-700">Date:</label>
            <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} className="form-input text-sm w-auto" />
            {filterDate && <button onClick={() => setFilterDate("")} className="text-sm text-blue-600 hover:underline">Clear</button>}
          </div>
        </div>

        {/* Add Cash for the Day */}
        <div className="content-card mb-6">
          <h2 className="text-lg font-semibold text-blue-700 mb-3 flex items-center gap-2">
            <DollarSign className="w-5 h-5" /> Add Cash for the Day
          </h2>
          <div className="flex flex-wrap gap-3 items-end">
            <input type="date" value={cashDate} onChange={e => setCashDate(e.target.value)} className="form-input w-auto" />
            <input
              type="number"
              value={cashAmount}
              onChange={e => setCashAmount(e.target.value)}
              placeholder="Enter cash amount"
              className="form-input w-48"
              onWheel={e => e.target.blur()}
            />
            <button onClick={handleSaveCash} disabled={cashSaving} className="btn-action-primary px-6">
              {cashSaving ? "Saving..." : "Save"}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">Cash received from POS or manual entry for today&apos;s operations.</p>
        </div>

        {/* Main Grid: Form + Recent Expenses + Daily Cash */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Expense Form */}
          <div>
            <ExpenseForm onSaved={fetchAll} />
          </div>

          {/* Center: Recent Expenses */}
          <div className="content-card">
            <h2 className="text-lg font-semibold text-green-700 mb-3 flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Recent Expenses
            </h2>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search expenses..."
                className="form-input pl-9 text-sm"
              />
            </div>

            {loading ? (
              <p className="text-sm text-gray-500">Loading...</p>
            ) : visibleExpenses.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No expenses found.</p>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {visibleExpenses.map(exp => (
                  <div key={exp._id} className="border border-gray-100 rounded-lg p-3 hover:shadow-sm transition">
                    {editingExpense === exp._id ? (
                      <div className="space-y-2">
                        <input value={editForm.title} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} className="form-input text-sm" />
                        <input type="number" value={editForm.amount} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} className="form-input text-sm" />
                        <div className="flex gap-2">
                          <button onClick={() => handleSaveExpenseEdit(exp._id)} className="text-xs bg-green-600 text-white px-3 py-1 rounded flex items-center gap-1"><Save className="w-3 h-3" /> Save</button>
                          <button onClick={() => setEditingExpense(null)} className="text-xs bg-gray-400 text-white px-3 py-1 rounded flex items-center gap-1"><X className="w-3 h-3" /> Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between items-start">
                          <h3 className="font-semibold text-sm text-gray-900">{exp.title}</h3>
                          <span className="font-bold text-sm text-green-700">{formatCurrency(exp.amount)}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          <span className="text-green-600">●</span> {exp.locationName || "—"} &nbsp;📅 {formatDate(exp.createdAt)}
                        </p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-medium uppercase">{exp.categoryName}</span>
                          <span className="text-xs text-gray-400">Entered by: {exp.staffName || "—"}</span>
                        </div>
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => handleEditExpense(exp)} className="text-xs border border-blue-300 text-blue-700 px-2 py-0.5 rounded hover:bg-blue-50">Edit</button>
                          <button onClick={() => handleDeleteExpense(exp._id)} className="text-xs border border-red-300 text-red-700 px-2 py-0.5 rounded hover:bg-red-50">Delete</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            {filteredExpenses.length > expenseLimit && (
              <button onClick={() => setExpenseLimit(l => l + 10)} className="mt-3 text-sm text-blue-600 hover:underline w-full text-center">
                Load more...
              </button>
            )}
          </div>

          {/* Right: Daily Cash Entries */}
          <div className="content-card">
            <h2 className="text-lg font-semibold text-orange-700 mb-3 flex items-center gap-2">
              <RefreshCw className="w-4 h-4" /> Daily Cash Entries
            </h2>

            {loading ? (
              <p className="text-sm text-gray-500">Loading...</p>
            ) : visibleCash.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No cash entries found.</p>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {visibleCash.map(entry => (
                  <div key={entry._id} className="border border-gray-100 rounded-lg p-3 hover:shadow-sm transition">
                    {editingCash === entry._id ? (
                      <div className="flex gap-2 items-center">
                        <input
                          type="number"
                          value={editCashAmount}
                          onChange={e => setEditCashAmount(e.target.value)}
                          className="form-input text-sm flex-1"
                        />
                        <button onClick={() => handleSaveCashEdit(entry._id)} className="text-xs bg-green-600 text-white px-2 py-1 rounded">Save</button>
                        <button onClick={() => setEditingCash(null)} className="text-xs bg-gray-400 text-white px-2 py-1 rounded">Cancel</button>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="font-semibold text-sm text-gray-900">Daily Cash</p>
                            <p className="text-xs text-gray-500">
                              <span className="text-green-600">●</span> {entry.location} &nbsp;📅 {formatDate(entry.date)}
                            </p>
                          </div>
                          <span className="font-bold text-sm text-green-700">{formatCurrency(entry.amount)}</span>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-medium">
                            {entry.source === "pos" ? "FROM POS" : "CASH ENTRY"}
                          </span>
                          <span className="text-xs text-gray-400">Entered by: {entry.staffName || "—"}</span>
                        </div>
                        <div className="mt-2">
                          <button onClick={() => handleEditCash(entry)} className="text-xs border border-blue-300 text-blue-700 px-2 py-0.5 rounded hover:bg-blue-50">Edit</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            {filteredCash.length > cashLimit && (
              <button onClick={() => setCashLimit(l => l + 10)} className="mt-3 text-sm text-blue-600 hover:underline w-full text-center">
                Load more...
              </button>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
