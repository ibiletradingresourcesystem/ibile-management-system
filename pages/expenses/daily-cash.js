import { useState, useEffect, useCallback } from "react";
import Layout from "@/components/Layout";
import axios from "axios";

function formatCurrency(val) {
  return `₦${Number(val || 0).toLocaleString("en-NG")}`;
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function DailyCashPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split("T")[0],
    amount: "",
    location: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editAmount, setEditAmount] = useState("");

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (location) params.location = location;
      const { data } = await axios.get("/api/daily-cash", { params });
      setRecords(data.records || []);
    } catch (err) {
      console.error("Failed to load daily cash:", err);
    } finally {
      setLoading(false);
    }
  }, [location]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.amount || !formData.location || !formData.date) {
      return alert("All fields are required.");
    }
    setSubmitting(true);
    try {
      await axios.post("/api/daily-cash", formData);
      setShowForm(false);
      setFormData({
        date: new Date().toISOString().split("T")[0],
        amount: "",
        location: "",
      });
      loadRecords();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create record");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (id) => {
    try {
      await axios.put(`/api/daily-cash/${id}`, { amount: Number(editAmount) });
      setEditingId(null);
      loadRecords();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to update");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this record? This will recalculate the cash chain.")) return;
    try {
      await axios.delete(`/api/daily-cash/${id}`);
      loadRecords();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete");
    }
  };

  const handleRecalculate = async () => {
    if (!location) return alert("Select a location first.");
    try {
      await axios.post("/api/daily-cash/recalculate", { location });
      loadRecords();
    } catch (err) {
      alert(err.response?.data?.error || "Recalculation failed");
    }
  };

  const latestRecord = records[0];

  return (
    <Layout>
      <div className="max-w-5xl mx-auto p-4 md:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Daily Cash Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track daily cash received, expenses, and cash-at-hand balance.
          </p>
        </div>

        {/* Summary Cards */}
        {latestRecord && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
              <p className="text-xs text-blue-600 font-medium">Cash B/F</p>
              <p className="text-lg font-bold text-blue-800">
                {formatCurrency(latestRecord.cashBroughtForward)}
              </p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 border border-green-200">
              <p className="text-xs text-green-600 font-medium">Cash Received</p>
              <p className="text-lg font-bold text-green-800">
                {formatCurrency(latestRecord.amount)}
              </p>
            </div>
            <div className="bg-red-50 rounded-lg p-3 border border-red-200">
              <p className="text-xs text-red-600 font-medium">Total Payments</p>
              <p className="text-lg font-bold text-red-800">
                {formatCurrency(latestRecord.totalPayments)}
              </p>
            </div>
            <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
              <p className="text-xs text-purple-600 font-medium">Cash at Hand</p>
              <p className="text-lg font-bold text-purple-800">
                {formatCurrency(latestRecord.cashAtHand)}
              </p>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Filter by location..."
            className="border rounded px-3 py-2 text-sm"
          />
          <button
            onClick={() => setShowForm(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
          >
            + Record Cash
          </button>
          {location && (
            <button
              onClick={handleRecalculate}
              className="border border-orange-400 text-orange-600 px-3 py-2 rounded text-sm font-medium hover:bg-orange-50"
            >
              Recalculate Chain
            </button>
          )}
        </div>

        {/* Add Form */}
        {showForm && (
          <form
            onSubmit={handleSubmit}
            className="bg-white border rounded-lg p-4 mb-4 space-y-3"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Date</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData((f) => ({ ...f, date: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm mt-1"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Cash Received (₦)</label>
                <input
                  type="number"
                  value={formData.amount}
                  onChange={(e) => setFormData((f) => ({ ...f, amount: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm mt-1"
                  placeholder="0"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Location</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData((f) => ({ ...f, location: e.target.value }))}
                  className="w-full border rounded px-3 py-2 text-sm mt-1"
                  placeholder="e.g. Store 1"
                  required
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="border rounded px-4 py-2 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        )}

        {/* Records Table */}
        {loading ? (
          <p className="text-center text-gray-500 py-8">Loading...</p>
        ) : records.length === 0 ? (
          <p className="text-center text-gray-400 py-8">No daily cash records found.</p>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium text-gray-600">Date</th>
                  <th className="px-3 py-2.5 text-left font-medium text-gray-600">Location</th>
                  <th className="px-3 py-2.5 text-right font-medium text-gray-600">B/F</th>
                  <th className="px-3 py-2.5 text-right font-medium text-gray-600">Received</th>
                  <th className="px-3 py-2.5 text-right font-medium text-gray-600">Payments</th>
                  <th className="px-3 py-2.5 text-right font-medium text-gray-600">Cash at Hand</th>
                  <th className="px-3 py-2.5 text-center font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r._id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2.5">{formatDate(r.date)}</td>
                    <td className="px-3 py-2.5">{r.location}</td>
                    <td className="px-3 py-2.5 text-right">{formatCurrency(r.cashBroughtForward)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {editingId === r._id ? (
                        <input
                          type="number"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          className="w-20 border rounded px-1 py-0.5 text-sm text-right"
                        />
                      ) : (
                        formatCurrency(r.amount)
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-red-600">
                      {formatCurrency(r.totalPayments)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold">
                      {formatCurrency(r.cashAtHand)}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {editingId === r._id ? (
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={() => handleUpdate(r._id)}
                            className="text-green-600 text-xs font-medium hover:underline"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-gray-500 text-xs font-medium hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-center">
                          <button
                            onClick={() => {
                              setEditingId(r._id);
                              setEditAmount(r.amount);
                            }}
                            className="text-blue-600 text-xs font-medium hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(r._id)}
                            className="text-red-500 text-xs font-medium hover:underline"
                          >
                            Del
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
