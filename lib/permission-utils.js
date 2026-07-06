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

export function normalizeAuthUser(user) {
  if (!user) return null;

  return {
    ...user,
    permissions: normalizePermissions(user.permissions),
  };
}