/**
 * The phone counter's sign-in (issued by /api/stock-take/mobile/auth) and what it may see.
 */
import { verifyScopedToken } from "@/lib/jwt";
import { normalizeStaffRole } from "@/lib/pos-permissions";

export const MOBILE_SCOPE = "stock-take-mobile";

/** The signed token issued by /api/stock-take/mobile/auth. */
export function parseMobileToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return verifyScopedToken(authHeader.slice(7), MOBILE_SCOPE);
}

/** Only an admin is shown what the system holds. A token from before roles were kept is not. */
export const seesSystemQty = (session) => normalizeStaffRole(session?.role || "staff") === "admin";
