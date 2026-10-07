"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import useProgress from "@/lib/useProgress";
import { formatCurrency } from "@/lib/format";
import { Printer, Mail, Camera, Copy, CheckCircle, ChevronDown, Loader2, Send, Link2, MapPin, Search, Pencil, Trash2, Monitor, Clock, UserX } from "lucide-react";
import { useRouter } from "next/router";
import { apiClient } from "@/lib/api-client";
import { showConfirmDialog } from "@/lib/dialogs";
import { STAFF_ROLE_OPTIONS, normalizeStaffRole, POS_PERMISSION_KEYS, POS_PERMISSION_LABELS, getDefaultPosPermissions, normalizePosPermissions } from "@/lib/pos-permissions";
import { showToastMessage } from "@/lib/toast-state";
import {
  chunkPayroll,
  missingBankDetails,
  payrollExclusions,
  payrollRows,
  payrollTotal,
  staffNetPay,
  staffPenaltyTotal,
} from "@/lib/payroll";

/** How many staff go on one transfer memo, as the bank letters are written. */
const MEMO_TABLE_SIZE = 5;

function toCamelCase(str) {
  return str
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/** Where a staff member works: set here as location, or by the till as locationName. */
const staffLocationOf = (staff) => String(staff?.location || staff?.locationName || "");

const roleLabel = (role) => toCamelCase(STAFF_ROLE_OPTIONS.find((o) => o.value === role)?.label || role || "staff");

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 mt-1">{hint}</span>}
    </label>
  );
}

function DetailSection({ title, children }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-2">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** One label and value; nothing at all when there is no value. */
function Detail({ label, value }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-800 text-right break-words min-w-0">{value}</span>
    </div>
  );
}

export default function StaffPage() {
  const router = useRouter();
  const [staffList, setStaffList] = useState([]);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("list");
  const [editingId, setEditingId] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [loadingStaffList, setLoadingStaffList] = useState(true);
  const [staffSearch, setStaffSearch] = useState("");
  const [staffSort, setStaffSort] = useState("name");
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

  const emptyEditForm = () => ({
    name: "", password: "", location: "", role: "staff",
    accountName: "", accountNumber: "", bankName: "", salary: "", photo: "", isActive: true,
    posPermissions: getDefaultPosPermissions("staff"),
  });
  const [editForm, setEditForm] = useState(emptyEditForm);

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

  /** The store's locations, plus a staff member's own when it is not one of them (an old name). */
  const locationChoices = (current) =>
    current && !locations.some((loc) => loc.toLowerCase() === current.toLowerCase()) ? [...locations, current] : locations;

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
    setExpandedProfile(staff._id);
    const role = normalizeStaffRole(staff.role) || "staff";
    // The store's own spelling of the location, so the list shows it picked
    const current = staffLocationOf(staff);
    const location = locations.find((loc) => loc.toLowerCase() === current.trim().toLowerCase()) || current;
    setEditForm({ name: staff.name || "", password: "", location, role, accountName: staff.accountName || "", accountNumber: staff.accountNumber || "", bankName: staff.bankName || "", salary: staff.salary || "", photo: staff.photo || "", isActive: staff.isActive !== false, posPermissions: normalizePosPermissions(role, staff.posPermissions) });
    setEditPhotoPreview(staff.photo || null);
  };

  const cancelEdit = () => { setEditingId(null); setEditPhotoPreview(null); setEditForm(emptyEditForm()); };

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

  const visibleStaff = useMemo(() => {
    const term = staffSearch.trim().toLowerCase();
    const matches = staffList.filter(
      (s) => !term || [s.name, staffLocationOf(s), s.role, s.accountName].some((v) => String(v || "").toLowerCase().includes(term))
    );
    const keyOf = (s) => (staffSort === "location" ? staffLocationOf(s) : staffSort === "role" ? s.role : s.name) || "~";
    return [...matches].sort(
      (a, b) =>
        String(keyOf(a)).localeCompare(String(keyOf(b)), undefined, { sensitivity: "base" }) ||
        String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })
    );
  }, [staffList, staffSearch, staffSort]);

  // What is actually paid, after penalties — the same figure the memo and the email use.
  const paySlipRows = payrollRows(staffList);
  const payChunks = chunkPayroll(paySlipRows, MEMO_TABLE_SIZE);
  const payTotal = payrollTotal(paySlipRows);
  const notBeingPaid = payrollExclusions(staffList);
  const missingBanks = missingBankDetails(paySlipRows);

  /** Open the transfer memo for one table of staff. */
  const openMemo = (chunk, index) => {
    const ids = chunk.map((row) => row._id).join(",");
    window.open(`/memo/salary?ids=${encodeURIComponent(ids)}&part=${index + 1}&of=${payChunks.length}`, "_blank");
  };

  const handleSendingMail = async () => {
    if (paySlipRows.length === 0) {
      setMessage("Nobody is due to be paid, so there is nothing to send.");
      return;
    }
    const confirmed = await showConfirmDialog({
      title: "Send the salary schedule?",
      message: `${paySlipRows.length} staff, ${formatCurrency(payTotal)} in total, will be emailed to the payroll address.` +
        (missingBanks.length > 0 ? ` ${missingBanks.length} of them have no bank details yet.` : ""),
      confirmLabel: "Send email",
    });
    if (!confirmed) return;

    setIsSending(true);
    try {
      const r = await apiClient.post("/api/salary-mail", {});
      setMessage(r.data.message || "Salary schedule sent.");
    } catch (err) {
      setMessage(err.response?.data?.error || "Failed to send the salary schedule");
    } finally {
      setIsSending(false);
    }
  };

  const handlePrintSalaryTable = () => {
    const printWindow = window.open("", "", "width=900,height=600");
    const tableHTML = [...document.querySelectorAll(".salary-print-table")]
      .map((table) => table.outerHTML)
      .join("<div style='height:18px'></div>");
    const totalAmount = formatCurrency(payTotal || 0, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
                <h2 className="text-xl font-semibold text-sky-700">
                  All Staff {staffList.length > 0 && <span className="text-sm font-medium text-gray-400">({staffList.length})</span>}
                </h2>
                {staffList.length > 0 && (
                  <div className="flex gap-2">
                    <div className="relative flex-1 sm:w-56">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={staffSearch}
                        onChange={(e) => setStaffSearch(e.target.value)}
                        placeholder="Search staff"
                        className="form-input !pl-9"
                        aria-label="Search staff"
                      />
                    </div>
                    <select value={staffSort} onChange={(e) => setStaffSort(e.target.value)} className="form-select !w-auto" aria-label="Sort staff">
                      <option value="name">By name</option>
                      <option value="location">By location</option>
                      <option value="role">By role</option>
                    </select>
                  </div>
                )}
              </div>
              {loadingStaffList ? (
                <div className="flex justify-center items-center py-10"><Loader size="md" text="Loading staff list..." progress={progress} /></div>
              ) : staffList.length === 0 ? (
                <p className="text-gray-500">No staff created yet.</p>
              ) : visibleStaff.length === 0 ? (
                <p className="text-gray-500 py-6 text-center">No staff match that search.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {visibleStaff.map((staff) => {
                    const open = expandedProfile === staff._id;
                    const editing = editingId === staff._id;
                    const location = staffLocationOf(staff);
                    const onPos = staff.showOnPos !== false;
                    return (
                      <div
                        key={staff._id}
                        className={`rounded-xl border bg-white transition-shadow ${open ? "md:col-span-2 border-sky-300 shadow-md" : "border-gray-200 hover:border-gray-300 hover:shadow-md"}`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (editing) return;
                            setExpandedProfile(open ? null : staff._id);
                          }}
                          aria-expanded={open}
                          className="w-full flex items-center gap-3 p-4 text-left"
                        >
                          {staff.photo ? (
                            <img src={staff.photo} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold shrink-0">
                              {staff.name?.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-gray-900 truncate">{toCamelCase(staff.name || "")}</span>
                              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${staff.role === "admin" || staff.role === "manager" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                                {roleLabel(staff.role)}
                              </span>
                            </div>
                            <div className={`mt-1 flex items-center gap-1 text-xs ${location ? "text-gray-600" : "text-amber-600"}`}>
                              <MapPin size={12} className="shrink-0" />
                              <span className="truncate">{location ? toCamelCase(location) : "No location set"}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${onPos ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                                <Monitor size={11} /> {onPos ? "On POS" : "Hidden on POS"}
                              </span>
                              {staff.onboardingComplete ? (
                                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-green-50 text-green-700"><CheckCircle size={11} /> Onboarded</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700"><Clock size={11} /> Onboarding pending</span>
                              )}
                              {staff.isActive === false && (
                                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-700"><UserX size={11} /> Inactive</span>
                              )}
                            </div>
                          </div>
                          <ChevronDown size={18} className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
                        </button>

                        {open && editing && (
                          <div className="border-t border-gray-100 p-4 space-y-4">
                            <div className="flex items-center gap-3">
                              <div onClick={() => editPhotoRef.current?.click()} className="w-14 h-14 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-400 transition overflow-hidden shrink-0">
                                {uploadingEditPhoto ? <Loader2 size={18} className="text-blue-400 animate-spin" /> : editPhotoPreview ? <img src={editPhotoPreview} alt="Staff" className="w-full h-full object-cover" /> : <Camera size={18} className="text-gray-400" />}
                              </div>
                              <input ref={editPhotoRef} type="file" accept="image/*" onChange={handleEditPhotoUpload} className="hidden" />
                              <span className="text-xs text-gray-500">Tap the photo to change it</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <Field label="Name">
                                <input type="text" name="name" value={editForm.name} onChange={handleEditChange} className="form-input w-full" />
                              </Field>
                              <Field label="Location" hint="Where they work: the till picks it when they sign in.">
                                <select name="location" value={editForm.location} onChange={handleEditChange} className="form-select w-full">
                                  <option value="">No location</option>
                                  {locationChoices(editForm.location).map((loc) => <option key={loc} value={loc}>{loc}</option>)}
                                </select>
                              </Field>
                              <Field label="Role">
                                <select name="role" value={editForm.role} onChange={handleEditChange} className="form-select w-full">
                                  {STAFF_ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              </Field>
                              <Field label="New PIN" hint="4 digits. Leave blank to keep the current PIN.">
                                <input type="password" name="password" value={editForm.password} maxLength={4} inputMode="numeric" onChange={handleEditChange} className="form-input w-full" autoComplete="new-password" />
                              </Field>
                              <Field label="Account name">
                                <input type="text" name="accountName" value={editForm.accountName} onChange={handleEditChange} className="form-input w-full" />
                              </Field>
                              <Field label="Account number">
                                <input type="text" name="accountNumber" value={editForm.accountNumber} onChange={handleEditChange} className="form-input w-full" inputMode="numeric" />
                              </Field>
                              <Field label="Bank">
                                <input type="text" name="bankName" value={editForm.bankName} onChange={handleEditChange} className="form-input w-full" />
                              </Field>
                              <Field label="Salary (₦)">
                                <input type="number" name="salary" value={editForm.salary} onChange={handleEditChange} className="form-input w-full" />
                              </Field>
                            </div>
                            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                              <input type="checkbox" checked={editForm.isActive !== false} onChange={(e) => setEditForm((prev) => ({ ...prev, isActive: e.target.checked }))} className="h-4 w-4 shrink-0 p-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                              Active (can sign in)
                            </label>
                            <div className="border rounded-lg p-3 bg-gray-50">
                              <div className="text-xs font-semibold text-gray-600 mb-2">POS Permissions</div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {POS_PERMISSION_KEYS.map((key) => (
                                  <label key={key} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                                    <input type="checkbox" checked={!!editForm.posPermissions?.[key]} onChange={() => handleEditPermissionToggle(key)} className="h-4 w-4 shrink-0 p-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                    {POS_PERMISSION_LABELS[key] || key}
                                  </label>
                                ))}
                              </div>
                            </div>
                            <div className="flex justify-end gap-2">
                              <button type="button" onClick={cancelEdit} className="btn-action btn-action-secondary btn-sm">Cancel</button>
                              <button type="button" onClick={() => saveEdit(staff._id)} className="btn-action btn-action-primary btn-sm">Save changes</button>
                            </div>
                          </div>
                        )}

                        {open && !editing && (
                          <div className="border-t border-gray-100 p-4 space-y-4 text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <button type="button" onClick={() => startEdit(staff)} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border border-blue-500 text-blue-600 rounded-full hover:bg-blue-500 hover:text-white transition font-semibold">
                                <Pencil size={12} /> Edit
                              </button>
                              <button type="button" onClick={() => handleDelete(staff._id)} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border border-red-500 text-red-600 rounded-full hover:bg-red-500 hover:text-white transition font-semibold">
                                <Trash2 size={12} /> Delete
                              </button>
                              <label className="ml-auto inline-flex items-center gap-2 text-xs text-gray-600">
                                Show on POS
                                <button
                                  type="button"
                                  onClick={() => toggleShowOnPos(staff._id, onPos)}
                                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${onPos ? "bg-green-500" : "bg-gray-300"}`}
                                  aria-pressed={onPos}
                                  aria-label="Show on POS"
                                >
                                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${onPos ? "translate-x-4.5" : "translate-x-0.5"}`} />
                                </button>
                              </label>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <DetailSection title="Account & Pay">
                                <Detail label="Account name" value={staff.accountName ? toCamelCase(staff.accountName) : ""} />
                                <Detail label="Account number" value={staff.accountNumber} />
                                <Detail label="Bank" value={staff.bankName ? toCamelCase(staff.bankName) : ""} />
                                <Detail label="Salary" value={formatCurrency(Number(staff.salary) || 0)} />
                                <Detail label="Penalties" value={staffPenaltyTotal(staff) > 0 ? <span className="text-red-600">−{formatCurrency(staffPenaltyTotal(staff))}</span> : "None"} />
                                <Detail label="Net pay" value={<strong>{formatCurrency(staffNetPay(staff))}</strong>} />
                              </DetailSection>

                              <DetailSection title="Onboarding">
                                <p className={staff.onboardingComplete ? "text-green-700" : "text-amber-700"}>
                                  {staff.onboardingComplete
                                    ? "The onboarding form is back: personal and guarantor details are on file."
                                    : "The onboarding form has not been returned yet."}
                                </p>
                                {staff.onboardingToken && (
                                  <div className="flex flex-wrap gap-1.5 pt-1">
                                    <button type="button" onClick={() => copyOnboardingLink(staff)} className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded hover:bg-indigo-100 transition font-medium">
                                      {copiedLink === staff._id ? <><CheckCircle size={12} /> Copied!</> : <><Copy size={12} /> Copy link</>}
                                    </button>
                                    <button type="button" onClick={() => { setShowOnboardingEmailModal(staff._id); setOnboardingEmail(""); }} className="flex items-center gap-1 text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100 transition font-medium">
                                      <Send size={12} /> Send
                                    </button>
                                    <a href={`${typeof window !== "undefined" ? window.location.origin : ""}/onboarding/${staff.onboardingToken}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs bg-green-50 text-green-600 px-2 py-1 rounded hover:bg-green-100 transition font-medium">
                                      <Link2 size={12} /> Open form
                                    </a>
                                  </div>
                                )}
                              </DetailSection>

                              {staff.penalty?.length > 0 && (
                                <DetailSection title={`Penalties (${staff.penalty.length})`}>
                                  <ul className="space-y-1">
                                    {staff.penalty.map((p, i) => (
                                      <li key={i} className="text-gray-700">
                                        <span className="text-red-600 font-medium">{formatCurrency(Number(p.amount) || 0)}</span>
                                        {p.reason ? <span className="italic"> — {p.reason}</span> : null}
                                        {p.date ? <span className="text-gray-500"> ({new Date(p.date).toLocaleDateString()})</span> : null}
                                      </li>
                                    ))}
                                  </ul>
                                </DetailSection>
                              )}

                              {staff.onboardingData && (
                                <DetailSection title="Personal details">
                                  <Detail label="Full name" value={staff.onboardingData.fullName ? toCamelCase(staff.onboardingData.fullName) : ""} />
                                  <Detail label="Phone" value={staff.onboardingData.phone} />
                                  <Detail label="Email" value={staff.onboardingData.email} />
                                  <Detail label="Date of birth" value={staff.onboardingData.dateOfBirth} />
                                  <Detail label="State of origin" value={staff.onboardingData.stateOfOrigin ? toCamelCase(staff.onboardingData.stateOfOrigin) : ""} />
                                  <Detail label="Address" value={staff.onboardingData.address ? toCamelCase(staff.onboardingData.address) : ""} />
                                  <Detail label="Next of kin" value={staff.onboardingData.nextOfKin ? toCamelCase(staff.onboardingData.nextOfKin) : ""} />
                                  <Detail label="Next of kin phone" value={staff.onboardingData.nextOfKinPhone} />
                                  {staff.onboardingData.photo && <img src={staff.onboardingData.photo} alt="Passport" className="w-16 h-16 rounded-lg object-cover mt-2 border" />}
                                </DetailSection>
                              )}

                              {staff.guarantor?.name && (
                                <DetailSection title="Guarantor">
                                  <Detail label="Name" value={toCamelCase(staff.guarantor.name)} />
                                  <Detail label="Phone" value={staff.guarantor.phone} />
                                  <Detail label="Email" value={staff.guarantor.email} />
                                  <Detail label="Relationship" value={staff.guarantor.relationship ? toCamelCase(staff.guarantor.relationship) : ""} />
                                  <Detail label="Occupation" value={staff.guarantor.occupation ? toCamelCase(staff.guarantor.occupation) : ""} />
                                  <Detail label="Address" value={staff.guarantor.address ? toCamelCase(staff.guarantor.address) : ""} />
                                  {staff.guarantor.photo && <img src={staff.guarantor.photo} alt="Guarantor" className="w-16 h-16 rounded-lg object-cover mt-2 border" />}
                                </DetailSection>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
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
            {paySlipRows.length > 0 ? (
              <>
                {payChunks.map((chunk, index) => {
                  const subtotal = payrollTotal(chunk);
                  return (
                    <div key={index} className="mb-6">
                      <div className="overflow-x-auto">
                        <table className="salary-print-table w-full text-sm">
                          <thead className="table-header-gradient text-white text-xs uppercase tracking-wider border-b-2 border-blue-300">
                            <tr>
                              <th className="px-6 py-3 text-left font-bold">Staff Name</th>
                              <th className="px-6 py-3 text-left font-bold">Location</th>
                              <th className="px-6 py-3 text-left font-bold">Account Name</th>
                              <th className="px-6 py-3 text-left font-bold">Bank Account</th>
                              <th className="px-6 py-3 text-left font-bold">Bank Name</th>
                              <th className="px-6 py-3 text-right font-bold">Salary</th>
                              <th className="px-6 py-3 text-right font-bold">Penalties</th>
                              <th className="px-6 py-3 text-right font-bold">Net Pay</th>
                            </tr>
                          </thead>
                          <tbody>
                            {chunk.map((row) => (
                              <tr key={row._id} className="border-b border-gray-200 hover:bg-blue-50">
                                <td className="px-6 py-3 font-medium text-gray-900">{toCamelCase(row.name || "")}</td>
                                <td className="px-6 py-3 text-gray-700">{toCamelCase(row.location || "-")}</td>
                                <td className="px-6 py-3 text-gray-700">{toCamelCase(row.accountName || "-")}</td>
                                <td className={`px-6 py-3 ${row.accountNumber ? "text-gray-700" : "text-red-600"}`}>{row.accountNumber || "missing"}</td>
                                <td className={`px-6 py-3 ${row.bankName ? "text-gray-700" : "text-red-600"}`}>{row.bankName ? toCamelCase(row.bankName) : "missing"}</td>
                                <td className="px-6 py-3 text-right text-gray-700">{row.salary.toLocaleString()}</td>
                                <td className="px-6 py-3 text-right text-red-600">{row.penalties ? `−${row.penalties.toLocaleString()}` : "—"}</td>
                                <td className="px-6 py-3 text-right font-semibold text-gray-900">{row.netPay.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex flex-wrap justify-between items-center gap-3 mt-2 bg-blue-50 border border-blue-200 px-4 py-3 rounded-lg">
                        <span className="text-sm font-semibold text-blue-800">
                          Table {index + 1} subtotal: {formatCurrency(subtotal)}
                        </span>
                        <button onClick={() => openMemo(chunk, index)} className="btn-action btn-action-primary btn-sm">
                          View Memo
                        </button>
                      </div>
                    </div>
                  );
                })}

                <div className="flex justify-between items-center mt-8 bg-blue-100 px-6 py-4 rounded-lg border-2 border-blue-400 mb-4">
                  <span className="text-xl font-bold text-blue-900">T-Total</span>
                  <span className="text-xl font-bold text-blue-900">{payTotal.toLocaleString()}</span>
                </div>

                {missingBanks.length > 0 && (
                  <p className="text-sm text-red-600 mb-2">
                    No account number or bank for: {missingBanks.map((row) => toCamelCase(row.name)).join(", ")} — the bank cannot pay those.
                  </p>
                )}
                {notBeingPaid.length > 0 && (
                  <p className="text-sm text-gray-500 mb-4">
                    Not on the payroll: {notBeingPaid.map((row) => `${toCamelCase(row.name)} (${row.reason.toLowerCase()})`).join(", ")}.
                  </p>
                )}
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
              <div className="text-center py-12">
                <p className="text-gray-500">
                  {staffList.length === 0
                    ? "No staff members found"
                    : "Nobody is due to be paid — set a salary on a staff member, or check whether penalties cover it."}
                </p>
              </div>
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
