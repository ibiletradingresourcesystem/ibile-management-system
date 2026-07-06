export const POS_PERMISSION_KEYS = [
  "sidebarAccess",
  "settingsAccess",
  "printerSettingsAccess",
  "refundAccess",
  "applyDiscount",
  "adjustFloat",
  "closeTill",
  "viewAdvancedOrders",
  "openTillCashEntry",
];

export const POS_PERMISSION_LABELS = {
  sidebarAccess: "POS sidebar access",
  settingsAccess: "POS settings access",
  printerSettingsAccess: "Printer settings access",
  refundAccess: "Refund completed sales",
  applyDiscount: "Apply discounts to sales",
  adjustFloat: "Adjust float",
  closeTill: "Close till",
  viewAdvancedOrders: "View ordered and pending tabs",
  openTillCashEntry: "Enter opening cash balance",
};

export const STAFF_ROLE_OPTIONS = [
  { value: "staff", label: "Staff" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
  { value: "junior staff", label: "Junior Staff" },
];

export function normalizeStaffRole(role) {
  const value = String(role || "staff").trim().toLowerCase();

  if (value === "senior staff") return "manager";
  if (value === "junior staff") return "junior staff";
  if (value === "manager") return "manager";
  if (value === "admin") return "admin";
  return "staff";
}

export function getDefaultPosPermissions(role) {
  const normalizedRole = normalizeStaffRole(role);

  if (normalizedRole === "admin") {
    return {
      sidebarAccess: true,
      settingsAccess: true,
      printerSettingsAccess: true,
      refundAccess: true,
      applyDiscount: true,
      adjustFloat: true,
      closeTill: true,
      viewAdvancedOrders: true,
      openTillCashEntry: true,
    };
  }

  if (normalizedRole === "manager") {
    return {
      sidebarAccess: true,
      settingsAccess: true,
      printerSettingsAccess: true,
      refundAccess: true,
      applyDiscount: true,
      adjustFloat: true,
      closeTill: true,
      viewAdvancedOrders: true,
      openTillCashEntry: true,
    };
  }

  if (normalizedRole === "junior staff") {
    return {
      sidebarAccess: false,
      settingsAccess: true,
      printerSettingsAccess: false,
      refundAccess: false,
      applyDiscount: false,
      adjustFloat: false,
      closeTill: false,
      viewAdvancedOrders: false,
      openTillCashEntry: false,
    };
  }

  return {
    sidebarAccess: false,
    settingsAccess: true,
    printerSettingsAccess: false,
    refundAccess: false,
    applyDiscount: true,
    adjustFloat: false,
    closeTill: false,
    viewAdvancedOrders: false,
    openTillCashEntry: true,
  };
}

export function normalizePosPermissions(role, permissions = {}) {
  const defaults = getDefaultPosPermissions(role);

  return POS_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] =
      typeof permissions?.[key] === "boolean" ? permissions[key] : defaults[key];
    return acc;
  }, {});
}

export function hasPosPermission(staffMember, key) {
  const permissions = normalizePosPermissions(
    staffMember?.role,
    staffMember?.posPermissions
  );

  return Boolean(permissions[key]);
}
