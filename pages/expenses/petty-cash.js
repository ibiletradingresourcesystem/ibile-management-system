import { useState, useEffect, useCallback } from "react";
import Layout from "@/components/Layout";
import axios from "axios";
import PettyCashTransactionPanel from "@/components/PettyCashTransactionPanel";
import PettyCashVendorForm from "@/components/PettyCashVendorForm";
import PettyCashVendorList from "@/components/PettyCashVendorList";

export default function PettyCashPage() {
  const [vendors, setVendors] = useState([]);
  const [tab, setTab] = useState("transactions"); // transactions | vendors | addVendor
  const [editingVendor, setEditingVendor] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadVendors = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get("/api/vendors", {
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
      await axios.post("/api/vendors", vendorData);
      loadVendors();
      setTab("vendors");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to add vendor");
    }
  };

  const handleUpdateVendor = async (vendorData) => {
    try {
      await axios.put(`/api/vendors/${editingVendor._id}`, vendorData);
      setEditingVendor(null);
      loadVendors();
      setTab("vendors");
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update vendor");
    }
  };

  const handleDeleteVendor = async (id) => {
    try {
      await axios.delete(`/api/vendors/${id}`);
      loadVendors();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete vendor");
    }
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto p-4 md:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Petty Cash Management</h1>
          <p className="text-sm text-gray-500 mt-1">
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
            currentLocation=""
            onTransactionChange={loadVendors}
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
    </Layout>
  );
}
