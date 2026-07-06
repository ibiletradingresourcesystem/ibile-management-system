import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import { apiClient } from "@/lib/api-client";
import { showToastMessage } from "@/lib/toast-state";
import {
  getDefaultPosPermissions,
  POS_PERMISSION_KEYS,
  POS_PERMISSION_LABELS,
  STAFF_ROLE_OPTIONS,
  normalizePosPermissions,
  normalizeStaffRole,
} from "@/lib/pos-permissions";

export default function StaffRolesPage() {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [message, setMessage] = useState("");

  const fetchStaff = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await apiClient.get("/api/staff");
      const staff = Array.isArray(res.data) ? res.data : res.data?.data || [];
      setStaffList(
        staff.map((member) => {
          const normalizedRole = normalizeStaffRole(member.role);
          return {
            ...member,
            role: normalizedRole,
            posPermissions: normalizePosPermissions(
              normalizedRole,
              member.posPermissions
            ),
          };
        })
      );
    } catch (err) {
      setMessage(err.response?.data?.error || "Failed to load staff roles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
  }, []);

  useEffect(() => {
    if (!message) return;
    showToastMessage({ title: "Staff roles", text: message });
    setMessage("");
  }, [message]);

  const groupedStaff = useMemo(() => {
    return [...staffList].sort((a, b) => a.name.localeCompare(b.name));
  }, [staffList]);

  const updateStaffMember = (id, updater) => {
    setStaffList((current) =>
      current.map((member) =>
        member._id === id ? { ...member, ...updater(member) } : member
      )
    );
  };

  const handleRoleChange = (member, role) => {
    updateStaffMember(member._id, () => ({
      role,
      posPermissions: getDefaultPosPermissions(role),
    }));
  };

  const handlePermissionToggle = (member, key) => {
    updateStaffMember(member._id, (current) => ({
      posPermissions: {
        ...current.posPermissions,
        [key]: !current.posPermissions?.[key],
      },
    }));
  };

  const savePermissions = async (member) => {
    setSavingId(member._id);
    setMessage("");
    try {
      await apiClient.put(`/api/staff/${member._id}`, {
        name: member.name,
        location: member.location || "",
        role: member.role,
        posPermissions: member.posPermissions,
        accountName: member.accountName || "",
        accountNumber: member.accountNumber || "",
        bankName: member.bankName || "",
        salary: member.salary || 0,
        isActive: member.isActive !== false,
      });
      setMessage(`Saved POS access for ${member.name}.`);
    } catch (err) {
      setMessage(err.response?.data?.error || "Failed to save POS roles");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content space-y-6">
          <div className="page-header">
            <div>
              <h1 className="page-title">Staff Roles</h1>
              <p className="page-subtitle">
                Control which POS tools each staff member can actually open and use.
              </p>
            </div>
          </div>

          <div className="content-card">
            <div className="mb-4 grid gap-3 md:grid-cols-4">
              {STAFF_ROLE_OPTIONS.map((role) => {
                const defaults = getDefaultPosPermissions(role.value);
                const enabledCount = POS_PERMISSION_KEYS.filter((key) => defaults[key]).length;
                return (
                  <div key={role.value} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="text-sm font-semibold text-gray-900">{role.label}</div>
                    <div className="mt-1 text-xs text-gray-600">
                      Default POS access: {enabledCount}/{POS_PERMISSION_KEYS.length}
                    </div>
                  </div>
                );
              })}
            </div>

            {loading ? (
              <div className="py-10">
                <Loader size="md" text="Loading staff roles..." />
              </div>
            ) : (
              <div className="space-y-5">
                {groupedStaff.map((member) => (
                  <div key={member._id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h2 className="text-lg font-semibold text-gray-900">{member.name}</h2>
                        <p className="text-sm text-gray-500">
                          {member.location || "No location assigned"}
                        </p>
                      </div>

                      <div className="flex flex-col gap-3 md:flex-row md:items-center">
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member, e.target.value)}
                          className="form-select min-w-44"
                        >
                          {STAFF_ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => savePermissions(member)}
                          disabled={savingId === member._id}
                          className="btn-action btn-action-primary disabled:opacity-60"
                        >
                          {savingId === member._id ? "Saving..." : "Save Access"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {POS_PERMISSION_KEYS.map((key) => {
                        const enabled = Boolean(member.posPermissions?.[key]);
                        return (
                          <label
                            key={key}
                            className={`flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 text-sm ${
                              enabled
                                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                : "border-gray-200 bg-gray-50 text-gray-700"
                            }`}
                          >
                            <span className="pr-3 font-medium">{POS_PERMISSION_LABELS[key]}</span>
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={() => handlePermissionToggle(member, key)}
                              className="h-4 w-4"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
