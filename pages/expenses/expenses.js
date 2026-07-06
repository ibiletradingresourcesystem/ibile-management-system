import ExpenseForm from "@/components/ExpenseForm";
import Layout from "@/components/Layout";
import { showAlertDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";
import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";
import { CalendarDays, CircleDollarSign, MapPin, User, Pencil, Trash2, X } from "lucide-react";

export default function ManageExpenses() {
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [staff, setStaff] = useState([]);
  const [assets, setAssets] = useState([]);
  const [editingExpense, setEditingExpense] = useState(null);
  const [editForm, setEditForm] = useState({
    title: "",
    amount: "",
    categoryId: "",
    categoryName: "",
    description: "",
    locationName: "",
    staffId: "",
    staffName: "",
    assetId: "",
    assetName: "",
  });
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchExpenses = async () => {
    const res = await fetch("/api/expenses");
    if (res.ok) {
      const data = await res.json();
      // Handle the response object with expenses array
      setExpenses(Array.isArray(data.expenses) ? data.expenses : []);
    } else {
      console.error("Failed to fetch expenses");
      setExpenses([]);
    }
  };

  const fetchDropdownData = async () => {
    // Fetch categories
    try {
      const catRes = await fetch("/api/expenses/expense-category");
      const catData = await catRes.json();
      setCategories(Array.isArray(catData) ? catData : []);
    } catch (err) {
      console.error("Failed to fetch categories:", err);
    }

    // Fetch locations
    try {
      const locRes = await fetch("/api/setup/get");
      const locData = await locRes.json();
      if (locData.store?.locations && Array.isArray(locData.store.locations)) {
        setLocations(locData.store.locations);
      }
    } catch (err) {
      console.error("Failed to fetch locations:", err);
    }

    // Fetch staff
    try {
      const staffRes = await fetch("/api/staff");
      const staffData = await staffRes.json();
      if (Array.isArray(staffData)) {
        setStaff(staffData);
      } else if (staffData.staff && Array.isArray(staffData.staff)) {
        setStaff(staffData.staff);
      }
    } catch (err) {
      console.error("Failed to fetch staff:", err);
    }

    // Fetch assets
    try {
      const assetRes = await fetch("/api/assets?limit=500");
      const assetData = await assetRes.json();
      setAssets(Array.isArray(assetData.assets) ? assetData.assets : []);
    } catch (err) {
      console.error("Failed to fetch assets:", err);
    }
  };

  useEffect(() => {
    fetchExpenses();
    fetchDropdownData();
  }, []);

  const handleEdit = (expense) => {
    setEditingExpense(expense);
    setEditForm({
      title: expense.title || "",
      amount: expense.amount || "",
      categoryId: expense.categoryId || "",
      categoryName: expense.categoryName || "",
      description: expense.description || "",
      locationName: expense.locationName || "",
      staffId: expense.staffId || "",
      staffName: expense.staffName || "",
      assetId: expense.assetId || "",
      assetName: expense.assetName || "",
    });
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    
    if (name === "categoryId") {
      const selectedCat = categories.find(cat => cat._id === value);
      setEditForm(prev => ({
        ...prev,
        categoryId: value,
        categoryName: selectedCat?.name || "",
      }));
    } else if (name === "staffId") {
      const selectedStaff = staff.find(s => s._id === value);
      setEditForm(prev => ({
        ...prev,
        staffId: value,
        staffName: selectedStaff?.name || "",
      }));
    } else if (name === "assetId") {
      const selectedAsset = assets.find(a => a._id === value);
      setEditForm(prev => ({
        ...prev,
        assetId: value,
        assetName: selectedAsset?.name || "",
      }));
    } else {
      setEditForm(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch(`/api/expenses/${editingExpense._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });

      if (res.ok) {
        setEditingExpense(null);
        fetchExpenses();
      } else {
        await showAlertDialog({
          title: "Update failed",
          message: "Failed to update expense.",
          tone: "danger",
        });
      }
    } catch (err) {
      console.error("Error updating expense:", err);
      await showAlertDialog({
        title: "Update failed",
        message: "Failed to update expense.",
        tone: "danger",
      });
    }

    setLoading(false);
  };

  const handleDelete = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/expenses/${id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setDeleteConfirm(null);
        fetchExpenses();
      } else {
        await showAlertDialog({
          title: "Delete failed",
          message: "Failed to delete expense.",
          tone: "danger",
        });
      }
    } catch (err) {
      console.error("Error deleting expense:", err);
      await showAlertDialog({
        title: "Delete failed",
        message: "Failed to delete expense.",
        tone: "danger",
      });
    }
    setLoading(false);
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          {/* Header */}
          <div className="page-header">
            <h1 className="page-title">Expense Management</h1>
            <p className="page-subtitle">Track and manage all business expenses</p>
          </div>

          {/* Add Expense Form */}
          <div className="mb-6">
            <ExpenseForm onSaved={fetchExpenses} />
          </div>

          {/* Expenses List */}
          <div>
            <div className="mb-4">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Recent Expenses</h2>
              <p className="text-gray-600 text-sm mt-1">Total expenses: {expenses.length}</p>
            </div>

            {expenses.length === 0 ? (
              <div className="content-card empty-state">
                <CircleDollarSign className="empty-state-icon" />
                <p className="empty-state-title">No expenses recorded yet.</p>
                <p className="empty-state-description">Add your first expense to get started.</p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {expenses.map((exp) => (
                  <div
                    key={exp._id}
                    className="content-card hover:shadow-md transition-shadow"
                  >
                    {/* Header with Title and Amount */}
                    <div className="flex justify-between items-start mb-4 pb-4 border-b border-gray-200">
                      <div className="flex items-start gap-3">
                        <CircleDollarSign className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
                        <h3 className="text-lg font-bold text-gray-900 flex-1">{exp.title}</h3>
                      </div>
                      <span className="text-xl font-bold text-green-600 whitespace-nowrap ml-2">
                        {formatCurrency(exp.amount || 0, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    </div>

                    {/* Category Badge */}
                    <div className="mb-4">
                      <span className="inline-block bg-cyan-100 text-cyan-800 px-3 py-1.5 rounded-full text-xs font-bold uppercase">
                        {exp?.categoryName || "Uncategorized"}
                      </span>
                    </div>

                    {/* Location and Date */}
                    <div className="space-y-2 mb-4 text-sm">
                      {exp.locationName && (
                        <div className="flex items-center gap-2 text-gray-700">
                          <MapPin className="w-4 h-4 text-gray-500" />
                          <span className="font-medium">{exp.locationName}</span>
                        </div>
                      )}
                      {exp.staffName && (
                        <div className="flex items-center gap-2 text-gray-700">
                          <User className="w-4 h-4 text-gray-500" />
                          <span className="font-medium">{exp.staffName}</span>
                        </div>
                      )}
                      {exp.assetName && (
                        <div className="flex items-center gap-2 text-gray-700">
                          <Wrench className="w-4 h-4 text-gray-500" />
                          <span className="font-medium">Asset: {exp.assetName}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-gray-600">
                        <CalendarDays className="w-4 h-4 text-gray-500" />
                        <span>
                          {new Date(exp.createdAt).toLocaleDateString("en-NG", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                    </div>

                    {/* Description */}
                    {exp.description && (
                      <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
                        {exp.description}
                      </p>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-2 mt-4 pt-4 border-t border-gray-200">
                      <button
                        onClick={() => handleEdit(exp)}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-sky-100 text-sky-700 rounded-lg hover:bg-sky-200 transition-colors text-sm font-medium"
                      >
                        <Pencil className="w-4 h-4" />
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(exp)}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors text-sm font-medium"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editingExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900">Edit Expense</h3>
              <button
                onClick={() => setEditingExpense(null)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-4 space-y-4">
              <div className="form-group">
                <label className="form-label">Title</label>
                <input
                  type="text"
                  name="title"
                  value={editForm.title}
                  onChange={handleEditChange}
                  required
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Amount (NGN)</label>
                <input
                  type="number"
                  name="amount"
                  value={editForm.amount}
                  onChange={handleEditChange}
                  required
                  className="form-input"
                  onWheel={(e) => e.target.blur()}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Category</label>
                <select
                  name="categoryId"
                  value={editForm.categoryId}
                  onChange={handleEditChange}
                  className="form-select"
                >
                  <option value="">Select Category</option>
                  {categories.map((cat) => (
                    <option key={cat._id} value={cat._id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Location</label>
                <select
                  name="locationName"
                  value={editForm.locationName}
                  onChange={handleEditChange}
                  className="form-select"
                >
                  <option value="">Select Location</option>
                  {locations.map((loc) => (
                    <option key={loc._id || loc.name} value={loc.name}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Staff Member</label>
                <select
                  name="staffId"
                  value={editForm.staffId}
                  onChange={handleEditChange}
                  className="form-select"
                >
                  <option value="">Select Staff</option>
                  {staff.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {editForm.categoryName?.toLowerCase().includes("maintenance") && (
                <div className="form-group">
                  <label className="form-label">Linked Asset</label>
                  <select
                    name="assetId"
                    value={editForm.assetId}
                    onChange={handleEditChange}
                    className="form-select"
                  >
                    <option value="">Select Asset</option>
                    {assets.map((a) => (
                      <option key={a._id} value={a._id}>
                        {a.name}{a.category ? ` (${a.category})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  name="description"
                  value={editForm.description}
                  onChange={handleEditChange}
                  rows={3}
                  className="form-input min-h-[80px]"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingExpense(null)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 px-4 py-2.5 bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors font-medium disabled:opacity-50"
                >
                  {loading ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <div className="text-center">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Expense?</h3>
              <p className="text-gray-600 mb-6">
                Are you sure you want to delete "{deleteConfirm.title}"? This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteConfirm._id)}
                  disabled={loading}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50"
                >
                  {loading ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

