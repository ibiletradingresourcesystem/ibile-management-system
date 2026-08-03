import { useState, useEffect, useCallback } from "react";
import Layout from "@/components/Layout";
import { apiClient } from "@/lib/api-client";
import PettyCashTransactionPanel from "@/components/PettyCashTransactionPanel";
import PettyCashVendorForm from "@/components/PettyCashVendorForm";
import PettyCashVendorList from "@/components/PettyCashVendorList";

export default function PettyCashPage() {
  const [vendors, setVendors] = useState([]);
  const [tab, setTab] = useState("transactions"); // transactions | vendors | addVendor | productSync
  const [editingVendor, setEditingVendor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [userLocation, setUserLocation] = useState("");
  const [locations, setLocations] = useState([]);
  const [orderVendor, setOrderVendor] = useState(null); // vendor to pre-fill order form
  const [syncProducts, setSyncProducts] = useState(false);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    setUserLocation(user.location || "");

    // Fetch store locations for the location dropdown
    apiClient.get("/api/setup/setup").then(({ data }) => {
      const store = data?.store || data;
      const storeLocations = Array.isArray(store?.locations) ? store.locations : [];
      setLocations(storeLocations.filter((loc) => loc.isActive !== false));
    }).catch((err) => {
      console.error("Failed to load locations:", err);
    });
  }, []);

  const loadVendors = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get("/api/vendors", {
        params: { vendorType: "petty-cash" },
      });
      setVendors(data.vendors || data || []);
    } catch (err) {
      console.error("Failed to load petty cash vendors:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVendors();
  }, [loadVendors]);

  const handleAddVendor = async (vendorData) => {
    try {
      await apiClient.post("/api/vendors", vendorData);
      loadVendors();
      setTab("vendors");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to add vendor");
    }
  };

  const handleUpdateVendor = async (vendorData) => {
    try {
      await apiClient.put(`/api/vendors/${editingVendor._id}`, vendorData);
      setEditingVendor(null);
      loadVendors();
      setTab("vendors");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update vendor");
    }
  };

  const handleDeleteVendor = async (id) => {
    if (!confirm("Are you sure you want to delete this vendor?")) return;
    try {
      await apiClient.delete(`/api/vendors/${id}`);
      loadVendors();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete vendor");
    }
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <h1 className="page-title">Petty Cash Management</h1>
            <p className="page-subtitle">
              Manage petty cash vendors, place orders, and track payments.
            </p>
          </div>

          {/* Tabs */}
          <div className="flex border-b mb-6 overflow-x-auto">
            <button
              onClick={() => setTab("transactions")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === "transactions"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Orders & Transactions
            </button>
            <button
              onClick={() => setTab("vendors")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === "vendors"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Vendor Directory ({vendors.length})
            </button>
            <button
              onClick={() => setTab("productSync")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === "productSync"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Manage Products
            </button>
            <button
              onClick={() => {
                setEditingVendor(null);
                setTab("addVendor");
              }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === "addVendor"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              + Add Vendor
            </button>
          </div>

          {/* Content */}
          {tab === "transactions" && (
            <PettyCashTransactionPanel
              vendors={vendors}
              currentLocation={userLocation}
              locations={locations}
              onTransactionChange={loadVendors}
              prefillVendor={orderVendor}
              onPrefillConsumed={() => setOrderVendor(null)}
            />
          )}

          {tab === "vendors" && (
            <div>
              {loading ? (
                <p className="text-center text-gray-500 py-8">Loading vendors...</p>
              ) : (
                <PettyCashVendorList
                  vendors={vendors}
                  onEdit={(v) => {
                    setEditingVendor(v);
                    setTab("addVendor");
                  }}
                  onDelete={handleDeleteVendor}
                  onPlaceOrder={(v) => {
                    setOrderVendor(v);
                    setTab("transactions");
                  }}
                />
              )}
            </div>
          )}

          {tab === "addVendor" && (
            <PettyCashVendorForm
              editingVendor={editingVendor}
              onSubmit={editingVendor ? handleUpdateVendor : handleAddVendor}
              onCancel={() => {
                setEditingVendor(null);
                setTab("vendors");
              }}
            />
          )}

          {tab === "productSync" && (
            <div className="bg-white rounded-lg border p-6">
              <h2 className="text-lg font-bold mb-4">Product Management from Orders</h2>
              <p className="text-sm text-gray-600 mb-4">
                Products are automatically created when you create petty cash orders. 
                This page shows you the status of products linked to your orders.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-blue-900">
                  <strong>How it works:</strong>
                </p>
                <ul className="text-sm text-blue-800 mt-2 space-y-1 ml-4 list-disc">
                  <li>When you create a petty cash order with products, they are automatically created in the main product list</li>
                  <li>When you mark items as "Received", the quantities are added to your inventory</li>
                  <li>The products are linked to the vendor for easy reordering</li>
                  <li>Products appear with a default 25% markup from the cost price</li>
                </ul>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-green-900 font-medium">
                  ✓ Products from petty cash orders are now being automatically created and tracked in your inventory.
                </p>
                <p className="text-xs text-green-800 mt-2">
                  Go to Orders & Transactions tab to create new petty cash orders with products.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
