"use client";

import React, { useEffect, useState, useRef } from "react";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import useProgress from "@/lib/useProgress";
import { formatCurrency } from "@/lib/format";
import { Printer, Mail, Camera, Copy, CheckCircle, ChevronDown, ChevronUp, Loader2, Send, Link2 } from "lucide-react";
import { useRouter } from "next/router";
import { apiClient } from "@/lib/api-client";
import { showConfirmDialog } from "@/lib/dialogs";
import { STAFF_ROLE_OPTIONS, normalizeStaffRole, POS_PERMISSION_KEYS, POS_PERMISSION_LABELS, getDefaultPosPermissions, normalizePosPermissions } from "@/lib/pos-permissions";
import { showToastMessage } from "@/lib/toast-state";

function toCamelCase(str) {
  return str
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export default function StaffPage() {
  const router = useRouter();
  const [staffList, setStaffList] = useState([]);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("list");
  const [editingId, setEditingId] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [loadingStaffList, setLoadingStaffList] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [locations, setLocations] = useState([]);
  const [expandedProfile, setExpandedProfile] = useState(null);
  const [copiedLink, setCopiedLink] = useState(null);

  // Photo upload
  const [photoPreview, setPhotoPreview] = useState(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const staffPhotoRef = useRef(null);

  // Edit photo
  const [editPhotoPreview, setEditPhotoPreview] = useState(null);
  const [uploadingEditPhoto, setUploadingEditPhoto] = useState(false);
  const editPhotoRef = useRef(null);

  // Penalty edit
  const [editingPenalty, setEditingPenalty] = useState(null);
  const [editPenaltyForm, setEditPenaltyForm] = useState({ amount: "", reason: "", date: "" });

  const [formData, setFormData] = useState({
    name: "", password: "", location: "", role: "staff",
    accountName: "", accountNumber: "", bankName: "", salary: "", photo: "",
  });

  const [editForm, setEditForm] = useState({
    name: "", password: "", location: "", role: "staff",
    accountName: "", accountNumber: "", bankName: "", salary: "", photo: "",
    posPermissions: getDefaultPosPermissions("staff"),
  });

  const [penaltyForm, setPenaltyForm] = useState({
    staffId: "", reason: "", amount: "",
    date: new Date().toISOString().split("T")[0],
  });

  const fetchStaff = async () => {
    setLoadingStaffList(true);
    start();
    try {
      onFetch();
      const res = await apiClient.get("/api/staff");
      onProcess();
      const staff = Array.isArray(res.data) ? res.data : res.data?.data || [];
      setStaffList(staff.map((m) => ({ ...m, role: normalizeStaffRole(m.role) })));
    } catch (err) {
      console.error("API Error:", err.response?.data || err.message);
      setStaffList([]);
    } finally {
      complete();
      setLoadingStaffList(false);
    }
  };

  const fetchLocations = async () => {
    try {
      const res = await apiClient.get("/api/setup/get");
      const { store } = res.data;
      if (store?.locations && Array.isArray(store.locations)) {
        const locationNames = store.locations.map((loc) => loc.name);
        setLocations(locationNames);
        if (locationNames.length > 0) setFormData((prev) => ({ ...prev, location: locationNames[0] }));
      }
    } catch (err) { console.error("Error fetching locations:", err); }
  };

  useEffect(() => { fetchStaff(); fetchLocations(); }, []);

  useEffect(() => {
    if (!message) return;
    showToastMessage({ title: "Manage staff", text: message });
    setMessage("");
  }, [message]);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiClient.post("/api/upload", fd);
      const url = res.data?.links?.[0] || "";
      setPhotoUrl(url);
      setFormData((prev) => ({ ...prev, photo: url }));
    } catch (err) { console.error("Photo upload failed:", err); }
    finally { setUploadingPhoto(false); }
  };

  const handleEditPhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setEditPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
    setUploadingEditPhoto(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiClient.post("/api/upload", fd);
      const url = res.data?.links?.[0] || "";
      setEditForm((prev) => ({ ...prev, photo: url }));
    } catch (err) { console.error("Edit photo upload failed:", err); }
    finally { setUploadingEditPhoto(false); }
  };

  const copyOnboardingLink = (staff) => {
    const link = `${window.location.origin}/onboarding/${staff.onboardingToken}`;
    navigator.clipboard.writeText(link);
    setCopiedLink(staff._id);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  const [sendingOnboarding, setSendingOnboarding] = useState(null);
  const [onboardingEmail, setOnboardingEmail] = useState("");
  const [showOnboardingEmailModal, setShowOnboardingEmailModal] = useState(null);

  const sendOnboardingEmail = async (staffId) => {
    if (!onboardingEmail) { setMessage("Please enter an email address"); return; }
    setSendingOnboarding(staffId);
    try {
      const res = await apiClient.post("/api/staff/onboarding/send-link", { staffId, email: onboardingEmail });
      setMessage(res.data.message || "Onboarding link sent!");
      setShowOnboardingEmailModal(null);
      setOnboardingEmail("");
    } catch (err) {
      setMessage(err.response?.data?.error || "Failed to send onboarding link");
    } finally {
      setSendingOnboarding(null);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (name === "name") setFormData((prev) => ({ ...prev, name: toCamelCase(value) }));
    else if (name === "password") { if (/^\d{0,4}$/.test(value)) setFormData((prev) => ({ ...prev, [name]: value })); }
    else setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    if (name === "name") setEditForm((prev) => ({ ...prev, name: toCamelCase(value) }));
    else if (name === "password") { if (/^\d{0,4}$/.test(value)) setEditForm((prev) => ({ ...prev, [name]: value })); }
    else if (name === "role") setEditForm((prev) => ({ ...prev, role: value, posPermissions: getDefaultPosPermissions(value) }));
    else setEditForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleEditPermissionToggle = (key) => {
    setEditForm((prev) => ({
      ...prev,
      posPermissions: { ...prev.posPermissions, [key]: !prev.posPermissions[key] },
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.password) { setMessage("Please fill in required fields"); return; }
    try {
      await apiClient.post("/api/staff", { ...formData, photo: photoUrl });
      setMessage("Staff added successfully.");
      setFormData({ name: "", password: "", location: locations[0] || "", role: "staff", accountName: "", accountNumber: "", bankName: "", salary: "", photo: "" });
      setPhotoPreview(null); setPhotoUrl("");
      fetchStaff();
    } catch (err) { setMessage(err.response?.data?.error || "Failed to create staff"); }
  };

  const handlePenaltySubmit = async (e) => {
    e.preventDefault();
    if (!penaltyForm.staffId || !penaltyForm.reason || !penaltyForm.amount) { setMessage("All penalty fields are required."); return; }
    try {
      await apiClient.post("/api/staff/penalties", { staffId: penaltyForm.staffId, amount: penaltyForm.amount, reason: penaltyForm.reason, date: penaltyForm.date || new Date().toISOString() });
      setMessage("Penalty submitted successfully.");
      setPenaltyForm({ staffId: "", reason: "", amount: "", date: new Date().toISOString().split("T")[0] });
      fetchStaff(); setActiveTab("list");
    } catch (err) { setMessage(err.response?.data?.error || "Error submitting penalty"); }
  };

  const handleEditPenalty = (staffId, index, penalty) => {
    setEditingPenalty({ staffId, index });
    setEditPenaltyForm({ amount: penalty.amount || "", reason: penalty.reason || "", date: penalty.date ? new Date(penalty.date).toISOString().split("T")[0] : "" });
  };

  const handleSavePenaltyEdit = async () => {
    if (!editingPenalty) return;
    try {
      await apiClient.put(`/api/staff/penalties/${editingPenalty.staffId}/${editingPenalty.index}`, editPenaltyForm);
      setMessage("Penalty updated."); setEditingPenalty(null); fetchStaff();
    } catch { setMessage("Error updating penalty."); }
  };

  const handleDeletePenalty = async (staffId, index) => {
    const shouldDelete = await showConfirmDialog({
      title: "Delete penalty?",
      message: "This penalty record will be removed.",
      tone: "danger",
      confirmLabel: "Delete penalty",
      cancelLabel: "Keep penalty",
    });
    if (!shouldDelete) return;
    try {
      await apiClient.delete(`/api/staff/penalties/${staffId}/${index}`);
      setMessage("Penalty deleted."); fetchStaff();
    } catch { setMessage("Error deleting penalty."); }
  };

  const startEdit = (staff) => {
    setEditingId(staff._id);
    const role = normalizeStaffRole(staff.role) || "staff";
    setEditForm({ name: staff.name || "", password: "", location: staff.location || "", role, accountName: staff.accountName || "", accountNumber: staff.accountNumber || "", bankName: staff.bankName || "", salary: staff.salary || "", photo: staff.photo || "", posPermissions: normalizePosPermissions(role, staff.posPermissions) });
    setEditPhotoPreview(staff.photo || null);
  };

  const cancelEdit = () => { setEditingId(null); setEditPhotoPreview(null); setEditForm({ name: "", password: "", location: "", role: "staff", accountName: "", accountNumber: "", bankName: "", salary: "", photo: "", posPermissions: getDefaultPosPermissions("staff") }); };

  const saveEdit = async (id) => {
    try { await apiClient.put(`/api/staff/${id}`, editForm); setMessage("Staff updated."); setEditingId(null); fetchStaff(); }
    catch (err) { setMessage(err.response?.data?.error || "Error updating staff"); }
  };

  const toggleShowOnPos = async (id, currentValue) => {
    try {
      await apiClient.patch(`/api/staff/${id}`, { showOnPos: !currentValue });
      setStaffList((prev) => prev.map((s) => s._id === id ? { ...s, showOnPos: !currentValue } : s));
    } catch (err) { setMessage(err.response?.data?.error || "Error updating POS visibility"); }
  };

  const handleDelete = async (id) => {
    const shouldDelete = await showConfirmDialog({
      title: "Delete staff member?",
      message: "This staff account will be removed permanently.",
      tone: "danger",
      confirmLabel: "Delete staff",
      cancelLabel: "Keep staff",
    });
    if (!shouldDelete) return;
    try { await apiClient.delete(`/api/staff/${id}`); setMessage("Staff deleted."); fetchStaff(); }
    catch (err) { setMessage(err.response?.data?.error || "Failed to delete staff"); }
  };

  const calculateGrandTotal = () => staffList.reduce((sum, s) => sum + (parseFloat(s.salary) || 0), 0);

  const handleSendingMail = async () => {
    setIsSending(true);
    try { const r = await apiClient.post("/api/salary-mail", {}); setMessage(r.data.message || "Salary email sent!"); }
    catch (err) { setMessage(err.response?.data?.error || "Failed to send salary emails"); }
    finally { setIsSending(false); }
  };

  const handlePrintSalaryTable = () => {
    const printWindow = window.open("", "", "width=900,height=600");
    const tableHTML = document.querySelector(".salary-print-table")?.outerHTML || "";
    const totalAmount = formatCurrency(calculateGrandTotal() || 0, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    printWindow.document.write(`<html><head><title>Salary Report</title><style>body{font-family:Arial,sans-serif;margin:20px;color:#333}h1{color:#1e3a8a;text-align:center}table{width:100%;border-collapse:collapse;margin:20px 0}th{background:#dbeafe;padding:12px;text-align:left;border:1px solid #bfdbfe;font-weight:bold}td{padding:10px;border:1px solid #e5e7eb}tr:nth-child(even){background:#f9fafb}.total{background:#dbeafe;padding:15px;margin-top:20px;text-align:right;font-weight:bold;font-size:16px;border-radius:5px}</style></head><body><h1>Staff Salary Report</h1><p style="text-align:center;color:#666;font-size:12px">${new Date().toLocaleDateString()}</p>${tableHTML}<div class="total">Grand Total: ${totalAmount}</div></body></html>`);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          {/* Header */}
          <div className="page-header">
            <div>
              <h1 className="page-title">Manage Staff</h1>
              <p className="page-subtitle">Create staff accounts, maintain profiles, and manage payroll details.</p>
            </div>
            <button type="button" onClick={() => router.push("/manage/staff-roles")} className="btn-action btn-action-secondary">Manage POS Roles</button>
          </div>

          {/* Add New Staff Form */}
          <div className="content-card mb-6">
            <h2 className="text-base md:text-lg font-semibold mb-4 text-sky-700">Add New Staff</h2>
            <form onSubmit={handleSubmit}>
              {/* Photo Upload */}
              <div className="flex items-center gap-4 mb-4">
                <div onClick={() => staffPhotoRef.current?.click()} className="w-16 h-16 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition overflow-hidden shrink-0">
                  {uploadingPhoto ? <Loader2 size={20} className="text-blue-400 animate-spin" /> : photoPreview ? <img src={photoPreview} alt="Staff" className="w-full h-full object-cover" /> : <Camera size={20} className="text-gray-400" />}
                </div>
                <input ref={staffPhotoRef} type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                <p className="text-xs text-gray-400">Upload staff photo (optional — can also be filled via onboarding form)</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-4">
                <input type="text" name="name" placeholder="Staff Name" value={formData.name} onChange={handleInputChange} className="form-input" required />
                <input type="password" name="password" placeholder="Password (4 digits)" value={formData.password} maxLength={4} inputMode="numeric" onChange={handleInputChange} className="form-input" required />
                <select name="location" value={formData.location} onChange={handleInputChange} className="form-select">
                  <option value="">Select Location</option>
                  {locations.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
                </select>
                <select name="role" value={formData.role} onChange={handleInputChange} className="form-select">
                  {STAFF_ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input type="text" name="accountName" placeholder="Account Name" value={formData.accountName} onChange={handleInputChange} className="form-input" />
                <input type="text" name="accountNumber" placeholder="Account Number" value={formData.accountNumber} onChange={handleInputChange} className="form-input" />
                <input type="text" name="bankName" placeholder="Bank Name" value={formData.bankName} onChange={handleInputChange} className="form-input" />
                <input type="number" name="salary" placeholder="Salary Amount" value={formData.salary} onChange={handleInputChange} className="form-input" />
              </div>
              <button type="submit" className="btn-action-primary w-full">Add Staff</button>
            </form>
          </div>

          {/* Main Content */}
          <div className="flex flex-col lg:flex-row justify-between gap-6">
            {/* Staff List */}
            <div className="content-card w-full lg:w-2/3">
              <h2 className="text-xl font-semibold mb-6 text-sky-700">All Staff</h2>
              {loadingStaffList ? (
                <div className="flex justify-center items-center py-10"><Loader size="md" text="Loading staff list..." progress={progress} /></div>
              ) : staffList.length === 0 ? (
                <p className="text-gray-500">No staff created yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="table-header-gradient text-white text-xs uppercase tracking-wider">
                      <tr>
                        <th className="text-left px-4 py-3 font-semibold">Staff</th>
                        <th className="text-left px-4 py-3 font-semibold">Location</th>
                        <th className="text-left px-4 py-3 font-semibold">Role</th>
                        <th className="text-center px-4 py-3 font-semibold">POS</th>
                        <th className="text-left px-4 py-3 font-semibold">Status</th>
                        <th className="text-left px-4 py-3 font-semibold">Onboarding</th>
                        <th className="text-right px-4 py-3 font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                  {staffList.map((staff) => (
                    <React.Fragment key={staff._id}>
                    <tr className="border-b border-gray-100 hover:bg-gray-50">
                      {editingId === staff._id ? (
                        <td colSpan={7} className="px-4 py-4">
                        <div className="space-y-3 max-w-xl">
                          <div className="flex items-center gap-3">
                            <div onClick={() => editPhotoRef.current?.click()} className="w-14 h-14 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-400 transition overflow-hidden shrink-0">
                              {uploadingEditPhoto ? <Loader2 size={18} className="text-blue-400 animate-spin" /> : editPhotoPreview ? <img src={editPhotoPreview} alt="Staff" className="w-full h-full object-cover" /> : <Camera size={18} className="text-gray-400" />}
                            </div>
                            <input ref={editPhotoRef} type="file" accept="image/*" onChange={handleEditPhotoUpload} className="hidden" />
                            <span className="text-xs text-gray-400">Update photo</span>
                          </div>
                          <input type="text" name="name" value={editForm.name} onChange={handleEditChange} className="form-input w-full" />
                          <select name="location" value={editForm.location} onChange={handleEditChange} className="form-select w-full">
                            <option value="">Select Location</option>
                            {locations.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
                          </select>
                          <select name="role" value={editForm.role} onChange={handleEditChange} className="form-select w-full">
                            {STAFF_ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <input type="password" name="password" placeholder="Leave blank to keep current" value={editForm.password} maxLength={4} inputMode="numeric" onChange={handleEditChange} className="form-input w-full" />
                          <input type="text" name="accountName" placeholder="Account Name" value={editForm.accountName} onChange={handleEditChange} className="form-input w-full" />
                          <input type="text" name="accountNumber" placeholder="Account Number" value={editForm.accountNumber} onChange={handleEditChange} className="form-input w-full" />
                          <input type="text" name="bankName" placeholder="Bank Name" value={editForm.bankName} onChange={handleEditChange} className="form-input w-full" />
                          <input type="number" name="salary" placeholder="Salary" value={editForm.salary} onChange={handleEditChange} className="form-input w-full" />
                          <div className="border rounded-lg p-3 bg-gray-50">
                            <div className="text-xs font-semibold text-gray-600 mb-2">POS Permissions</div>
                            <div className="grid grid-cols-2 gap-2">
                              {POS_PERMISSION_KEYS.map((key) => (
                                <label key={key} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                                  <input type="checkbox" checked={!!editForm.posPermissions?.[key]} onChange={() => handleEditPermissionToggle(key)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                  {POS_PERMISSION_LABELS[key] || key}
                                </label>
                              ))}
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => saveEdit(staff._id)} className="bg-green-600 text-white px-4 py-1 rounded hover:bg-green-700 text-sm font-semibold">Save</button>
                            <button onClick={cancelEdit} className="bg-gray-400 text-white px-4 py-1 rounded hover:bg-gray-500 text-sm font-semibold">Cancel</button>
                          </div>
                        </div>
                        </td>
                      ) : (
                        <>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {staff.photo ? <img src={staff.photo} alt={staff.name} className="w-10 h-10 rounded-full object-cover shrink-0" /> : <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm shrink-0">{staff.name?.charAt(0).toUpperCase()}</div>}
                            <div>
                              <div className="font-semibold text-gray-800">{toCamelCase(staff.name || "")}</div>
                              {staff.accountName && <div className="text-xs text-gray-400">{toCamelCase(staff.accountName)}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{toCamelCase(staff.location || "—")}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-1 rounded-full ${staff.role === "admin" || staff.role === "manager" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                            {toCamelCase(STAFF_ROLE_OPTIONS.find((o) => o.value === staff.role)?.label || staff.role)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => toggleShowOnPos(staff._id, staff.showOnPos !== false)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${staff.showOnPos !== false ? "bg-green-500" : "bg-gray-300"}`}
                            title={staff.showOnPos !== false ? "Visible on POS" : "Hidden from POS"}
                          >
                            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${staff.showOnPos !== false ? "translate-x-4.5" : "translate-x-0.5"}`} />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          {staff.onboardingComplete ? (
                            <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 inline-flex items-center gap-1"><CheckCircle size={10} /> Onboarded</span>
                          ) : (
                            <span className="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700">Pending</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {staff.onboardingToken && (
                              <>
                                <button onClick={() => copyOnboardingLink(staff)} className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded hover:bg-indigo-100 transition font-medium">
                                  {copiedLink === staff._id ? <><CheckCircle size={12} /> Copied!</> : <><Copy size={12} /> Copy Link</>}
                                </button>
                                <button onClick={() => { setShowOnboardingEmailModal(staff._id); setOnboardingEmail(""); }} className="flex items-center gap-1 text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100 transition font-medium">
                                  <Send size={12} /> Send
                                </button>
                                <a href={`${typeof window !== "undefined" ? window.location.origin : ""}/onboarding/${staff.onboardingToken}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs bg-green-50 text-green-600 px-2 py-1 rounded hover:bg-green-100 transition font-medium">
                                  <Link2 size={12} /> Open Form
                                </a>
                              </>
                            )}
                            {staff.onboardingComplete && (
                              <button onClick={() => setExpandedProfile(expandedProfile === staff._id ? null : staff._id)} className="flex items-center gap-1 text-xs bg-gray-50 text-gray-600 px-2 py-1 rounded hover:bg-gray-100 transition">
                                {expandedProfile === staff._id ? <><ChevronUp size={12} /> Hide</> : <><ChevronDown size={12} /> View</>}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => startEdit(staff)} className="text-xs px-3 py-1 border border-blue-500 text-blue-600 rounded-full hover:bg-blue-500 hover:text-white transition font-semibold">Edit</button>
                            <button onClick={() => handleDelete(staff._id)} className="text-xs px-3 py-1 border border-red-500 text-red-600 rounded-full hover:bg-red-500 hover:text-white transition font-semibold">Delete</button>
                          </div>
                        </td>
                        </>
                      )}
                    </tr>
                    {expandedProfile === staff._id && staff.onboardingComplete && (
                      <tr>
                        <td colSpan={7} className="px-4 pb-4">
                          <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-3">
                            {staff.onboardingData && (
                              <div>
                                <h4 className="font-semibold text-blue-700 mb-1">Personal Details</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                                  {staff.onboardingData.fullName && <p><span className="text-gray-500">Name:</span> {toCamelCase(staff.onboardingData.fullName)}</p>}
                                  {staff.onboardingData.phone && <p><span className="text-gray-500">Phone:</span> {staff.onboardingData.phone}</p>}
                                  {staff.onboardingData.email && <p><span className="text-gray-500">Email:</span> {staff.onboardingData.email}</p>}
                                  {staff.onboardingData.dateOfBirth && <p><span className="text-gray-500">DOB:</span> {staff.onboardingData.dateOfBirth}</p>}
                                  {staff.onboardingData.stateOfOrigin && <p><span className="text-gray-500">State:</span> {toCamelCase(staff.onboardingData.stateOfOrigin)}</p>}
                                  {staff.onboardingData.address && <p className="col-span-2"><span className="text-gray-500">Address:</span> {toCamelCase(staff.onboardingData.address)}</p>}
                                  {staff.onboardingData.nextOfKin && <p><span className="text-gray-500">Next Of Kin:</span> {toCamelCase(staff.onboardingData.nextOfKin)}</p>}
                                  {staff.onboardingData.nextOfKinPhone && <p><span className="text-gray-500">NoK Phone:</span> {staff.onboardingData.nextOfKinPhone}</p>}
                                </div>
                                {staff.onboardingData.photo && <img src={staff.onboardingData.photo} alt="Passport" className="w-16 h-16 rounded-lg object-cover mt-2 border" />}
                              </div>
                            )}
                            {staff.guarantor?.name && (
                              <div>
                                <h4 className="font-semibold text-blue-700 mb-1">Guarantor</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                                  <p><span className="text-gray-500">Name:</span> {toCamelCase(staff.guarantor.name)}</p>
                                  {staff.guarantor.phone && <p><span className="text-gray-500">Phone:</span> {staff.guarantor.phone}</p>}
                                  {staff.guarantor.email && <p><span className="text-gray-500">Email:</span> {staff.guarantor.email}</p>}
                                  {staff.guarantor.relationship && <p><span className="text-gray-500">Relationship:</span> {toCamelCase(staff.guarantor.relationship)}</p>}
                                  {staff.guarantor.occupation && <p><span className="text-gray-500">Occupation:</span> {toCamelCase(staff.guarantor.occupation)}</p>}
                                  {staff.guarantor.address && <p className="col-span-2"><span className="text-gray-500">Address:</span> {toCamelCase(staff.guarantor.address)}</p>}
                                </div>
                                {staff.guarantor.photo && <img src={staff.guarantor.photo} alt="Guarantor" className="w-16 h-16 rounded-lg object-cover mt-2 border" />}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-sm text-gray-500 mt-6">Note: Passwords are hashed and not displayed for security.</p>
            </div>

            {/* Staff Penalty */}
            <div className="bg-white p-6 shadow rounded-lg w-full lg:w-1/3">
              <h2 className="text-xl font-semibold mb-4 text-blue-700">Staff Penalty</h2>
              <div className="flex space-x-4 mb-6">
                <button className={`px-4 py-2 rounded-full font-semibold transition ${activeTab === "list" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`} onClick={() => setActiveTab("list")}>Penalty List</button>
                <button className={`px-4 py-2 rounded-full font-semibold transition ${activeTab === "form" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`} onClick={() => setActiveTab("form")}>Add Penalty</button>
              </div>

              {activeTab === "list" && (
                <div className="space-y-4">
                  {staffList.filter((s) => s.penalty?.length).length === 0 ? (
                    <p className="text-gray-500">No penalties recorded.</p>
                  ) : (
                    staffList.filter((s) => s.penalty?.length).map((staff) => (
                      <div key={staff._id} className="bg-white border border-gray-200 p-5 rounded-lg shadow hover:shadow-md transition">
                        <div className="flex justify-between items-center mb-2">
                          <h3 className="text-lg font-semibold text-blue-800">{staff.name} <span className="text-sm text-gray-500 ml-2">({staff.role})</span></h3>
                          <span className="text-sm bg-red-100 text-red-600 px-2 py-1 rounded-full">{staff.penalty.length} Penalt{staff.penalty.length > 1 ? "ies" : "y"}</span>
                        </div>
                        <ul className="space-y-2 pl-4 border-l-2 border-blue-100">
                          {staff.penalty.map((p, i) => (
                            <li key={i} className="text-sm text-gray-800">
                              {editingPenalty?.staffId === staff._id && editingPenalty?.index === i ? (
                                <div className="flex flex-wrap items-center gap-2 py-1">
                                  <input type="number" value={editPenaltyForm.amount} onChange={(e) => setEditPenaltyForm((prev) => ({ ...prev, amount: e.target.value }))} className="border px-2 py-1 rounded text-sm w-20" />
                                  <input type="text" value={editPenaltyForm.reason} onChange={(e) => setEditPenaltyForm((prev) => ({ ...prev, reason: e.target.value }))} className="border px-2 py-1 rounded text-sm flex-1 min-w-[100px]" />
                                  <input type="date" value={editPenaltyForm.date} onChange={(e) => setEditPenaltyForm((prev) => ({ ...prev, date: e.target.value }))} className="border px-2 py-1 rounded text-sm" />
                                  <button onClick={handleSavePenaltyEdit} className="bg-green-600 text-white text-xs px-2 py-1 rounded">Save</button>
                                  <button onClick={() => setEditingPenalty(null)} className="bg-gray-300 text-gray-700 text-xs px-2 py-1 rounded">Cancel</button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between gap-2">
                                  <span><span className="font-medium text-red-700">{p.amount}</span> - <span className="italic">{p.reason}</span> <span className="text-gray-500">({new Date(p.date).toLocaleDateString()})</span></span>
                                  <div className="flex gap-1 shrink-0">
                                    <button onClick={() => handleEditPenalty(staff._id, i, p)} className="text-xs text-blue-600 border border-blue-400 px-2 py-0.5 rounded hover:bg-blue-500 hover:text-white">Edit</button>
                                    <button onClick={() => handleDeletePenalty(staff._id, i)} className="text-xs text-red-600 border border-red-400 px-2 py-0.5 rounded hover:bg-red-500 hover:text-white">Del</button>
                                  </div>
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "form" && (
                <form onSubmit={handlePenaltySubmit} className="grid grid-cols-1 gap-4">
                  <select name="staffId" value={penaltyForm.staffId} onChange={(e) => setPenaltyForm((prev) => ({ ...prev, staffId: e.target.value }))} className="form-select" required>
                    <option value="">Select Staff</option>
                    {staffList.map((s) => <option key={s._id} value={s._id}>{s.name} ({s.role})</option>)}
                  </select>
                  <input type="number" name="amount" placeholder="Penalty Amount" value={penaltyForm.amount} onChange={(e) => setPenaltyForm((prev) => ({ ...prev, amount: e.target.value }))} className="form-input" required />
                  <input type="text" name="reason" placeholder="Reason" value={penaltyForm.reason} onChange={(e) => setPenaltyForm((prev) => ({ ...prev, reason: e.target.value }))} className="form-input" required />
                  <input type="date" name="date" value={penaltyForm.date} onChange={(e) => setPenaltyForm((prev) => ({ ...prev, date: e.target.value }))} className="form-input" />
                  <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-semibold">Submit</button>
                </form>
              )}
              {message && <p className="text-sm text-blue-700 mt-4 p-3 bg-blue-50 rounded">{message}</p>}
            </div>
          </div>

          {/* Salary Table */}
          <div className="bg-white mt-8 p-6 shadow rounded-lg w-full">
            <h2 className="text-xl font-semibold text-blue-700 mb-6">Salary Table</h2>
            {staffList.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <table className="salary-print-table w-full text-sm">
                    <thead className="table-header-gradient text-white text-xs uppercase tracking-wider border-b-2 border-blue-300">
                      <tr>
                        <th className="px-6 py-3 text-left font-bold">Staff Name</th>
                        <th className="px-6 py-3 text-left font-bold">Location</th>
                        <th className="px-6 py-3 text-left font-bold">Account Name</th>
                        <th className="px-6 py-3 text-left font-bold">Bank Account</th>
                        <th className="px-6 py-3 text-left font-bold">Bank Name</th>
                        <th className="px-6 py-3 text-right font-bold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffList.map((s) => (
                        <tr key={s._id} className="border-b border-gray-200 hover:bg-blue-50">
                          <td className="px-6 py-3 font-medium text-gray-900">{toCamelCase(s.name || "")}</td>
                          <td className="px-6 py-3 text-gray-700">{toCamelCase(s.location || "-")}</td>
                          <td className="px-6 py-3 text-gray-700">{toCamelCase(s.accountName || "-")}</td>
                          <td className="px-6 py-3 text-gray-700">{s.accountNumber || "-"}</td>
                          <td className="px-6 py-3 text-gray-700">{toCamelCase(s.bankName || "-")}</td>
                          <td className="px-6 py-3 text-right font-medium text-gray-900">{(parseFloat(s.salary) || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-between items-center mt-8 bg-blue-100 px-6 py-4 rounded-lg border-2 border-blue-400 mb-6">
                  <span className="text-xl font-bold text-blue-900">T-Total</span>
                  <span className="text-xl font-bold text-blue-900">{calculateGrandTotal().toLocaleString()}</span>
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={handleSendingMail} disabled={isSending} className={`${isSending ? "bg-gray-400 cursor-not-allowed" : "bg-gray-600 hover:bg-gray-700"} text-white px-6 py-2 rounded-lg font-semibold flex items-center gap-2`}>
                    <Mail size={18} /> {isSending ? "Sending..." : "Send Salary Mail"}
                  </button>
                  <button onClick={handlePrintSalaryTable} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold flex items-center gap-2">
                    <Printer size={18} /> Print Salary Table
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center py-12"><p className="text-gray-500">No staff members found</p></div>
            )}
          </div>
        </div>

        {/* Onboarding Email Modal */}
        {showOnboardingEmailModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowOnboardingEmailModal(null)}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2"><Send size={18} className="text-blue-600" /> Send Onboarding Link</h3>
              <p className="text-sm text-gray-500 mb-4">Send the onboarding form link (staff details + guarantor info) to the staff member&apos;s email.</p>
              <input
                type="email"
                value={onboardingEmail}
                onChange={e => setOnboardingEmail(e.target.value)}
                placeholder="Enter email address"
                className="form-input mb-4"
              />
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowOnboardingEmailModal(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition">Cancel</button>
                <button
                  onClick={() => sendOnboardingEmail(showOnboardingEmailModal)}
                  disabled={!!sendingOnboarding}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 flex items-center gap-2"
                >
                  {sendingOnboarding ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  {sendingOnboarding ? "Sending..." : "Send Link"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
