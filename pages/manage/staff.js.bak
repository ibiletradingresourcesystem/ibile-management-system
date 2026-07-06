"use client";

import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import useProgress from "@/lib/useProgress";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Printer, Mail } from "lucide-react";
import { useRouter } from "next/router";
import { apiClient } from "@/lib/api-client";
import { STAFF_ROLE_OPTIONS, normalizeStaffRole } from "@/lib/pos-permissions";

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
  const [salaryData, setSalaryData] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState("All Locations");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("list");
  const [editingId, setEditingId] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [loadingStaffList, setLoadingStaffList] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [locations, setLocations] = useState([]);

  const [formData, setFormData] = useState({
    name: "",
    password: "",
    location: "",
    role: "staff",
    accountName: "",
    accountNumber: "",
    bankName: "",
    salary: "",
  });

  const [editForm, setEditForm] = useState({
    name: "",
    password: "",
    location: "",
    role: "staff",
    accountName: "",
    accountNumber: "",
    bankName: "",
    salary: "",
  });

  const [penaltyForm, setPenaltyForm] = useState({
    staffId: "",
    reason: "",
    amount: "",
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
      setStaffList(
        staff.map((member) => ({
          ...member,
          role: normalizeStaffRole(member.role),
        }))
      );
      calculateSalaries(staff);
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
        
        // Set default location to first location
        if (locationNames.length > 0) {
          setFormData((prev) => ({
            ...prev,
            location: locationNames[0],
          }));
        }
      }
    } catch (err) {
      console.error("Error fetching locations:", err);
      // Fallback: extract locations from staff data if API fails
      try {
        const staffRes = await apiClient.get("/api/staff");
        const staff = Array.isArray(staffRes.data) ? staffRes.data : staffRes.data?.data || [];
        if (staff.length > 0) {
          const uniqueLocations = [...new Set(staff.map((s) => s.location).filter(Boolean))];
          if (uniqueLocations.length > 0) {
            setLocations(uniqueLocations);
            setFormData((prev) => ({
              ...prev,
              location: uniqueLocations[0],
            }));
          }
        }
      } catch (fallbackErr) {
        console.error("Fallback location fetch error:", fallbackErr);
      }
    }
  };

  useEffect(() => {
    fetchStaff();
    fetchLocations();
  }, []);

  useEffect(() => {
    calculateSalaries(staffList);
  }, [selectedLocation, staffList]);

  const calculateSalaries = (staff) => {
    const grouped = {};
    staff.forEach((s) => {
      const location = s.location || "Default";
      if (!grouped[location]) {
        grouped[location] = [];
      }
      grouped[location].push(s);
    });
    
    let toDisplay = Object.entries(grouped);
    if (selectedLocation !== "All Locations") {
      toDisplay = toDisplay.filter(([location]) => location === selectedLocation);
    }
    setSalaryData(toDisplay);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    if (name === "name") {
      setFormData((prev) => ({ ...prev, name: toCamelCase(value) }));
    } else if (name === "password") {
      // Only allow 4 digits
      if (/^\d{0,4}$/.test(value)) {
        setFormData((prev) => ({ ...prev, [name]: value }));
      }
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    if (name === "name") {
      setEditForm((prev) => ({ ...prev, name: toCamelCase(value) }));
    } else if (name === "password") {
      // Only allow 4 digits
      if (/^\d{0,4}$/.test(value)) {
        setEditForm((prev) => ({ ...prev, [name]: value }));
      }
    } else {
      setEditForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handlePenaltyChange = (e) => {
    const { name, value } = e.target;
    setPenaltyForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.password) {
      setMessage("Please fill in required fields");
      return;
    }
    try {
      await apiClient.post("/api/staff", formData);
      setMessage("Staff added successfully.");
      setFormData({
        name: "",
        password: "",
        location: locations[0] || "",
        role: "staff",
        accountName: "",
        accountNumber: "",
        bankName: "",
        salary: "",
      });
      fetchStaff();
    } catch (err) {
      setMessage(err.response?.data?.error || "Failed to create staff");
    }
  };

  const handlePenaltySubmit = async (e) => {
    e.preventDefault();
    if (!penaltyForm.staffId || !penaltyForm.reason || !penaltyForm.amount) {
      setMessage("All penalty fields are required.");
      return;
    }

    try {
      await apiClient.post("/api/staff/penalties", {
        staffId: penaltyForm.staffId,
        amount: penaltyForm.amount,
        reason: penaltyForm.reason,
        date: penaltyForm.date || new Date().toISOString(),
      });
      setMessage("Penalty submitted successfully.");
      setPenaltyForm({
        staffId: "",
        reason: "",
        amount: "",
        date: new Date().toISOString().split("T")[0],
      });
      fetchStaff();
      setActiveTab("list");
    } catch (err) {
      console.error("Penalty submission error:", err);
      setMessage(err.response?.data?.error || "Error submitting penalty");
    }
  };

  const startEdit = (staff) => {
    setEditingId(staff._id);
    setEditForm({
      name: staff.name || "",
      password: "",
      location: staff.location || "",
      role: normalizeStaffRole(staff.role) || "staff",
      accountName: staff.accountName || "",
      accountNumber: staff.accountNumber || "",
      bankName: staff.bankName || "",
      salary: staff.salary || "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({
      name: "",
      password: "",
      location: "",
      role: "staff",
      accountName: "",
      accountNumber: "",
      bankName: "",
      salary: "",
    });
  };

  const saveEdit = async (id) => {
    try {
      await apiClient.put(`/api/staff/${id}`, editForm);
      setMessage("Staff updated successfully.");
      setEditingId(null);
      fetchStaff();
    } catch (err) {
      setMessage(err.response?.data?.error || "Error updating staff");
    }
  };

  const calculateTotal = (staff) => {
    return staff.reduce((sum, s) => sum + (parseFloat(s.salary) || 0), 0);
  };

  const calculateGrandTotal = () => {
    return staffList.reduce((sum, s) => sum + (parseFloat(s.salary) || 0), 0);
  };

  const handleDelete = async (id) => {
    try {
      await apiClient.delete(`/api/staff/${id}`);
      setMessage("Staff deleted successfully.");
      fetchStaff();
    } catch (err) {
      setMessage(err.response?.data?.error || "Failed to delete staff");
    }
  };

  const getInitials = (name) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  const getAvatarColor = (index) => {
    const colors = [
      "bg-blue-500",
      "bg-purple-500",
      "bg-pink-500",
      "bg-green-500",
      "bg-yellow-500",
      "bg-red-500",
      "bg-indigo-500",
      "bg-teal-500",
    ];
    return colors[index % colors.length];
  };

  const handleSendingMail = async () => {
    setIsSending(true);
    try {
      // Call the new salary-mail endpoint
      const response = await apiClient.post("/api/salary-mail", {});
      setMessage(response.data.message || "Salary email sent successfully!");
    } catch (err) {
      console.error("Error sending emails:", err);
      setMessage(err.response?.data?.error || err.response?.data?.message || "Failed to send salary emails");
    } finally {
      setIsSending(false);
    }
  };

  const handlePrintSalaryTable = () => {
    const printWindow = window.open('', '', 'width=900,height=600');
    const tableHTML = document.querySelector('.overflow-x-auto table')?.outerHTML || '';
    const totalAmount = formatCurrency(calculateGrandTotal() || 0, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    
    const content = `
      <html>
      <head>
        <title>Salary Table Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
          h1 { color: #1e3a8a; text-align: center; margin-bottom: 10px; }
          .date { text-align: center; color: #666; font-size: 12px; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th { background: #dbeafe; padding: 12px; text-align: left; border: 1px solid #bfdbfe; font-weight: bold; }
          td { padding: 10px; border: 1px solid #e5e7eb; }
          tr:nth-child(even) { background: #f9fafb; }
          .total-section { background: #dbeafe; padding: 15px; margin-top: 20px; border-radius: 5px; text-align: right; font-weight: bold; font-size: 16px; }
          @media print { body { margin: 0; } button { display: none; } }
        </style>
      </head>
      <body>
        <h1>Staff Salary Report</h1>
        <div class="date">Generated on: ${new Date().toLocaleDateString()}</div>
        ${tableHTML}
        <div class="total-section">Grand Total: ${totalAmount}</div>
        <p style="text-align: center; margin-top: 40px; color: #999; font-size: 11px; page-break-after: avoid;">---End of Report---</p>
      </body>
      </html>
    `;
    
    printWindow.document.write(content);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 250);
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
        {/* Header */}
        <div className="page-header">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="page-title">Manage Staff Logins</h1>
              <p className="page-subtitle">Create staff accounts, maintain profiles, and manage payroll details.</p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/manage/staff-roles")}
              className="btn-action btn-action-secondary"
            >
              Manage POS Roles
            </button>
          </div>
        </div>

        {/* Add New Staff Form */}
        <div className="content-card mb-6">
          <h2 className="text-base md:text-lg font-semibold mb-4 text-sky-700">Add New Staff</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-4">
            <input
              type="text"
              name="name"
              placeholder="Staff Name"
              value={formData.name}
              onChange={handleInputChange}
              className="form-input"
              required
            />
            <input
              type="password"
              name="password"
              placeholder="Password (4 digits)"
              value={formData.password}
              maxLength={4}
              inputMode="numeric"
              onChange={handleInputChange}
              className="form-input"
              required
            />
            <select
              name="location"
              value={formData.location}
              onChange={handleInputChange}
              className="form-select"
            >
              <option value="">Select Location</option>
              {locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
            <select
              name="role"
              value={formData.role}
              onChange={handleInputChange}
              className="border border-gray-300 p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {STAFF_ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <input
              type="text"
              name="accountName"
              placeholder="Account Name"
              value={formData.accountName}
              onChange={handleInputChange}
              className="border border-gray-300 p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              name="accountNumber"
              placeholder="Account Number"
              value={formData.accountNumber}
              onChange={handleInputChange}
              className="border border-gray-300 p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              name="bankName"
              placeholder="Bank Name"
              value={formData.bankName}
              onChange={handleInputChange}
              className="border border-gray-300 p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="number"
              name="salary"
              placeholder="Salary Amount"
              value={formData.salary}
              onChange={handleInputChange}
              className="border border-gray-300 p-3 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </form>

          {message && <p className="text-sm text-sky-700 mb-3">{message}</p>}

          <button
            onClick={handleSubmit}
            className="btn-action-primary w-full"
          >
            Add Staff
          </button>
        </div>

        {/* Main Content */}
        <div className="flex flex-col lg:flex-row justify-between gap-6">
          {/* All Staff List */}
          <div className="content-card w-full lg:w-2/3">
            <h2 className="text-xl font-semibold mb-6 text-sky-700">All Staff</h2>

            {loadingStaffList ? (
              <div className="flex justify-center items-center py-10">
                <Loader size="md" text="Loading staff list..." progress={progress} />
              </div>
            ) : staffList.length === 0 ? (
              <p className="text-gray-500">No staff created yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {staffList.map((staff) => (
                  <div
                    key={staff._id}
                    className="p-4 rounded-lg shadow-sm hover:shadow-md transition border border-gray-200 bg-white"
                  >
                    {editingId === staff._id ? (
                      <div className="space-y-3">
                        <input
                          type="text"
                          name="name"
                          value={editForm.name}
                          onChange={handleEditChange}
                          className="border border-gray-300 p-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <select
                          name="location"
                          value={editForm.location}
                          onChange={handleEditChange}
                          className="border border-gray-300 p-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select Location</option>
                          {locations.map((loc) => (
                            <option key={loc} value={loc}>
                              {loc}
                            </option>
                          ))}
                        </select>
                        <select
                          name="role"
                          value={editForm.role}
                          onChange={handleEditChange}
                          className="border border-gray-300 p-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {STAFF_ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <input
                          type="password"
                          name="password"
                          placeholder="Leave blank to keep current"
                          value={editForm.password}
                          maxLength={4}
                          inputMode="numeric"
                          onChange={handleEditChange}
                          className="border border-gray-300 p-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          name="accountName"
                          placeholder="Account Name"
                          value={editForm.accountName}
                          onChange={handleEditChange}
                          className="border border-gray-300 p-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          name="accountNumber"
                          placeholder="Account Number"
                          value={editForm.accountNumber}
                          onChange={handleEditChange}
                          className="border border-gray-300 p-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <input
                          type="text"
                          name="bankName"
                          placeholder="Bank Name"
                          value={editForm.bankName}
                          onChange={handleEditChange}
                          className="border border-gray-300 p-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <input
                          type="number"
                          name="salary"
                          placeholder="Salary Amount"
                          value={editForm.salary}
                          onChange={handleEditChange}
                          className="border border-gray-300 p-2 rounded w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            onClick={() => saveEdit(staff._id)}
                            className="bg-green-600 text-white px-4 py-1 rounded hover:bg-green-700 text-sm font-semibold"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="bg-gray-400 text-white px-4 py-1 rounded hover:bg-gray-500 text-sm font-semibold"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-4 w-full">
                        <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-lg flex-shrink-0">
                          {staff.name?.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <div className="text-lg font-semibold text-gray-800">{staff.name}</div>
                          <div className="text-sm text-gray-600 mb-2"> {staff.location}</div>
                          <span
                            className={`text-xs font-medium px-2 py-1 rounded-full inline-block ${
                              staff.role === "admin" || staff.role === "manager"
                                ? "bg-red-100 text-red-700"
                                : "bg-blue-100 text-blue-700"
                            }`}
                          >
                            {STAFF_ROLE_OPTIONS.find((option) => option.value === staff.role)?.label || staff.role}
                          </span>
                        </div>
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => startEdit(staff)}
                            className="text-xs px-3 py-1 border border-blue-500 text-blue-600 rounded-full hover:bg-blue-500 hover:text-white transition font-semibold"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm("Delete this staff member?")) {
                                handleDelete(staff._id);
                              }
                            }}
                            className="text-xs px-3 py-1 border border-red-500 text-red-600 rounded-full hover:bg-red-500 hover:text-white transition font-semibold"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <p className="text-sm text-gray-500 mt-6">Note: Passwords are hashed and not displayed for security.</p>
          </div>

          {/* Staff Penalty */}
          <div className="bg-white p-6 shadow rounded-lg w-full lg:w-1/3">
            <h2 className="text-xl font-semibold mb-4 text-blue-700">Staff Penalty</h2>

            {/* Tab Pills */}
            <div className="flex space-x-4 mb-6">
              <button
                className={`px-4 py-2 rounded-full font-semibold transition ${
                  activeTab === "list"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
                onClick={() => setActiveTab("list")}
              >
                Penalty List
              </button>
              <button
                className={`px-4 py-2 rounded-full font-semibold transition ${
                  activeTab === "form"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
                onClick={() => setActiveTab("form")}
              >
                Add Penalty
              </button>
            </div>

            {/* Penalty List */}
            {activeTab === "list" && (
              <div className="space-y-4">
                {staffList.filter((s) => s.penalty && s.penalty.length).length === 0 ? (
                  <p className="text-gray-500">No penalties recorded.</p>
                ) : (
                  staffList
                    .filter((s) => s.penalty && s.penalty.length)
                    .map((staff) => (
                      <div
                        key={staff._id}
                        className="bg-white border border-gray-200 p-5 rounded-lg shadow hover:shadow-md transition"
                      >
                        <div className="flex justify-between items-center mb-2">
                          <h3 className="text-lg font-semibold text-blue-800">
                            {staff.name}
                            <span className="text-sm text-gray-500 ml-2">({staff.role})</span>
                          </h3>
                          <span className="text-sm bg-red-100 text-red-600 px-2 py-1 rounded-full">
                            {staff.penalty.length} Penalt{staff.penalty.length > 1 ? "ies" : "y"}
                          </span>
                        </div>
                        <ul className="space-y-2 pl-4 border-l-2 border-blue-100">
                          {staff.penalty.map((p, i) => (
                            <li key={i} className="text-sm text-gray-800">
                              <span className="font-medium text-red-700">{p.amount}</span>  <span className="italic">{p.reason}</span>{" "}
                              <span className="text-gray-500">({new Date(p.date).toLocaleDateString()})</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))
                )}
              </div>
            )}

            {/* Add Penalty Form */}
            {activeTab === "form" && (
              <form onSubmit={handlePenaltySubmit} className="grid grid-cols-1 gap-4">
                <select
                  name="staffId"
                  value={penaltyForm.staffId}
                  onChange={handlePenaltyChange}
                  className="border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Select Staff</option>
                  {staffList.map((staff) => (
                    <option key={staff._id} value={staff._id}>
                      {staff.name} ({staff.role})
                    </option>
                  ))}
                </select>

                <input
                  type="number"
                  name="amount"
                  inputMode="numeric"
                  placeholder="Penalty Amount"
                  value={penaltyForm.amount}
                  onChange={handlePenaltyChange}
                  className="border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />

                <input
                  type="text"
                  name="reason"
                  placeholder="Reason"
                  value={penaltyForm.reason}
                  onChange={handlePenaltyChange}
                  className="border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />

                <input
                  type="date"
                  name="date"
                  value={penaltyForm.date}
                  onChange={handlePenaltyChange}
                  className="border border-gray-300 p-2 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />

                <button
                  type="submit"
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-semibold transition"
                >
                  Submit
                </button>
              </form>
            )}
            
            {message && <p className="text-sm text-blue-700 mt-4 p-3 bg-blue-50 rounded">{message}</p>}
          </div>
        </div>

        {/* Salary Table Section */}
        <div className="bg-white mt-8 p-6 shadow rounded-lg w-full">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-blue-700">Salary Table</h2>
          </div>

          {staffList.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-blue-100 border-b-2 border-blue-300">
                    <tr>
                      <th className="px-6 py-3 text-left font-bold text-gray-900">Staff Name</th>
                      <th className="px-6 py-3 text-left font-bold text-gray-900">Location</th>
                      <th className="px-6 py-3 text-left font-bold text-gray-900">Account Name</th>
                      <th className="px-6 py-3 text-left font-bold text-gray-900">Bank Account</th>
                      <th className="px-6 py-3 text-left font-bold text-gray-900">Bank Name</th>
                      <th className="px-6 py-3 text-right font-bold text-gray-900">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffList.map((s) => (
                      <tr key={s._id} className="border-b border-gray-200 hover:bg-blue-50">
                        <td className="px-6 py-3 font-medium text-gray-900">{s.name}</td>
                        <td className="px-6 py-3 text-gray-700">{s.location || "-"}</td>
                        <td className="px-6 py-3 text-gray-700">{s.accountName || "-"}</td>
                        <td className="px-6 py-3 text-gray-700">{s.accountNumber || "-"}</td>
                        <td className="px-6 py-3 text-gray-700">{s.bankName || "-"}</td>
                        <td className="px-6 py-3 text-right font-medium text-gray-900">
                          {(parseFloat(s.salary) || 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Grand Total */}
              <div className="flex justify-between items-center mt-8 bg-blue-100 px-6 py-4 rounded-lg border-2 border-blue-400 mb-6">
                <span className="text-xl font-bold text-blue-900">T-Total</span>
                <span className="text-xl font-bold text-blue-900">{calculateGrandTotal().toLocaleString()}</span>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3">
                <button
                  onClick={handleSendingMail}
                  disabled={isSending}
                  className={`${
                    isSending ? "bg-gray-400 cursor-not-allowed" : "bg-gray-600 hover:bg-gray-700"
                  } text-white px-6 py-2 rounded-lg font-semibold flex items-center gap-2 transition-colors`}
                >
                  <Mail size={18} />
                  {isSending ? "Sending Mail..." : "Send Salary Mail"}
                </button>
                <button
                  onClick={handlePrintSalaryTable}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold flex items-center gap-2 transition-colors"
                >
                  <Printer size={18} />
                  Print Salary Table
                </button>
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-500">No staff members found</p>
            </div>
          )}
        </div>
        </div>
      </div>
    </Layout>
  );
}

