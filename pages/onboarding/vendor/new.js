import { useState } from "react";
import Head from "next/head";

export default function VendorOnboardingForm() {
  const [form, setForm] = useState({
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
    products: [{ productName: "", price: "" }],
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

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
      products: [...prev.products, { productName: "", price: "" }],
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
    setError("");
    if (!form.companyName.trim()) return setError("Company/Business name is required.");
    if (!form.repPhone.trim()) return setError("Phone number is required.");

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        vendorType: "petty-cash",
        products: form.products.filter((p) => p.productName?.trim()),
      };
      const res = await fetch("/api/vendors/public-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to register");
      }
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <>
        <Head><title>Registration Complete</title></Head>
        <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-6">
          <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">✅</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Registration Complete!</h1>
            <p className="text-gray-600">
              Thank you, <strong>{form.companyName}</strong>. Your vendor profile has been submitted successfully.
              You will be contacted when there are orders.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head><title>Vendor Registration Form</title></Head>
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white py-8 px-4">
        <div className="max-w-xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-2xl">🏪</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Vendor Registration</h1>
            <p className="text-sm text-gray-500 mt-1">Fill in your details to register as a vendor</p>
          </div>

          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border p-6 space-y-5">
            {/* Contact Info */}
            <div>
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Contact Information</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-gray-600">Business/Company Name *</label>
                  <input name="companyName" value={form.companyName} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2.5 text-sm mt-1" placeholder="Your business name" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Contact Person</label>
                  <input name="vendorRep" value={form.vendorRep} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm mt-1" placeholder="Full name" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Phone Number *</label>
                  <input name="repPhone" value={form.repPhone} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2.5 text-sm mt-1" placeholder="08012345678" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Email (optional)</label>
                  <input name="email" type="email" value={form.email} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm mt-1" placeholder="vendor@email.com" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Address</label>
                  <input name="address" value={form.address} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm mt-1" placeholder="Business address" />
                </div>
              </div>
            </div>

            {/* Products & Pricing */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Products & Pricing</h2>
                <button type="button" onClick={addProduct} className="text-xs text-blue-600 font-medium hover:underline">+ Add Product</button>
              </div>
              <div className="space-y-2">
                {form.products.map((p, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      value={p.productName}
                      onChange={(e) => handleProductChange(i, "productName", e.target.value)}
                      placeholder="Product/Service name"
                      className="flex-1 border rounded-lg px-3 py-2 text-sm"
                    />
                    <input
                      type="number"
                      value={p.price}
                      onChange={(e) => handleProductChange(i, "price", e.target.value)}
                      placeholder="Price (₦)"
                      className="w-28 border rounded-lg px-3 py-2 text-sm"
                    />
                    {form.products.length > 1 && (
                      <button type="button" onClick={() => removeProduct(i)} className="text-red-500 text-lg px-2 hover:bg-red-50 rounded">×</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Business Category */}
            <div>
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Business Details</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Main Product/Service</label>
                  <input name="mainProduct" value={form.mainProduct} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm mt-1" placeholder="e.g. Food, Cleaning" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Category</label>
                  <input name="businessCategory" value={form.businessCategory} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm mt-1" placeholder="e.g. Food Vendor" />
                </div>
              </div>
            </div>

            {/* Bank Details */}
            <div>
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Bank Details (for payment)</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Bank Name</label>
                  <input name="bankName" value={form.bankName} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Account Name</label>
                  <input name="accountName" value={form.accountName} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Account Number</label>
                  <input name="accountNumber" value={form.accountNumber} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm mt-1" />
                </div>
              </div>
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition"
            >
              {submitting ? "Registering..." : "Submit Registration"}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-6">Powered by Ibile Management System</p>
        </div>
      </div>
    </>
  );
}

// No auth required - this is a public page
VendorOnboardingForm.getLayout = (page) => page;
