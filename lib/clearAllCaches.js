/**
 * Centralized cache clearing utility
 * Clears ALL app caches to ensure fresh data on login/logout/auth failure.
 */

import { clearSetupCache } from "./setupCache";
import { clearCategoriesCache } from "./categoriesCache";
import { clearLocationsCache } from "./locationsCache";
import { clearLogoCache } from "./storeLogo";
import { clearAllCache as clearAllIndexedDB } from "./useIndexedDBCache";

/**
 * Clear every client-side cache in the app.
 * Call on login, logout, or 401 auth failures.
 */
export async function clearAllAppCaches() {
  try {
    // Clear setup cache (sessionStorage + localStorage)
    clearSetupCache();

    // Clear categories cache (localStorage)
    clearCategoriesCache();

    // Clear locations cache (localStorage)
    clearLocationsCache();

    // Clear store logo cache (localStorage)
    clearLogoCache();

    // Clear IndexedDB caches (products, etc.)
    await clearAllIndexedDB();

    console.log("[CACHE] All app caches cleared");
  } catch (err) {
    console.warn("[CACHE] Error clearing caches:", err);
  }
}
