/**
 * Who may sign in right now, and with what role.
 *
 * A token carries the role and permissions it was issued with for 24 hours, so someone deactivated
 * or moved to a lesser role used to keep the old access until it ran out. Reading the user on every
 * request would add a database trip to every API call, so the users are read at most once a minute
 * per server instance (they are a few dozen short records) and every request checks that list.
 */
import User from "@/models/User";
import { mongooseConnect } from "@/lib/mongodb";
import { normalizePermissions } from "./permission-utils";

const REFRESH_MS = 60 * 1000;
const RETRY_MS = 10 * 1000;

const state =
  globalThis.__ibileUserAccess ||
  (globalThis.__ibileUserAccess = { users: null, loadedAt: 0, nextRefreshAt: 0, loading: null });

function refresh() {
  if (state.loading) return;
  state.loading = (async () => {
    try {
      await mongooseConnect();
      const rows = await User.find({}, "role permissions isActive").lean();
      state.users = new Map(
        rows.map((user) => [
          String(user._id),
          { isActive: user.isActive !== false, role: user.role, permissions: normalizePermissions(user.permissions || []) },
        ])
      );
      state.loadedAt = Date.now();
      state.nextRefreshAt = state.loadedAt + REFRESH_MS;
    } catch (error) {
      console.warn("User access list could not be refreshed:", error?.message || error);
      state.nextRefreshAt = Date.now() + RETRY_MS;
    } finally {
      state.loading = null;
    }
  })();
}

/**
 * This token's user as they stand now: { isActive, role, permissions }, or null when the list has
 * not loaded yet or the token is newer than it (a user added a moment ago).
 */
export function currentAccess(decoded) {
  if (Date.now() >= state.nextRefreshAt) refresh();
  if (!state.users) return null;

  const user = state.users.get(String(decoded.id));
  if (user) return user;
  // Not on the list and the token is older than it: the user has been deleted
  return Number(decoded.iat) * 1000 > state.loadedAt ? null : { isActive: false };
}
