// pages/stock/stock-take.js
"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/router";
import Layout from "@/components/Layout";
import { Loader } from "@/components/ui";
import useProgress from "@/lib/useProgress";
import { formatCurrency } from "@/lib/format";
import { getCachedSetup } from "@/lib/setupCache";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faClipboardList,
  faEye,
  faPlay,
  faCheck,
  faTimes,
  faSearch,
  faFileExport,
  faFilter,
} from "@fortawesome/free-solid-svg-icons";

const EMPTY_CREATE_FORM = {
  staffId: "",
  staffName: "",
  locationId: "",
  locationName: "",
};

const STATUS_COLORS = {
  draft: "bg-gray-100 text-gray-700 border-gray-300",
  "in-progress": "bg-blue-50 text-blue-700 border-blue-300",
  completed: "bg-yellow-50 text-yellow-700 border-yellow-300",
  approved: "bg-green-50 text-green-700 border-green-300",
  cancelled: "bg-red-50 text-red-700 border-red-300",
};

const TYPE_LABELS = {
  full: "Full Count",
  partial: "Partial Count",
  cycle: "Cycle Count",
  "spot-check": "Spot Check",
};

function getSuggestedTitle(form) {
  const dateLabel = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return [dateLabel, form.locationName].filter(Boolean).join(" - ");
}

export default function StockTakeList() {
  const router = useRouter();
  const { progress, start, onFetch, onProcess, complete } = useProgress();

  const [stockTakes, setStockTakes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterLocation, setFilterLocation] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  // Create form state
  const [form, setForm] = useState(EMPTY_CREATE_FORM);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const suggestedTitle = useMemo(() => getSuggestedTitle(form), [form]);

  const fetchStockTakes = useCallback(async () => {
    try {
      setLoading(true);
      start();
      onFetch();
      const res = await fetch("/api/stock-take");
      const data = await res.json();
      onProcess();
      if (data.success) {
        setStockTakes(data.stockTakes || []);
      }
    } catch (err) {
      console.error("Failed to fetch stock takes:", err);
    } finally {
      complete();
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const [setup, staffResponse] = await Promise.all([
          getCachedSetup(),
          fetch("/api/staff").then((res) => res.json()).catch(() => []),
        ]);
        const locs = (setup?.store?.locations || []).map((loc) => ({
          _id: loc?._id || loc?.name || String(loc),
          name: loc?.name || String(loc),
        }));
        const staffList = (Array.isArray(staffResponse) ? staffResponse : staffResponse?.data || [])
          .filter((member) => member?.isActive !== false)
          .sort((left, right) => String(left?.name || "").localeCompare(String(right?.name || "")));

        setLocations(locs);
        setStaffMembers(staffList);
      } catch (err) {
        console.error("Init error:", err);
      }
      fetchStockTakes();
    }
    init();
  }, [fetchStockTakes]);

  const filtered = useMemo(() => {
    return stockTakes.filter((st) => {
      if (filterStatus !== "all" && st.status !== filterStatus) return false;
      if (filterLocation !== "all" && st.locationName !== filterLocation) return false;
      if (searchTerm) {
        const t = searchTerm.toLowerCase();
        return (
          st.reference?.toLowerCase().includes(t) ||
          st.title?.toLowerCase().includes(t) ||
          st.createdBy?.toLowerCase().includes(t)
        );
      }
      return true;
    });
  }, [stockTakes, filterStatus, filterLocation, searchTerm]);

  const handleCreate = async () => {
    if (!form.staffName) return setError("Please select a staff member");
    if (!form.locationName) return setError("Please select a location");

    const resolvedTitle = suggestedTitle;
    if (!resolvedTitle.trim()) return setError("Title is required");

    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/stock-take", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: resolvedTitle,
          locationId: form.locationId,
          locationName: form.locationName,
          createdBy: form.staffName,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreateForm(false);
        setForm(EMPTY_CREATE_FORM);
        router.push(`/stock/stock-take/${data.id}`);
      } else {
        setError(data.message || "Failed to create stock take");
      }
    } catch (err) {
      setError("Failed to create stock take");
    } finally {
      setCreating(false);
    }
  };

  const summary = useMemo(() => {
    const all = stockTakes;
    return {
      inProgress: all.filter((s) => s.status === "in-progress").length,
      completed: all.filter((s) => s.status === "completed").length,
      approved: all.filter((s) => s.status === "approved").length,
    };
  }, [stockTakes]);

  const handleOpenCreateForm = () => {
    setError("");
    setForm(EMPTY_CREATE_FORM);
    setShowCreateForm(true);
  };

  const handleCloseCreateForm = () => {
    setError("");
    setForm(EMPTY_CREATE_FORM);
    setShowCreateForm(false);
  };

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader size="lg" text="Loading stock takes..." progress={progress} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          {/* Header */}
          <div className="page-header flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="page-title">Stock Take</h1>
              <p className="page-subtitle">Physical inventory counts & reconciliation</p>
            </div>
            <button
              onClick={showCreateForm ? handleCloseCreateForm : handleOpenCreateForm}
              className="btn-action-primary flex items-center gap-2"
            >
              <FontAwesomeIcon icon={showCreateForm ? faTimes : faPlus} className="w-4 h-4" />
              {showCreateForm ? "Close" : "New Stock Take"}
            </button>
          </div>

          {showCreateForm ? (
            <div className="content-card mb-6">
              <div className="space-y-5">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>
                )}

                <p className="text-sm text-gray-700">Select staff and location of the stock take:</p>

                <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
                  <label className="text-sm font-semibold text-gray-700">Staff Member:</label>
                  <select
                    value={form.staffId}
                    onChange={(e) => {
                      const selectedStaff = staffMembers.find((member) => String(member._id) === e.target.value);
                      setForm((current) => ({
                        ...current,
                        staffId: selectedStaff?._id ? String(selectedStaff._id) : "",
                        staffName: selectedStaff?.name || "",
                      }));
                    }}
                    className="form-select"
                  >
                    <option value="">No Staff Member Selected</option>
                    {staffMembers.map((member) => (
                      <option key={member._id} value={member._id}>{member.name}</option>
                    ))}
                  </select>

                  <label className="text-sm font-semibold text-gray-700">Location:</label>
                  <select
                    value={form.locationId}
                    onChange={(e) => {
                      const selectedLocation = locations.find((location) => String(location._id) === e.target.value);
                      setForm((current) => ({
                        ...current,
                        locationId: selectedLocation?._id ? String(selectedLocation._id) : "",
                        locationName: selectedLocation?.name || "",
                      }));
                    }}
                    className="form-select"
                  >
                    <option value="">No Location Selected</option>
                    {locations.map((location) => (
                      <option key={location._id} value={location._id}>{location.name}</option>
                    ))}
                  </select>
                </div>

                <div className="theme-note-primary rounded-lg px-4 py-3 text-sm">
                  Title: {suggestedTitle || "Select a location to generate the stock take title."}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="btn-action-primary flex items-center gap-2 uppercase"
                  >
                    <FontAwesomeIcon icon={faPlay} className="w-4 h-4" />
                    {creating ? "Starting..." : "Start Stock Take"}
                  </button>
                  <button onClick={handleCloseCreateForm} className="btn-action btn-action-danger">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                {[
                  { label: "In Progress", value: summary.inProgress, color: "bg-blue-50 border-blue-200" },
                  { label: "Completed", value: summary.completed, color: "bg-yellow-50 border-yellow-200" },
                  { label: "Approved", value: summary.approved, color: "bg-green-50 border-green-200" },
                ].map((card) => (
                  <div key={card.label} className={`p-4 rounded-lg border ${card.color}`}>
                    <div className="text-2xl font-bold text-gray-900">{card.value}</div>
                    <div className="text-xs text-gray-600 mt-1">{card.label}</div>
                  </div>
                ))}
              </div>

              {/* Filters */}
              <div className="content-card mb-6">
                <div className="flex flex-col md:flex-row gap-3">
                  <div className="relative flex-1 gap-2">
                    <FontAwesomeIcon icon={faSearch} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="text"
                      placeholder="Search by reference, title, or creator..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="form-input pl-12 placeholder:text-gray-400"
                    />
                  </div>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="form-select w-full md:w-40"
                  >
                    <option value="all">All Status</option>
                    <option value="draft">Draft</option>
                    <option value="in-progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="approved">Approved</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                  <select
                    value={filterLocation}
                    onChange={(e) => setFilterLocation(e.target.value)}
                    className="form-select w-full md:w-48"
                  >
                    <option value="all">All Locations</option>
                    {locations.map((l) => (
                      <option key={l._id || l.name} value={l.name}>{l.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Table */}
              <div className="content-card overflow-x-auto">
                {filtered.length === 0 ? (
                  <div className="text-center py-16">
                    <FontAwesomeIcon icon={faClipboardList} className="w-12 h-12 text-gray-300 mb-4" />
                    <p className="text-gray-500 text-lg mb-2">No stock takes found</p>
                    <p className="text-gray-400 text-sm">Create a new stock take to begin inventory reconciliation</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="table-header-gradient">
                      <tr className="text-left">
                        <th className="py-3 px-3 font-semibold text-white">Reference</th>
                        <th className="py-3 px-3 font-semibold text-white">Title</th>
                        <th className="py-3 px-3 font-semibold text-white hidden md:table-cell">Type</th>
                        <th className="py-3 px-3 font-semibold text-white">Location</th>
                        <th className="py-3 px-3 font-semibold text-white hidden md:table-cell">Items</th>
                        <th className="py-3 px-3 font-semibold text-white hidden md:table-cell">Progress</th>
                        <th className="py-3 px-3 font-semibold text-white hidden lg:table-cell">Variance</th>
                        <th className="py-3 px-3 font-semibold text-white">Status</th>
                        <th className="py-3 px-3 font-semibold text-white hidden md:table-cell">Date</th>
                        <th className="py-3 px-3 font-semibold text-white text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((st) => {
                        const progressPct = st.totalItems > 0 ? Math.round((st.countedItems / st.totalItems) * 100) : 0;
                        const canResume = !["completed", "cancelled", "approved"].includes(st.status);
                        return (
                          <tr key={st._id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                            <td className="py-3 px-3 font-mono text-xs theme-accent-text">{st.reference}</td>
                            <td className="py-3 px-3 font-medium text-gray-900">{st.title}</td>
                            <td className="py-3 px-3 text-gray-600 hidden md:table-cell">{TYPE_LABELS[st.type] || st.type}</td>
                            <td className="py-3 px-3 text-gray-600">{st.locationName}</td>
                            <td className="py-3 px-3 text-gray-600 hidden md:table-cell">{st.countedItems}/{st.totalItems}</td>
                            <td className="py-3 px-3 hidden md:table-cell">
                              <div className="flex items-center gap-2">
                                <div className="w-16 theme-progress-track h-1.5">
                                  <div
                                    className={`h-1.5 rounded-full ${progressPct === 100 ? "theme-progress-fill-success" : "theme-progress-fill"}`}
                                    style={{ width: `${progressPct}%` }}
                                  />
                                </div>
                                <span className="text-xs text-gray-500">{progressPct}%</span>
                              </div>
                            </td>
                            <td className="py-3 px-3 hidden lg:table-cell">
                              {st.totalVariance !== 0 ? (
                                <span className={st.totalVariance > 0 ? "text-green-600" : "text-red-600"}>
                                  {st.totalVariance > 0 ? "+" : ""}{st.totalVariance}
                                </span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${STATUS_COLORS[st.status] || "bg-gray-100 text-gray-600"}`}>
                                {st.status}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-gray-500 text-xs hidden md:table-cell">
                              {new Date(st.createdAt).toLocaleDateString()}
                            </td>
                            <td className="py-3 px-3 text-right">
                              <button
                                onClick={() => router.push(`/stock/stock-take/${st._id}`)}
                                className="inline-flex items-center gap-2 theme-accent-text transition-opacity hover:opacity-75 px-2 py-1 rounded"
                                title={canResume ? "Resume Stock Take" : "View Details"}
                              >
                                <FontAwesomeIcon icon={canResume ? faPlay : faEye} className="w-4 h-4" />
                                <span className="hidden md:inline text-xs font-semibold uppercase tracking-wide">
                                  {canResume ? "Resume" : "View"}
                                </span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}
