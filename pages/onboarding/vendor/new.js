import { useState, useEffect } from "react";
import Head from "next/head";

/** The vendor agreement, as the business words it. */
const AGREEMENT = [
  ["Accurate business details", "All company, representative, contact, and bank details submitted on this form should be complete, current, and accurate."],
  ["Approved petty cash only", "Payments will only be processed for petty cash requests that have been approved internally and matched to the registered vendor record."],
  ["Supporting documents", "The vendor is expected to provide quotations, invoices, receipts, and delivery confirmation where required before an order is confirmed and before payment is released."],
  ["Registered payment account", "Ibile will only pay into the bank account submitted on this form unless the vendor provides an approved update or comes to the store for direct cash payment."],
  ["Compliance and conduct", "False information, inflated pricing, or failure to deliver agreed goods or services may lead to suspension or termination of further business with Ibile."],
  ["Returns and product quality", "All products supplied are expected to be fit for sale and customer use. Any product found to be defective, damaged, expired, or the subject of customer complaints will be returned or rejected."],
  ["Contact and record keeping", "By submitting the form, the vendor authorizes Ibilemart to contact the representative provided and to keep the submitted record for operational and audit purposes."],
];

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
    termsAccepted: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [storeLogo, setStoreLogo] = useState("");
  const [businessName, setBusinessName] = useState("");

  useEffect(() => {
    fetch("/api/setup/get")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.store?.logo) setStoreLogo(data.store.logo);
        if (data?.store?.companyName || data?.store?.storeName) {
          setBusinessName(data.store.companyName || data.store.storeName);
        }
      })
      .catch(() => {});
  }, []);

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
    if (!form.termsAccepted) return setError("You must accept the terms and conditions.");

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
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            {storeLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={storeLogo} alt={businessName || "Business"} className="h-16 w-auto mx-auto mb-3 object-contain" />
            ) : (
              <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">🏪</span>
              </div>
            )}
            <h1 className="text-2xl font-bold text-gray-900">Vendor Registration</h1>
            <p className="text-sm text-gray-500 mt-1">
              {businessName ? `Register as a vendor for ${businessName}` : "Fill in your details to register as a vendor"}
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Form (2/3 width on desktop) */}
          <form onSubmit={handleSubmit} className="order-2 lg:order-1 lg:col-span-2 bg-white rounded-xl shadow-sm border p-6 space-y-5">
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

            {/* The agreement gates the submit, so it sits directly above the button
                rather than beside terms that are on the right on a desktop and
                further down the page on a phone. The link goes to them either way. */}
            <div
              className={`rounded-lg border p-4 transition-colors ${
                form.termsAccepted ? "bg-blue-50 border-blue-200" : "bg-amber-50 border-amber-300"
              }`}
            >
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.termsAccepted}
                  onChange={(e) => setForm(prev => ({ ...prev, termsAccepted: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-400 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-800 leading-snug">
                  I have read and agree to the{" "}
                  <a href="#vendor-terms" className="font-semibold text-blue-700 underline hover:text-blue-900">
                    Terms &amp; Conditions
                  </a>
                  .
                  <span className="block text-xs text-gray-500 mt-1">
                    {form.termsAccepted ? "Thank you — you can submit the form now." : "Required before the form can be submitted."}
                  </span>
                </span>
              </label>
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

          {/* Why the form is being asked for, then what is being agreed to. On a
              phone both come before the form, so nothing is agreed to unread. */}
          <div className="order-1 lg:order-2 lg:col-span-1 space-y-4 lg:sticky lg:top-8 lg:self-start">
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-3 border-b pb-2">Why this form matters</h2>
              <p className="text-sm font-medium text-gray-800">Welcome to the Ibile vendor network.</p>
              <p className="text-xs text-gray-600 leading-relaxed mt-2">
                This form helps Ibile keep accurate vendor records for communication, order processing, internal review, and
                operational documentation.
              </p>
            </div>

            <div id="vendor-terms" className="bg-white rounded-xl shadow-sm border p-5 scroll-mt-8">
              <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-1">Terms and Conditions</h2>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 border-b pb-2">
                Vendor Agreement Summary
              </p>
              <ol className="text-xs text-gray-600 leading-relaxed space-y-3 list-decimal pl-4 lg:max-h-[60vh] lg:overflow-y-auto">
                {AGREEMENT.map(([clause, detail]) => (
                  <li key={clause}>
                    <strong className="block text-gray-800">{clause}</strong>
                    <span>{detail}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          </div>

          <p className="text-center text-xs text-gray-400 mt-6">Powered by Ibile Management System</p>
        </div>
      </div>
    </>
  );
}

// No auth required - this is a public page
VendorOnboardingForm.getLayout = (page) => page;
