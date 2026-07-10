import { useState, useEffect, useCallback } from "react";
import Layout from "@/components/Layout";
import { apiClient } from "@/lib/api-client";
import PettyCashTransactionPanel from "@/components/PettyCashTransactionPanel";
import PettyCashVendorForm from "@/components/PettyCashVendorForm";
import PettyCashVendorList from "@/components/PettyCashVendorList";

export default function PettyCashPage() {
  const [vendors, setVendors] = useState([]);
  const [tab, setTab] = useState("transactions"); // transactions | vendors | addVendor
  const [editingVendor, setEditingVendor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [userLocation, setUserLocation] = useState("");
  const [orderVendor, setOrderVendor] = useState(null); // vendor to pre-fill order form

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    setUserLocation(user.location || "");
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
          <div className="flex border-b mb-6">
            <button
              onClick={() => setTab("transactions")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === "transactions"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Orders & Transactions
            </button>
            <button
              onClick={() => setTab("vendors")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === "vendors"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              Vendor Directory ({vendors.length})
            </button>
            <button
              onClick={() => {
                setEditingVendor(null);
                setTab("addVendor");
              }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
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
        </div>
      </div>
    </Layout>
  );
}
