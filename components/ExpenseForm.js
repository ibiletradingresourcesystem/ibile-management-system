import { useEffect, useState } from "react";
import { PlusCircle } from "lucide-react";
import { showAlertDialog } from "@/lib/dialogs";
import { Loader } from "@/components/ui";

export default function ExpenseForm({ onSaved }) {
  const [formData, setFormData] = useState({
    title: "",
    amount: "",
    category: "",
    description: "",
    location: "",
    staff: "",
    asset: "",
  });

  const [customCategory, setCustomCategory] = useState("");
  const [categories, setCategories] = useState([]);
  const [locations, setLocations] = useState([]);
  const [staff, setStaff] = useState([]);
  const [assets, setAssets] = useState([]);
  const [isOtherCategory, setIsOtherCategory] = useState(false);
  const [isMaintenanceCategory, setIsMaintenanceCategory] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function fetchData() {
      // Fetch categories
      const catRes = await fetch("/api/expenses/expense-category");
      const catData = await catRes.json();
      setCategories(catData);

      // Fetch locations from store
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
    }
    fetchData();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;

    if (name === "category") {
      setIsOtherCategory(value === "Other");
      if (value !== "Other") setCustomCategory("");
      // Detect maintenance category
      const selectedCat = categories.find(cat => cat._id === value);
      const isMaintenance = selectedCat?.name?.toLowerCase().includes("maintenance");
      setIsMaintenanceCategory(isMaintenance);
      if (!isMaintenance) {
        setFormData(prev => ({ ...prev, asset: "", [name]: value }));
        return;
      }
    }

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    let categoryToSave = formData.category;

    // If "Other" was selected, create the custom category first
    if (isOtherCategory && customCategory) {
      const res = await fetch("/api/expenses/expense-category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: customCategory }),
      });

      if (res.ok) {
        const updatedCats = await res.json();
        setCategories(updatedCats);
        const newCat = updatedCats.find((cat) => cat.name === customCategory)?._id;

        if (newCat) {
          categoryToSave = newCat;
        } else {
          await showAlertDialog({
            title: "Category creation failed",
            message: "Failed to find new category after creation.",
            tone: "danger",
          });
          setLoading(false);
          return;
        }
      } else {
        await showAlertDialog({
          title: "Category creation failed",
          message: "Failed to create custom category.",
          tone: "danger",
        });
        setLoading(false);
        return;
      }
    }

    // Get the category name from the selected category
    let categoryName = "";
    if (isOtherCategory) {
      categoryName = customCategory;
    } else {
      const selectedCat = categories.find(cat => cat._id === categoryToSave);
      categoryName = selectedCat?.name || formData.category;
    }

    // Get staff name
    let staffName = "";
    if (formData.staff) {
      const selectedStaff = staff.find(s => s._id === formData.staff);
      staffName = selectedStaff?.name || formData.staff;
    }

    // Get asset info if maintenance category
    let assetId = null;
    let assetName = "";
    if (isMaintenanceCategory && formData.asset) {
      const selectedAsset = assets.find(a => a._id === formData.asset);
      if (selectedAsset) {
        assetId = selectedAsset._id;
        assetName = selectedAsset.name;
      }
    }

    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: formData.title,
        amount: formData.amount,
        categoryId: categoryToSave,
        categoryName: categoryName,
        description: formData.description,
        locationId: null,
        locationName: formData.location || "",
        staffId: formData.staff || null,
        staffName: staffName || "",
        assetId: assetId,
        assetName: assetName,
      }),
    });

    if (res.ok) {
      setFormData({ title: "", amount: "", category: "", description: "", location: "", staff: "", asset: "" });
      setCustomCategory("");
      setIsOtherCategory(false);
      setIsMaintenanceCategory(false);
      onSaved && onSaved();
    } else {
      await showAlertDialog({
        title: "Save expense failed",
        message: "Failed to save expense.",
        tone: "danger",
      });
    }

    setLoading(false);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="content-card space-y-4"
    >
      {/* Header */}
      <h2 className="text-lg md:text-xl font-semibold text-gray-900 flex items-center gap-2 mb-2">
        <PlusCircle className="w-5 h-5 text-sky-600" />
        Add New Expense
      </h2>
      <p className="text-xs md:text-sm text-gray-500 mb-4">
        Record a new expense for St's Micheals operations
      </p>

      {/* Title */}
      <div className="form-group">
        <label className="form-label">Title</label>
        <input
          type="text"
          name="title"
          value={formData.title}
          onChange={handleChange}
          required
          className="form-input"
          placeholder="e.g., Fabric purchase"
        />
      </div>

      {/* Amount */}
      <div className="form-group">
        <label className="form-label">Amount (₦)</label>
        <input
          type="number"
          name="amount"
          value={formData.amount}
          onChange={handleChange}
          required
          className="form-input"
          placeholder="e.g., 15000"
          onWheel={(e) => e.target.blur()}
        />
      </div>

      {/* Category */}
      <div className="form-group">
        <label className="form-label">Category</label>
        <select
          name="category"
          value={formData.category}
          onChange={handleChange}
          required
          className="form-select"
        >
          <option value="" disabled>
            Select Category
          </option>
          {categories.map((cat) => (
            <option key={cat._id} value={cat._id}>
              {cat.name}
            </option>
          ))}
          <option value="Other">Other</option>
        </select>
      </div>

      {/* Asset Dropdown (for Maintenance categories) */}
      {isMaintenanceCategory && (
        <div className="form-group">
          <label className="form-label">Linked Asset (Optional)</label>
          <select
            name="asset"
            value={formData.asset}
            onChange={handleChange}
            className="form-select"
          >
            <option value="">Select Asset</option>
            {assets.map((a) => (
              <option key={a._id} value={a._id}>
                {a.name}{a.category ? ` (${a.category})` : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">Link this maintenance expense to a specific asset</p>
        </div>
      )}

      {/* Custom Category Input */}
      {isOtherCategory && (
        <div className="form-group">
          <label className="form-label">
            Enter Custom Category
          </label>
          <input
            type="text"
            value={customCategory}
            onChange={(e) => setCustomCategory(e.target.value)}
            required
            className="form-input"
            placeholder="e.g., Tailor Supplies"
          />
        </div>
      )}

      {/* Location */}
      <div className="form-group">
        <label className="form-label">Location</label>
        <select
          name="location"
          value={formData.location}
          onChange={handleChange}
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

      {/* Staff */}
      <div className="form-group">
        <label className="form-label">Staff Member (Optional)</label>
        <select
          name="staff"
          value={formData.staff}
          onChange={handleChange}
          className="form-select"
        >
          <option value="">Select Staff Member</option>
          {staff.map((s) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Description */}
      <div className="form-group">
        <label className="form-label">
          Description (Optional)
        </label>
        <textarea
          name="description"
          value={formData.description}
          onChange={handleChange}
          rows={3}
          className="form-input min-h-[80px]"
          placeholder="Add notes about this expense..."
        />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        className="btn-action-primary w-full"
      >
        {loading ? "Saving..." : "Add Expense"}
      </button>
    </form>
  );
}
