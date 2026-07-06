/**
 * Setup Data Cache Utility
 * Multi-tier caching: sessionStorage (L1) → localStorage (L2) → API (L3)
 * TTL: 24 hours
 */

import { useIndexedDBCache, clearCache as clearIndexedDB } from "./useIndexedDBCache";

const CACHE_KEY_SESSION = "setup_cache_session";
const CACHE_KEY_LOCAL = "setup_cache_local";
const CACHE_KEY_INDEXED = "setup_cache_indexed";
const TTL_HOURS = 24;
const TTL_MINUTES = TTL_HOURS * 60;

/**
 * Get cached setup data with multi-tier strategy
 * @returns {Promise<object>} Setup data with store and user info
 */
export async function getCachedSetup() {
  // L1: sessionStorage (instant, session lifetime)
  const sessionCached = sessionStorage.getItem(CACHE_KEY_SESSION);
  if (sessionCached) {
    try {
      const data = JSON.parse(sessionCached);
      if (isStillValid(data)) {
        console.log("[SETUP CACHE] ✅ Using sessionStorage cache");
        return data.value;
      }
    } catch (err) {
      console.warn("[SETUP CACHE] sessionStorage parse error:", err);
    }
  }

  // L2: localStorage (fast, session lifetime)
  const localCached = localStorage.getItem(CACHE_KEY_LOCAL);
  if (localCached) {
    try {
      const data = JSON.parse(localCached);
      if (isStillValid(data)) {
        // Restore to sessionStorage for next access
        sessionStorage.setItem(CACHE_KEY_SESSION, localCached);
        console.log("[SETUP CACHE] ✅ Using localStorage cache (restored to session)");
        return data.value;
      }
    } catch (err) {
      console.warn("[SETUP CACHE] localStorage parse error:", err);
    }
  }

  // L3: Fetch fresh data from API (with retry for cold starts / transient failures)
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[SETUP CACHE] 🔄 Fetching fresh setup data from API (attempt ${attempt})`);
      const res = await fetch("/api/setup/get");
      if (!res.ok) {
        // Don't retry on auth failures — those need a re-login
        if (res.status === 401 || res.status === 403) {
          throw new Error(`Auth error ${res.status}`);
        }
        throw new Error(`Failed to fetch setup (HTTP ${res.status})`);
      }
      
      const setupData = await res.json();
      
      // Store in all caches
      const cacheEntry = {
        value: setupData,
        timestamp: Date.now(),
        ttl: TTL_MINUTES * 60 * 1000,
      };
      
      const cacheString = JSON.stringify(cacheEntry);
      sessionStorage.setItem(CACHE_KEY_SESSION, cacheString);
      localStorage.setItem(CACHE_KEY_LOCAL, cacheString);
      
      console.log("[SETUP CACHE] ✅ Fetched and cached fresh setup data");
      return setupData;
    } catch (err) {
      lastError = err;
      if (attempt < 3 && !err.message?.includes("Auth error")) {
        console.warn(`[SETUP CACHE] Attempt ${attempt} failed, retrying in ${attempt * 500}ms...`);
        await new Promise(r => setTimeout(r, attempt * 500));
      }
    }
  }
  console.error("[SETUP CACHE] ❌ All attempts failed:", lastError);
  throw lastError;
}

/**
 * Check if cache entry is still valid (not expired)
 */
function isStillValid(cachedEntry) {
  if (!cachedEntry || !cachedEntry.timestamp || !cachedEntry.ttl) {
    return false;
  }
  
  const age = Date.now() - cachedEntry.timestamp;
  return age < cachedEntry.ttl;
}

/**
 * Clear all setup caches
 */
export function clearSetupCache() {
  sessionStorage.removeItem(CACHE_KEY_SESSION);
  localStorage.removeItem(CACHE_KEY_LOCAL);
  clearIndexedDB(CACHE_KEY_INDEXED).catch(err =>
    console.warn("[SETUP CACHE] Failed to clear IndexedDB:", err)
  );
  console.log("[SETUP CACHE] 🧹 All caches cleared");
}

/**
 * Get specific data from cached setup
 * Helpers for common usage patterns
 */
export async function getCachedLocations() {
  const setup = await getCachedSetup();
  return setup?.store?.locations || [];
}

export async function getCachedStoreName() {
  const setup = await getCachedSetup();
  return setup?.store?.storeName || "";
}

export async function getCachedAdminUser() {
  const setup = await getCachedSetup();
  return setup?.user || null;
}

/**
 * Force refresh setup from server
 */
export async function refreshSetupCache() {
  console.log("[SETUP CACHE] 🔄 Forcing refresh from server");
  clearSetupCache();
  return getCachedSetup();
}
