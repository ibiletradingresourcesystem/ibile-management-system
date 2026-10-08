const PERMISSION_ALIASES = {
  "expenses.expenses": "expenses.entry",
};

export function normalizePermissions(permissions = []) {
  const normalized = new Set();

  (Array.isArray(permissions) ? permissions : []).forEach((permission) => {
    if (!permission) return;

    normalized.add(permission);

    const alias = PERMISSION_ALIASES[permission];
    if (alias) {
      normalized.add(alias);
    }
  });

  return Array.from(normalized);
}

/**
 * The plain staff role (and the read-only viewer). Whatever pages /setup/users gives them, they
 * work the shop floor: they can place stock orders, count stock and record a loss, but they
 * cannot receive or delete stock orders, move stock any other way, or read the stock movement
 * history. Every role above them is unaffected.
 */
export const BASIC_STAFF_ROLES = ["staff", "viewer"];

export function isBasicStaffRole(role) {
  return BASIC_STAFF_ROLES.includes(String(role || "").trim().toLowerCase());
}

/** The one movement basic staff may record. */
export const BASIC_STAFF_MOVEMENT_REASON = "Operational Loss";

export function normalizeAuthUser(user) {
  if (!user) return null;

  return {
    ...user,
    permissions: normalizePermissions(user.permissions),
  };
}

/**
 * Who may seed products from a spreadsheet: set stock quantities on an import and repair
 * disjointed barcodes. These were admin-only, which left the managers and stock staff who
 * actually run an import without them. Anyone who can already edit products or stock levels
 * by hand can do the same in bulk.
 */
export const PRODUCT_MANAGER_ROLES = ["admin", "sub-admin", "manager", "inventory"];
const PRODUCT_MANAGER_PERMISSIONS = ["manage.products", "stock.management"];

export function canManageProducts(user) {
  if (!user) return false;
  if (PRODUCT_MANAGER_ROLES.includes(user.role)) return true;
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return PRODUCT_MANAGER_PERMISSIONS.some((permission) => permissions.includes(permission));
}
