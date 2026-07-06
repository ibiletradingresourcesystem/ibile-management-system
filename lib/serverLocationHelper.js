// lib/serverLocationHelper.js
// Server-side location helper for API routes

import Store from "@/models/Store";

export async function buildLocationCache() {
  const locationCache = {
    // Special cases
    "vendor": "Vendor",
    "Vendor": "Vendor",
    "null": "Vendor",
    "undefined": "Unknown",
    "": "Unknown",
  };

  try {
    // Fetch ALL stores to get ALL locations
    const stores = await Store.find({}).select("storeName locations").lean();
    
    if (!stores || stores.length === 0) {
      console.warn("⚠️ No stores found in database");
      return locationCache;
    }

    let totalLocations = 0;

    // Build comprehensive cache from all stores
    for (const store of stores) {
      if (!store.locations || !Array.isArray(store.locations)) {
        continue;
      }

      for (const loc of store.locations) {
        if (!loc || !loc._id || !loc.name) {
          continue;
        }

        // Convert ObjectId to string
        const locId = String(loc._id);
        const locName = loc.name;

        // Only cache valid 24-char ObjectId strings
        if (locId && locId.length === 24) {
          locationCache[locId] = locName;
          totalLocations++;
        }
      }
    }

    console.log(`✅ Built location cache with ${totalLocations} locations`);
    return locationCache;

  } catch (err) {
    console.error("❌ Error building location cache:", err.message);
    return locationCache;
  }
}

/**
 * Direct location lookup by storeId and locationId
 * Used as fallback when buildLocationCache doesn't find a location
 */
export async function resolveLocationFromStore(storeId, locationId) {
  if (!storeId || !locationId) {
    return "Unknown";
  }

  try {
    const store = await Store.findById(storeId).select("locations").lean();
    
    if (!store || !store.locations || !Array.isArray(store.locations)) {
      return "Unknown";
    }

    // Convert locationId to string for comparison
    const locationIdStr = String(locationId);

    for (const loc of store.locations) {
      if (!loc || !loc._id) continue;
      
      const locIdStr = String(loc._id);
      if (locIdStr === locationIdStr) {
        return loc.name || "Unknown";
      }
    }

    return "Unknown";

  } catch (err) {
    console.error(`❌ Error resolving location from store:`, err.message);
    return "Unknown";
  }
}

/**
 * Resolves a location ID to a location name
 * @param {string|ObjectId|number|null|undefined} locationId - The location identifier
 * @param {Object} locationCache - Pre-built location cache (from buildLocationCache)
 * @param {string|ObjectId} storeId - Optional storeId for fallback lookup
 * @returns {Promise<string>} The location name, or "Unknown" if not found
 */
export async function resolveLocationName(locationId, locationCache, storeId = null) {
  // Handle null/undefined
  if (locationId === null || locationId === undefined) {
    return "Vendor";
  }

  // Convert to string for lookup
  const lookupKey = String(locationId);

  // Empty string or special values
  if (!lookupKey || lookupKey === "" || lookupKey === "null" || lookupKey === "undefined") {
    return "Vendor";
  }

  // Direct lookup in cache
  if (locationCache[lookupKey]) {
    return locationCache[lookupKey];
  }

  // Try lowercase lookup
  const lowerKey = lookupKey.toLowerCase();
  if (locationCache[lowerKey]) {
    return locationCache[lowerKey];
  }

  // Last resort: if storeId provided, query directly from database
  if (storeId) {
    return await resolveLocationFromStore(storeId, locationId);
  }

  // If it's a short string, might be a name already
  if (lookupKey.length <= 20 && !/^[0-9a-f]{24}$/i.test(lookupKey)) {
    return lookupKey;
  }

  return "Unknown";
}

/**
 * Helper to enrich an array of objects with location names
 * @param {Array} items - Array of objects with locationId field
 * @param {string} idField - The field name containing the location ID (default: 'locationId')
 * @param {string} nameField - The field name to set with the location name (default: 'locationName')
 * @returns {Promise<Array>} The items with locationName populated
 */
export async function enrichWithLocationNames(items, idField = 'locationId', nameField = 'locationName') {
  if (!items || items.length === 0) return items;

  const locationCache = await buildLocationCache();

  // Use Promise.all to properly await all async resolveLocationName calls
  return Promise.all(items.map(async (item) => ({
    ...item,
    [nameField]: await resolveLocationName(item[idField], locationCache),
  })));
}

/**
 * Get all locations as a simple array
 * @returns {Array<{id: string, name: string}>} Array of location objects
 */
export async function getAllLocations() {
  try {
    const stores = await Store.find({}).select("locations").lean();
    const locations = [];

    for (const store of stores) {
      if (store.locations && Array.isArray(store.locations)) {
        for (const loc of store.locations) {
          locations.push({
            id: String(loc._id),
            name: loc.name || "Unknown",
          });
        }
      }
    }

    return locations;
  } catch (err) {
    console.error("❌ Error getting all locations:", err.message);
    return [];
  }
}
