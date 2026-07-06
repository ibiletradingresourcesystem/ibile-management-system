/**
 * Locations Cache Utility
 * Extracts from setup cache, provides convenience methods
 * TTL: Synced with setup cache (24 hours)
 */

import { getCachedSetup, getCachedLocations } from "./setupCache";

const CACHE_KEY = "locations_cache_local";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get all locations from setup cache
 * Falls back to localStorage if setup is temporarily unavailable
 * @returns {Promise<Array>} Array of location objects
 */
export async function getCachedLocationsList() {
  try {
    // Try primary method through setup cache
    const locations = await getCachedLocations();
    
    if (locations && locations.length > 0) {
      // Backup to localStorage
      const cacheEntry = {
        locations,
        timestamp: Date.now(),
        ttl: CACHE_TTL,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cacheEntry));
      
      console.log("[LOCATIONS CACHE] ✅ Retrieved from setup cache (${locations.length} items)");
      return locations;
    }
  } catch (err) {
    console.warn("[LOCATIONS CACHE] Setup cache failed:", err);
  }

  // Fallback to localStorage
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      const age = Date.now() - data.timestamp;
      
      if (age < data.ttl) {
        console.log("[LOCATIONS CACHE] ✅ Using localStorage fallback");
        return data.locations || [];
      }
    }
  } catch (err) {
    console.warn("[LOCATIONS CACHE] localStorage error:", err);
  }

  console.warn("[LOCATIONS CACHE] ⚠️ No locations available");
  return [];
}

/**
 * Get location by ID
 * @param {string} locationId - Location ID
 * @returns {Promise<Object>} Location object or null
 */
export async function getLocationById(locationId) {
  const locations = await getCachedLocationsList();
  return locations.find(loc => loc._id === locationId) || null;
}

/**
 * Get location by name
 * @param {string} locationName - Location name
 * @returns {Promise<Object>} Location object or null
 */
export async function getLocationByName(locationName) {
  const locations = await getCachedLocationsList();
  return locations.find(loc => loc.name === locationName) || null;
}

/**
 * Get location names as array (for dropdowns)
 * @returns {Promise<Array>} Array of location names
 */
export async function getLocationNames() {
  const locations = await getCachedLocationsList();
  return locations
    .filter(loc => loc.isActive !== false)
    .map(loc => loc.name)
    .sort();
}

/**
 * Get locations map (id -> name)
 * @returns {Promise<Object>} Map of location ID to name
 */
export async function getLocationsMap() {
  const locations = await getCachedLocationsList();
  const map = {};
  
  locations.forEach(loc => {
    if (loc._id) {
      map[loc._id] = loc.name || "Unknown";
    }
    if (loc.name) {
      map[loc.name] = loc.name; // Also map by name
    }
  });
  
  return map;
}

/**
 * Get active (non-archived) locations
 * @returns {Promise<Array>} Array of active locations
 */
export async function getActiveLocations() {
  const locations = await getCachedLocationsList();
  return locations.filter(loc => loc.isActive !== false);
}

/**
 * Clear locations cache
 */
export function clearLocationsCache() {
  localStorage.removeItem(CACHE_KEY);
  console.log("[LOCATIONS CACHE] 🧹 Cache cleared");
}

/**
 * Refresh locations from setup
 */
export async function refreshLocationsCache() {
  clearLocationsCache();
  return getCachedLocationsList();
}
