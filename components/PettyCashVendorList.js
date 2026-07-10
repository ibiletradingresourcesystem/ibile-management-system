import { useState } from "react";
import { apiClient } from "@/lib/api-client";

export default function PettyCashVendorList({
  vendors = [],
  onEdit,
  onDelete,
  onPlaceOrder,
}) {
  const [linkLoading, setLinkLoading] = useState(null);

  const handleSendOnboardingLink = async (vendor, method) => {
    setLinkLoading(vendor._id);
    try {
      const { data } = await apiClient.post("/api/vendors/send-onboarding-link", {
        vendorId: vendor._id,
        method,
      });
      if (data.link) {
        if (method === "whatsapp") {
          const phone = vendor.repPhone?.replace(/[^0-9]/g, "") || "";
          const msg = `Hi ${vendor.vendorRep || vendor.companyName}, please complete your vendor registration here: ${data.link}`;
          window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
        } else {
          await navigator.clipboard.writeText(data.link);
          alert("Onboarding link copied to clipboard!");
        }
      }
    } catch (err) {
      alert(err.response?.data?.error || "Failed to generate link");
    } finally {
      setLinkLoading(null);
    }
  };
  if (!vendors.length) {
    return (
      <p className="text-sm text-gray-400 text-center py-4">
        No petty cash vendors registered yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {vendors.map((vendor) => (
        <details
          key={vendor._id}
          className="border rounded-lg bg-white overflow-hidden group"
        >
          <summary className="px-4 py-3 cursor-pointer flex items-center justify-between hover:bg-gray-50">
            <div>
              <p className="font-semibold text-sm">{vendor.companyName}</p>
              <p className="text-xs text-gray-500">
                {vendor.mainProduct || vendor.businessCategory || "General"}
                {vendor.repPhone && ` • ${vendor.repPhone}`}
              </p>
            </div>
            <span className="text-gray-400 text-xs group-open:rotate-90 transition-transform">
              ▶
            </span>
          </summary>
          <div className="px-4 pb-3 border-t bg-gray-50">
            <div className="grid grid-cols-2 gap-2 mt-2 text-xs text-gray-600">
              {vendor.vendorRep && (
                <p>
                  <span className="font-medium">Rep:</span> {vendor.vendorRep}
                </p>
              )}
              {vendor.email && (
                <p>
                  <span className="font-medium">Email:</span> {vendor.email}
                </p>
              )}
              {vendor.address && (
                <p className="col-span-2">
                  <span className="font-medium">Address:</span> {vendor.address}
                </p>
              )}
              {vendor.bankName && (
                <p>
                  <span className="font-medium">Bank:</span> {vendor.bankName}
                </p>
              )}
              {vendor.accountNumber && (
                <p>
                  <span className="font-medium">Acc:</span> {vendor.accountNumber}
                </p>
              )}
            </div>
            {vendor.products?.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-medium text-gray-500 mb-1">Products:</p>
                <div className="flex flex-wrap gap-1">
                  {vendor.products.map((p, i) => (
                    <span
                      key={i}
                      className="bg-white border px-2 py-0.5 rounded text-xs"
                    >
                      {p.productName} — ₦{Number(p.price || 0).toLocaleString()}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              {onPlaceOrder && (
                <button
                  onClick={() => onPlaceOrder(vendor)}
                  className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-blue-700"
                >
                  Place Order
                </button>
              )}
              <button
                onClick={() => handleSendOnboardingLink(vendor, "copy")}
                disabled={linkLoading === vendor._id}
                className="border border-purple-300 text-purple-700 px-3 py-1 rounded text-xs font-medium hover:bg-purple-50 disabled:opacity-50"
              >
                {linkLoading === vendor._id ? "..." : "📋 Copy Link"}
              </button>
              {vendor.repPhone && (
                <button
                  onClick={() => handleSendOnboardingLink(vendor, "whatsapp")}
                  disabled={linkLoading === vendor._id}
                  className="border border-green-300 text-green-700 px-3 py-1 rounded text-xs font-medium hover:bg-green-50 disabled:opacity-50"
                >
                  📱 WhatsApp
                </button>
              )}
              {onEdit && (
                <button
                  onClick={() => onEdit(vendor)}
                  className="border border-gray-300 px-3 py-1 rounded text-xs font-medium hover:bg-gray-100"
                >
                  Edit
                </button>
              )}
              {onDelete && (
                <button
                  onClick={() => {
                    if (confirm(`Delete ${vendor.companyName}?`))
                      onDelete(vendor._id);
                  }}
                  className="border border-red-300 text-red-600 px-3 py-1 rounded text-xs font-medium hover:bg-red-50"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
