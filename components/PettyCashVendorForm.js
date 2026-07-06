import { useState } from "react";

export default function PettyCashVendorForm({ onSubmit, editingVendor, onCancel }) {
  const [form, setForm] = useState(
    editingVendor || {
      companyName: "",
      vendorRep: "",
      repPhone: "",
      email: "",
      address: "",
      mainProduct: "",
      businessCategory: "",
      bankName: "",
      accountName: "",
      accountNumber: "",
      products: [],
    }
  );
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleProductChange = (index, field, value) => {
    setForm((prev) => {
      const products = [...prev.products];
      products[index] = { ...products[index], [field]: value };
      return { ...prev, products };
    });
  };

  const addProduct = () => {
    setForm((prev) => ({
      ...prev,
      products: [...prev.products, { productName: "", price: 0 }],
    }));
  };

  const removeProduct = (index) => {
    setForm((prev) => ({
      ...prev,
      products: prev.products.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.companyName?.trim()) return alert("Company name is required.");
    setSubmitting(true);
    try {
      await onSubmit({ ...form, vendorType: "petty-cash" });
      if (!editingVendor) {
        setForm({
          companyName: "",
          vendorRep: "",
          repPhone: "",
          email: "",
          address: "",
          mainProduct: "",
          businessCategory: "",
          bankName: "",
          accountName: "",
          accountNumber: "",
          products: [],
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-5 space-y-4">
      <h3 className="font-bold text-base">
        {editingVendor ? "Edit Vendor" : "Add Petty Cash Vendor"}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600">Company Name *</label>
          <input
            name="companyName"
            value={form.companyName}
            onChange={handleChange}
            required
            className="w-full border rounded px-3 py-2 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Representative</label>
          <input
            name="vendorRep"
            value={form.vendorRep}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Phone</label>
          <input
            name="repPhone"
            value={form.repPhone}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Email</label>
          <input
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Main Product/Service</label>
          <input
            name="mainProduct"
            value={form.mainProduct}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Business Category</label>
          <input
            name="businessCategory"
            value={form.businessCategory}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2 text-sm mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Address</label>
          <input
            name="address"
            value={form.address}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2 text-sm mt-1"
          />
        </div>
      </div>

      {/* Bank Details */}
      <div className="border-t pt-3">
        <p className="text-xs font-semibold text-gray-500 mb-2">BANK DETAILS</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600">Bank Name</label>
            <input
              name="bankName"
              value={form.bankName}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2 text-sm mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Account Name</label>
            <input
              name="accountName"
              value={form.accountName}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2 text-sm mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Account Number</label>
            <input
              name="accountNumber"
              value={form.accountNumber}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2 text-sm mt-1"
            />
          </div>
        </div>
      </div>

      {/* Products */}
      <div className="border-t pt-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500">PRODUCTS / SERVICES</p>
          <button
            type="button"
            onClick={addProduct}
            className="text-xs text-blue-600 font-medium hover:underline"
          >
            + Add Product
          </button>
        </div>
        {form.products.map((p, i) => (
          <div key={i} className="flex gap-2 items-center mb-2">
            <input
              value={p.productName || ""}
              onChange={(e) => handleProductChange(i, "productName", e.target.value)}
              placeholder="Product name"
              className="flex-1 border rounded px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              value={p.price || 0}
              onChange={(e) => handleProductChange(i, "price", Number(e.target.value))}
              placeholder="Price"
              className="w-24 border rounded px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => removeProduct(i)}
              className="text-red-500 text-sm px-2 hover:bg-red-50 rounded"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 border rounded py-2 text-sm font-medium hover:bg-gray-50"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 bg-blue-600 text-white rounded py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Saving..." : editingVendor ? "Update Vendor" : "Add Vendor"}
        </button>
      </div>
    </form>
  );
}
