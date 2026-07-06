"use client";
import { useEffect, useState, useRef } from "react";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import useProgress from "@/lib/useProgress";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";
import {
  Plus, Search, X, ChevronDown, ChevronUp, Edit, Trash2,
  Wrench, Package, AlertTriangle, Filter, BarChart3, Camera, Loader2,
} from "lucide-react";

const CATEGORIES = [
  "Furniture", "Electronics", "Vehicles", "Machinery", "IT Equipment",
  "Office Equipment", "Kitchen Equipment", "Security Equipment", "Tools", "Other",
];
const STATUSES = ["Active", "In Maintenance", "Retired", "Disposed", "Lost", "In Storage"];
const CONDITIONS = ["New", "Good", "Fair", "Poor", "Damaged"];
const STATUS_COLORS = {
  Active: "bg-green-100 text-green-700",
  "In Maintenance": "bg-yellow-100 text-yellow-700",
  Retired: "bg-gray-200 text-gray-600",
  Disposed: "bg-red-100 text-red-600",
  Lost: "bg-red-200 text-red-700",
  "In Storage": "theme-badge-soft",
};

export default function AssetsPage() {
  const { progress, start, complete } = useProgress();
  const [assets, setAssets] = useState([]);
  const [summary, setSummary] = useState({ totalAssets: 0, totalValue: 0, totalPurchaseValue: 0 });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [expandedAsset, setExpandedAsset] = useState(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [showMaintenance, setShowMaintenance] = useState(null);
  const [showDispose, setShowDispose] = useState(null);
  const [showFinancial, setShowFinancial] = useState(false);
  const [showStatusAssignment, setShowStatusAssignment] = useState(false);
  const photoRef = useRef(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const emptyForm = {
    name: "", description: "", category: "Other", serialNumber: "",
    manufacturer: "", model: "", purchaseDate: "", purchasePrice: "",
    depreciationMethod: "Straight-Line", usefulLifeYears: 5, salvageValue: 0,
    assignedTo: "", location: "", status: "Active", condition: "New",
    vendor: "", warrantyExpiry: "", insuranceExpiry: "", notes: "", image: "",
    customProperties: [],
  };
  const [form, setForm] = useState(emptyForm);

  const [maintenanceForm, setMaintenanceForm] = useState({
    description: "", cost: "", performedBy: "", nextMaintenanceDate: "",
  });

  const [disposeForm, setDisposeForm] = useState({ disposalReason: "", disposalValue: "" });

  useEffect(() => { fetchAssets(); }, []);

  async function fetchAssets() {
    try {
      start();
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (catFilter) params.set("category", catFilter);
      if (statusFilter) params.set("status", statusFilter);
      const res = await apiClient.get(`/api/assets?${params.toString()}`);
      setAssets(res.data.assets || []);
      setSummary(res.data.summary || {});
      complete();
    } catch { complete(); } finally { setLoading(false); }
  }

  useEffect(() => {
    if (!loading) fetchAssets();
  }, [search, catFilter, statusFilter]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        purchasePrice: Number(form.purchasePrice) || 0,
        usefulLifeYears: Number(form.usefulLifeYears) || 5,
        salvageValue: Number(form.salvageValue) || 0,
      };
      if (editingAsset) {
        await apiClient.put(`/api/assets/${editingAsset._id}`, payload);
      } else {
        await apiClient.post("/api/assets", payload);
      }
      setShowForm(false);
      setEditingAsset(null);
      setForm(emptyForm);
      fetchAssets();
    } catch (err) {
      await showAlertDialog({
        title: "Save asset failed",
        message: err.response?.data?.error || "Failed to save asset",
        tone: "danger",
      });
    } finally { setSaving(false); }
  }

  async function handleDelete(id) {
    try {
      await apiClient.delete(`/api/assets/${id}`);
      setDeleteConfirm(null);
      fetchAssets();
    } catch (err) {
      await showAlertDialog({
        title: "Delete failed",
        message: err.response?.data?.error || "Failed to delete",
        tone: "danger",
      });
    }
  }

  async function handleAddMaintenance(assetId) {
    if (!maintenanceForm.description) return;
    try {
      await apiClient.put(`/api/assets/${assetId}`, {
        action: "add-maintenance",
        ...maintenanceForm,
        cost: Number(maintenanceForm.cost) || 0,
      });
      setShowMaintenance(null);
      setMaintenanceForm({ description: "", cost: "", performedBy: "", nextMaintenanceDate: "" });
      fetchAssets();
    } catch (err) {
      await showAlertDialog({
        title: "Maintenance update failed",
        message: err.response?.data?.error || "Failed to add maintenance record",
        tone: "danger",
      });
    }
  }

  async function handleDispose(assetId) {
    if (!disposeForm.disposalReason) return;
    try {
      await apiClient.put(`/api/assets/${assetId}`, {
        action: "dispose",
        disposalReason: disposeForm.disposalReason,
        disposalValue: Number(disposeForm.disposalValue) || 0,
      });
      setShowDispose(null);
      setDisposeForm({ disposalReason: "", disposalValue: "" });
      fetchAssets();
    } catch (err) {
      await showAlertDialog({
        title: "Dispose failed",
        message: err.response?.data?.error || "Failed to dispose asset",
        tone: "danger",
      });
    }
  }

  function openEdit(asset) {
    setForm({
      name: asset.name || "",
      description: asset.description || "",
      category: asset.category || "Other",
      serialNumber: asset.serialNumber || "",
      manufacturer: asset.manufacturer || "",
      model: asset.model || "",
      purchaseDate: asset.purchaseDate ? asset.purchaseDate.slice(0, 10) : "",
      purchasePrice: asset.purchasePrice || "",
      depreciationMethod: asset.depreciationMethod || "Straight-Line",
      usefulLifeYears: asset.usefulLifeYears || 5,
      salvageValue: asset.salvageValue || 0,
      assignedTo: asset.assignedTo || "",
      location: asset.location || "",
      status: asset.status || "Active",
      condition: asset.condition || "New",
      vendor: asset.vendor || "",
      warrantyExpiry: asset.warrantyExpiry ? asset.warrantyExpiry.slice(0, 10) : "",
      insuranceExpiry: asset.insuranceExpiry ? asset.insuranceExpiry.slice(0, 10) : "",
      notes: asset.notes || "",
      image: asset.image || (asset.images?.[0]) || "",
      customProperties: (asset.customProperties || []).map((p) => ({ key: p.key || "", value: p.value || "" })),
    });
    setPhotoPreview(asset.image || (asset.images?.[0]) || null);
    setShowFinancial(false);
    setShowStatusAssignment(false);
    setEditingAsset(asset);
    setShowForm(true);
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      const link = data?.links?.[0];
      const url = typeof link === "string" ? link : link?.full || "";
      setForm((prev) => ({ ...prev, image: url }));
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploadingPhoto(false);
    }
  }

  if (loading) return <Layout><Loader /></Layout>;

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-2 sm:px-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Asset Management</h1>
            <p className="text-sm text-gray-500 mt-1">{summary.totalAssets} asset{summary.totalAssets !== 1 ? "s" : ""} tracked</p>
          </div>
          <button onClick={() => { setForm(emptyForm); setEditingAsset(null); setPhotoPreview(null); setShowFinancial(false); setShowStatusAssignment(false); setShowForm(true); }} className="btn-action-primary flex items-center gap-2 px-4 py-2 text-sm font-medium transition">
            <Plus size={16} /> Add Asset
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="theme-panel-soft rounded-xl p-4">
            <div className="flex items-center gap-2 theme-accent-text mb-1"><Package size={18} /><span className="text-xs font-medium uppercase tracking-wide">Total Assets</span></div>
            <div className="text-2xl font-bold theme-section-title">{summary.totalAssets}</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-green-600 mb-1"><BarChart3 size={18} /><span className="text-xs font-medium uppercase tracking-wide">Current Value</span></div>
            <div className="text-2xl font-bold text-green-700">{formatCurrency(summary.totalValue)}</div>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
            <div className="flex items-center gap-2 text-purple-600 mb-1"><BarChart3 size={18} /><span className="text-xs font-medium uppercase tracking-wide">Purchase Value</span></div>
            <div className="text-2xl font-bold text-purple-700">{formatCurrency(summary.totalPurchaseValue)}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search assets..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500">
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500">
            <option value="">All Statuses</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>

        {/* Asset List */}
        <div className="space-y-3">
          {assets.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              {search || catFilter || statusFilter ? "No assets match your filters" : "No assets yet. Click Add Asset to register one."}
            </div>
          )}
          {assets.map((a) => (
            <div key={a._id} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              {/* Row - Collapsed view: image and concise identity/details only */}
              <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50" onClick={() => setExpandedAsset(expandedAsset === a._id ? null : a._id)}>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 border border-gray-200 bg-gray-100 flex items-center justify-center">
                    {a.image ? (
                      <img src={a.image} alt={a.name} className="w-full h-full object-cover" />
                    ) : (
                      <Package size={18} className="text-gray-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-800 truncate">{a.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[a.status] || ""}`}>{a.status}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-gray-500">
                      {a.assetTag && <span className="font-mono text-[11px] text-gray-400">{a.assetTag}</span>}
                      {a.category && <span className="rounded-full bg-gray-100 px-2 py-0.5">{a.category}</span>}
                      {a.location && <span className="rounded-full bg-gray-100 px-2 py-0.5">{a.location}</span>}
                      {a.assignedTo && <span className="rounded-full bg-gray-100 px-2 py-0.5">Assigned: {a.assignedTo}</span>}
                      {(a.customProperties || []).slice(0, 2).map((prop, index) => (
                        <span key={`${a._id}-prop-${index}`} className="theme-badge-soft rounded-full px-2 py-0.5">
                          {prop.key}: {prop.value || "-"}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 hidden sm:flex items-center gap-3 text-xs text-gray-500">
                      <span>Value: {formatCurrency(a.currentValue ?? a.purchasePrice)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-3 shrink-0">
                  {expandedAsset === a._id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </div>
              </div>

              {/* Expanded */}
              {expandedAsset === a._id && (
                <div className="border-t border-gray-100 bg-gray-50 px-4 py-4 space-y-4 text-sm">
                  {/* Action buttons - only visible when expanded */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <button onClick={(e) => { e.stopPropagation(); openEdit(a); }} className="theme-toggle-neutral text-xs px-3 py-1 rounded-lg transition font-medium border">Edit</button>
                    <button onClick={(e) => { e.stopPropagation(); setShowMaintenance(a._id); }} className="text-xs px-3 py-1 text-amber-600 border border-amber-300 rounded-lg hover:bg-amber-50 transition font-medium">Maintain</button>
                    {a.status !== "Disposed" && (
                      <button onClick={(e) => { e.stopPropagation(); setShowDispose(a._id); }} className="text-xs px-3 py-1 text-red-500 border border-red-300 rounded-lg hover:bg-red-50 transition font-medium">Dispose</button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(a._id); }} className="text-xs px-3 py-1 text-red-400 border border-red-200 rounded-lg hover:bg-red-50 transition font-medium">Delete</button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {[
                      ["Serial #", a.serialNumber],
                      ["Manufacturer", a.manufacturer],
                      ["Model", a.model],
                      ["Condition", a.condition],
                      ["Purchase Date", a.purchaseDate ? new Date(a.purchaseDate).toLocaleDateString() : "—"],
                      ["Purchase Price", formatCurrency(a.purchasePrice)],
                      ["Current Value", formatCurrency(a.currentValue ?? a.purchasePrice)],
                      ["Depreciation", a.depreciationMethod || "None"],
                      ["Useful Life", a.usefulLifeYears ? `${a.usefulLifeYears} years` : "—"],
                      ["Salvage Value", formatCurrency(a.salvageValue || 0)],
                      ["Warranty Expiry", a.warrantyExpiry ? new Date(a.warrantyExpiry).toLocaleDateString() : "—"],
                      ["Insurance Expiry", a.insuranceExpiry ? new Date(a.insuranceExpiry).toLocaleDateString() : "—"],
                      ["Vendor", a.vendor || "—"],
                    ].filter(([, v]) => v && v !== "—").map(([label, val]) => (
                      <div key={label}>
                        <span className="text-xs text-gray-400">{label}</span>
                        <div className="font-medium text-gray-700">{val}</div>
                      </div>
                    ))}
                  </div>

                  {a.description && <div className="text-gray-600"><span className="font-medium text-gray-700">Description:</span> {a.description}</div>}
                  {a.notes && <div className="text-gray-600"><span className="font-medium text-gray-700">Notes:</span> {a.notes}</div>}

                  {/* Custom Properties */}
                  {a.customProperties?.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg p-3">
                      <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Properties</h4>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {a.customProperties.map((prop, i) => (
                          <div key={i}>
                            <span className="text-xs text-gray-400">{prop.key}</span>
                            <div className="font-medium text-gray-700 text-sm">{prop.value || "—"}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Depreciation Bar */}
                  {a.purchasePrice > 0 && a.depreciationMethod !== "None" && (
                    <div className="bg-white border border-gray-200 rounded-lg p-3">
                      <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Depreciation</h4>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-gray-200 rounded-full h-3 overflow-hidden">
                          <div
                            className="bg-green-500 h-full rounded-full transition-all"
                            style={{ width: `${Math.max(0, Math.min(100, ((a.currentValue ?? a.purchasePrice) / a.purchasePrice) * 100))}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium text-gray-600">
                          {Math.round(((a.currentValue ?? a.purchasePrice) / a.purchasePrice) * 100)}%
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Maintenance History */}
                  {a.maintenanceHistory?.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg p-3">
                      <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Maintenance History</h4>
                      <div className="space-y-2">
                        {a.maintenanceHistory.map((m, i) => (
                          <div key={i} className="flex items-start justify-between border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                            <div>
                              <div className="font-medium text-gray-700">{m.description}</div>
                              <div className="text-xs text-gray-400">
                                {m.date ? new Date(m.date).toLocaleDateString() : ""}
                                {m.performedBy && ` • By: ${m.performedBy}`}
                              </div>
                            </div>
                            {m.cost > 0 && <span className="text-sm font-medium text-gray-600">{formatCurrency(m.cost)}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Maintenance Inline Form */}
              {showMaintenance === a._id && (
                <div className="border-t border-amber-100 bg-amber-50 px-4 py-3 space-y-2">
                  <h4 className="text-sm font-medium text-amber-700">Add Maintenance Record</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input type="text" placeholder="Description *" value={maintenanceForm.description} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, description: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" onClick={(e) => e.stopPropagation()} />
                    <input type="number" placeholder="Cost" min="0" value={maintenanceForm.cost} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, cost: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" onClick={(e) => e.stopPropagation()} />
                    <input type="text" placeholder="Performed By" value={maintenanceForm.performedBy} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, performedBy: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" onClick={(e) => e.stopPropagation()} />
                    <input type="date" placeholder="Next Maintenance" value={maintenanceForm.nextMaintenanceDate} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, nextMaintenanceDate: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" onClick={(e) => e.stopPropagation()} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={(e) => { e.stopPropagation(); handleAddMaintenance(a._id); }} className="px-3 py-1.5 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700">Save</button>
                    <button onClick={(e) => { e.stopPropagation(); setShowMaintenance(null); }} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
                  </div>
                </div>
              )}

              {/* Dispose Inline Form */}
              {showDispose === a._id && (
                <div className="border-t border-red-100 bg-red-50 px-4 py-3 space-y-2">
                  <h4 className="text-sm font-medium text-red-700">Dispose Asset</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input type="text" placeholder="Disposal reason *" value={disposeForm.disposalReason} onChange={(e) => setDisposeForm({ ...disposeForm, disposalReason: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" onClick={(e) => e.stopPropagation()} />
                    <input type="number" placeholder="Disposal value" min="0" value={disposeForm.disposalValue} onChange={(e) => setDisposeForm({ ...disposeForm, disposalValue: e.target.value })} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" onClick={(e) => e.stopPropagation()} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={(e) => { e.stopPropagation(); handleDispose(a._id); }} className="px-3 py-1.5 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700">Confirm Dispose</button>
                    <button onClick={(e) => { e.stopPropagation(); setShowDispose(null); }} className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
                  </div>
                </div>
              )}

              {/* Delete Confirm */}
              {deleteConfirm === a._id && (
                <div className="border-t border-red-100 bg-red-50 px-4 py-3 flex items-center justify-between">
                  <span className="text-sm text-red-700">Permanently delete this asset?</span>
                  <div className="flex gap-2">
                    <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50">Cancel</button>
                    <button onClick={() => handleDelete(a._id)} className="px-3 py-1 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700">Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-6 px-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mb-10">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800">{editingAsset ? "Edit Asset" : "Add Asset"}</h2>
              <button onClick={() => { setShowForm(false); setEditingAsset(null); }} className="p-1 hover:bg-gray-100 rounded-lg"><X size={20} /></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
              {/* Basic Info */}
              <div>
                <h3 className="text-sm font-semibold text-gray-600 mb-2 uppercase tracking-wide">Basic Information</h3>

                {/* Photo Upload */}
                <div className="flex items-center gap-4 mb-4">
                  <div
                    onClick={() => photoRef.current?.click()}
                    className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition overflow-hidden shrink-0"
                  >
                    {uploadingPhoto ? (
                      <Loader2 size={24} className="text-blue-400 animate-spin" />
                    ) : photoPreview ? (
                      <img src={photoPreview} alt="Asset" className="w-full h-full object-cover" />
                    ) : (
                      <Camera size={24} className="text-gray-400" />
                    )}
                  </div>
                  <input ref={photoRef} type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                  <div>
                    <p className="text-sm font-medium text-gray-700">Asset Photo</p>
                    <p className="text-xs text-gray-400">Click to upload for easy identification</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Asset Name *</label>
                    <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" required />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                    <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500">
                      {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Serial Number</label>
                    <input type="text" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Manufacturer</label>
                    <input type="text" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Model</label>
                    <input type="text" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                    <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              </div>

              {/* Financial - Collapsible */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button type="button" onClick={() => setShowFinancial(!showFinancial)} className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition">
                  <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Financial Details</h3>
                  {showFinancial ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </button>
                {showFinancial && (
                <div className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Purchase Date</label>
                    <input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Purchase Price</label>
                    <input type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Depreciation Method</label>
                    <select value={form.depreciationMethod} onChange={(e) => setForm({ ...form, depreciationMethod: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500">
                      <option>Straight-Line</option>
                      <option>Declining Balance</option>
                      <option>None</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Useful Life (Years)</label>
                    <input type="number" min="1" value={form.usefulLifeYears} onChange={(e) => setForm({ ...form, usefulLifeYears: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Salvage Value</label>
                    <input type="number" min="0" step="0.01" value={form.salvageValue} onChange={(e) => setForm({ ...form, salvageValue: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Vendor</label>
                    <input type="text" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                </div>
                )}
              </div>

              {/* Status & Assignment - Collapsible */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button type="button" onClick={() => setShowStatusAssignment(!showStatusAssignment)} className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition">
                  <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Status & Assignment</h3>
                  {showStatusAssignment ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </button>
                {showStatusAssignment && (
                <div className="p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500">
                      {STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Condition</label>
                    <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500">
                      {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Assigned To</label>
                    <input type="text" value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Location</label>
                    <input type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Warranty Expiry</label>
                    <input type="date" value={form.warrantyExpiry} onChange={(e) => setForm({ ...form, warrantyExpiry: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Insurance Expiry</label>
                    <input type="date" value={form.insuranceExpiry} onChange={(e) => setForm({ ...form, insuranceExpiry: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                </div>
                )}
              </div>

              {/* Custom Properties */}
              <div className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Custom Properties</h3>
                  <button type="button" onClick={() => setForm((prev) => ({ ...prev, customProperties: [...prev.customProperties, { key: "", value: "" }] }))} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"><Plus size={14} /> Add Property</button>
                </div>
                {form.customProperties.length === 0 && (
                  <p className="text-xs text-gray-400 mb-2">No custom properties. Add properties like color, weight, dimensions, etc.</p>
                )}
                <div className="space-y-2">
                  {form.customProperties.map((prop, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="text" placeholder="Property name" value={prop.key} onChange={(e) => { const cp = [...form.customProperties]; cp[i] = { ...cp[i], key: e.target.value }; setForm({ ...form, customProperties: cp }); }} className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                      <input type="text" placeholder="Value" value={prop.value} onChange={(e) => { const cp = [...form.customProperties]; cp[i] = { ...cp[i], value: e.target.value }; setForm({ ...form, customProperties: cp }); }} className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
                      <button type="button" onClick={() => { const cp = [...form.customProperties]; cp.splice(i, 1); setForm({ ...form, customProperties: cp }); }} className="p-1 text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowForm(false); setEditingAsset(null); }} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saving} className={`btn-action-primary flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white transition ${saving ? "bg-gray-400 cursor-not-allowed" : ""}`}>
                  {saving ? "Saving..." : editingAsset ? "Update Asset" : "Add Asset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
