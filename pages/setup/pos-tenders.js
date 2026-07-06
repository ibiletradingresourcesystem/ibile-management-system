"use client";

import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import { showConfirmDialog } from "@/lib/dialogs";
import useProgress from "@/lib/useProgress";

export default function PosTenders() {
  const [tenders, setTenders] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTender, setEditingTender] = useState(null);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    buttonColor: "#FF69B4",
    tillOrder: 1,
    classification: "Other",
  });

  useEffect(() => {
    initializeAndFetch();
  }, []);

  const initializeAndFetch = async () => {
    try {
      setLoading(true);
      start();
      
      // First, try to seed default tenders if database is empty
      try {
        await fetch("/api/setup/seed-tenders", { method: "POST" });
      } catch (seedErr) {
        console.warn("Seed attempt failed, proceeding with fetch:", seedErr);
      }

      onFetch();
      // Then fetch tenders
      fetchTenders();
      fetchLocations();
    } catch (err) {
      console.error("Initialization error:", err);
      setLoading(false);
    }
  };

  const fetchTenders = async () => {
    try {
      setLoading(true);
      onProcess();
      // Fetch tenders from API
      const res = await fetch("/api/setup/tenders");
      const data = await res.json();
      
      if (data.success && data.tenders && Array.isArray(data.tenders)) {
        // Sort by tillOrder to maintain order
        const sortedTenders = [...data.tenders].sort((a, b) => (a.tillOrder || 0) - (b.tillOrder || 0));
        setTenders(sortedTenders);
        setError("");
      } else {
        setError("Failed to load tenders from database");
        setTenders([]);
      }
    } catch (err) {
      console.error("Error fetching tenders:", err);
      setError("Failed to load tenders. Please refresh the page.");
      setTenders([]);
    } finally {
      complete();
      setLoading(false);
    }
  };

  const fetchLocations = async () => {
    try {
      // Fetch locations from Store API
      const res = await fetch("/api/setup/get");
      const data = await res.json();
      
      let locationsList = [];
      
      if (data.store && data.store.locations) {
        locationsList = data.store.locations;
      }
      
      setLocations(locationsList);
    } catch (err) {
      console.error("Error fetching locations:", err);
    }
  };

  const handleAddTender = () => {
    setFormData({
      name: "",
      description: "",
      buttonColor: "#FF69B4",
      tillOrder: tenders.length + 1,
      classification: "Other",
    });
    setEditingTender(null);
    setShowAddModal(true);
  };

  const handleEditTender = (tender) => {
    setFormData(tender);
    setEditingTender(tender._id);
    setShowEditModal(true);
  };

  const handleSaveTender = async () => {
    try {
      setSaving(true);
      setError("");
      
      if (!formData.name.trim()) {
        setError("Tender name is required");
        setSaving(false);
        return;
      }

      let response;
      if (editingTender) {
        // Update existing tender
        response = await fetch(`/api/setup/tenders/${editingTender}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(formData),
        });
      } else {
        // Add new tender
        response = await fetch("/api/setup/tenders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(formData),
        });
      }

      const data = await response.json();

      if (data.success) {
        if (editingTender) {
          setSuccess("Tender updated successfully!");
        } else {
          setSuccess("Tender added successfully!");
        }
        setShowAddModal(false);
        setShowEditModal(false);
        
        // Refresh tenders list from database
        await fetchTenders();
        
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.message || "Failed to save tender");
      }
    } catch (err) {
      console.error("Error saving tender:", err);
      setError("Failed to save tender");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTender = async (tenderId) => {
    const shouldDelete = await showConfirmDialog({
      title: "Delete tender?",
      message: "This tender type will be removed from setup.",
      tone: "danger",
      confirmLabel: "Delete tender",
      cancelLabel: "Keep tender",
    });
    if (!shouldDelete) return;

    try {
      setSaving(true);
      const res = await fetch(`/api/setup/tenders/${tenderId}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (data.success) {
        setSuccess("Tender deleted successfully!");
        await fetchTenders();
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.message || "Failed to delete tender");
      }
    } catch (err) {
      console.error("Error deleting tender:", err);
      setError("Failed to delete tender");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader size="lg" text="Loading tenders..." progress={progress} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          {/* Header */}
          <div className="page-header">
            <h1 className="page-title">Tender Types</h1>
            <button
              onClick={handleAddTender}
              className="btn-action-primary"
            >
              ADD TENDER TYPE
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg mb-4">
              {success}
            </div>
          )}

          {/* Active Tender Types Section */}
          <div className="content-card">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Active Tender Types</h2>
            <p className="text-gray-600 text-sm mb-4">View, edit and delete your tender types.</p>

            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>EDIT</th>
                    <th>NAME</th>
                    <th>DESCRIPTION</th>
                    <th>BUTTON COLOUR</th>
                    <th>TILL ORDER</th>
                    <th>CLASSIFICATION</th>
                    <th>STATUS</th>
                    <th className="text-center">DELETE</th>
                  </tr>
                </thead>
                <tbody>
                  {tenders.map((tender, idx) => (
                    <tr key={tender._id}>
                      <td>
                        <button
                          onClick={() => handleEditTender(tender)}
                          className="text-sky-600 hover:text-sky-700 font-medium text-sm active:scale-95 transition-transform"
                        >
                          EDIT
                        </button>
                      </td>
                      <td className="font-medium">{tender.name}</td>
                      <td>{tender.description}</td>
                      <td className="text-center">
                        <div
                          className="w-6 h-6 rounded-full mx-auto border border-gray-300"
                          style={{ backgroundColor: tender.buttonColor }}
                        ></div>
                      </td>
                      <td>{tender.tillOrder}</td>
                      <td>{tender.classification}</td>
                      <td className="text-center">
                        <span className="inline-block bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full text-xs font-medium">
                          Active
                        </span>
                      </td>
                      <td className="text-center">
                        <button
                          onClick={() => handleDeleteTender(tender._id)}
                          className="btn-action-danger text-sm py-1 px-3"
                        >
                          DELETE
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>

      {/* Add/Edit Tender Modal */}
      {(showAddModal || showEditModal) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full shadow-xl">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              {editingTender ? "Edit Tender" : "Add New Tender"}
            </h2>

            <div className="space-y-4">
              <div className="form-group">
                <label className="form-label">
                  Tender Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="form-input"
                  placeholder="Enter tender name"
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Description
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="form-input"
                  placeholder="Enter description"
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Button Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={formData.buttonColor}
                    onChange={(e) => setFormData({ ...formData, buttonColor: e.target.value })}
                    className="w-12 h-10 border border-gray-300 rounded-lg cursor-pointer"
                  />
                  <input
                    type="text"
                    value={formData.buttonColor}
                    onChange={(e) => setFormData({ ...formData, buttonColor: e.target.value })}
                    className="form-input flex-1"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">
                  Till Order
                </label>
                <input
                  type="number"
                  value={formData.tillOrder}
                  onChange={(e) => setFormData({ ...formData, tillOrder: parseInt(e.target.value) })}
                  className="form-input"
                  min={1}
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Classification
                </label>
                <select
                  value={formData.classification}
                  onChange={(e) => setFormData({ ...formData, classification: e.target.value })}
                  className="form-select"
                >
                  <option value="Cash">Cash</option>
                  <option value="Card">Card</option>
                  <option value="Transfer">Transfer</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setShowEditModal(false);
                }}
                className="btn-action-secondary flex-1"
              >
                CANCEL
              </button>
              <button
                onClick={handleSaveTender}
                disabled={saving}
                className="btn-action-primary flex-1"
              >
                {saving ? "SAVING..." : "SAVE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

