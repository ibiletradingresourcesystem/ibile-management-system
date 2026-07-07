import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import { Pencil, Check, PlusCircle, X } from "lucide-react";

export default function CategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [newCategory, setNewCategory] = useState("");
  const [editName, setEditName] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/expenses/expense-category");
      if (res.ok) {
        const data = await res.json();
        setCategories(data);
      }
    } catch (err) {
      console.error("Failed to fetch categories:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleAdd = async () => {
    if (!newCategory.trim()) return;
    const res = await fetch("/api/expenses/expense-category", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCategory }),
    });
    if (res.ok) {
      setNewCategory("");
      fetchCategories();
    }
  };

  const handleSave = async (id) => {
    if (!editName.trim()) return;
    const token = localStorage.getItem("auth_token");
    const res = await fetch(`/api/expenses/expense-category/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: editName }),
    });
    if (res.ok) {
      setEditingId(null);
      fetchCategories();
    }
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="page-title">Expense Categories</h1>
          <p className="page-subtitle">Create and manage categories to organize your business spending.</p>
        </div>

        {/* Add New Category */}
        <div className="content-card mb-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <input
              type="text"
              placeholder="Enter category name"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className="form-input flex-1"
            />
            <button
              onClick={handleAdd}
              className="btn-action-primary flex items-center justify-center gap-2 px-5"
            >
              <PlusCircle className="w-4 h-4" />
              Add Category
            </button>
          </div>
        </div>

        {/* Category List */}
        <div className="content-card">
          {loading ? (
            <p className="text-sm text-gray-500 text-center py-6">Loading categories...</p>
          ) : categories.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6 italic">No categories available. Start by adding one above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="py-3 text-left text-gray-700 font-semibold">Category Name</th>
                    <th className="py-3 text-right text-gray-700 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((cat) => (
                    <tr key={cat._id} className="border-b border-gray-50 hover:bg-blue-50/30 transition">
                      <td className="py-3">
                        {editingId === cat._id ? (
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSave(cat._id)}
                            className="form-input text-sm w-full max-w-xs"
                            autoFocus
                          />
                        ) : (
                          <span className="text-gray-800 font-medium">{cat.name}</span>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-2">
                          {editingId === cat._id ? (
                            <>
                              <button
                                onClick={() => handleSave(cat._id)}
                                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md flex items-center gap-1 text-xs transition"
                              >
                                <Check className="w-3.5 h-3.5" /> Save
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="bg-gray-300 hover:bg-gray-400 text-gray-900 px-3 py-1 rounded-md flex items-center gap-1 text-xs transition"
                              >
                                <X className="w-3.5 h-3.5" /> Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => { setEditingId(cat._id); setEditName(cat.name); }}
                              className="bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-md flex items-center gap-1 text-xs transition"
                            >
                              <Pencil className="w-3.5 h-3.5" /> Edit
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
        </div>
      </div>
    </Layout>
  );
}
