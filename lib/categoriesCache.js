/**
 * Categories Cache Utility
 * Read once and reuse until explicit invalidation on category mutations.
 */

const CACHE_KEY = "categories_cache_v1";
const CACHE_TTL = 24 * 60 * 60 * 1000; // fallback expiry
const CACHE_VERSION_KEY = "categories_cache_version";

function getCacheVersion() {
  try {
    return localStorage.getItem(CACHE_VERSION_KEY) || "0";
  } catch {
    return "0";
  }
}

/**
 * Get cached categories (localStorage backed)
 * @returns {Promise<Array>} Array of category objects
 */
export async function getCachedCategories() {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      const age = Date.now() - (data.timestamp || 0);
      const isFresh = age < (data.ttl || CACHE_TTL);
      const isSameVersion = (data.version || "0") === getCacheVersion();

      if (isFresh && isSameVersion && Array.isArray(data.categories)) {
        return data.categories;
      }
    }
  } catch {
    // Ignore cache parse/storage errors and fall back to API.
  }

  try {
    const res = await fetch("/api/categories");
    if (!res.ok) throw new Error("Failed to fetch categories");

    const categories = await res.json();
    const catArray = Array.isArray(categories)
      ? categories
      : Array.isArray(categories?.categories)
        ? categories.categories
        : [];

    const cacheEntry = {
      categories: catArray,
      timestamp: Date.now(),
      ttl: CACHE_TTL,
      version: getCacheVersion(),
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheEntry));
    return catArray;
  } catch {
    return [];
  }
}

/**
 * Get category map (id -> name)
 * @returns {Promise<Object>} Map of category ID to name
 */
export async function getCachedCategoryMap() {
  const categories = await getCachedCategories();
  const map = {};

  categories.forEach((cat) => {
    if (cat?._id) {
      map[cat._id] = cat.name || "Uncategorized";
    }
  });

  return map;
}

/**
 * Get category by ID
 * @param {string} categoryId - Category ID to lookup
 * @returns {Promise<Object>} Category object or null
 */
export async function getCategoryById(categoryId) {
  const categories = await getCachedCategories();
  return categories.find((cat) => cat._id === categoryId) || null;
}

/**
 * Clear local category cache payload.
 */
export function clearCategoriesCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // no-op
  }
}

/**
 * Invalidate categories cache globally for this browser profile.
 * Next read will fetch fresh categories from API.
 */
export function invalidateCategoriesCache() {
  try {
    const currentVersion = Number(localStorage.getItem(CACHE_VERSION_KEY) || "0");
    localStorage.setItem(CACHE_VERSION_KEY, String(currentVersion + 1));
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // no-op
  }
}

/**
 * Refresh categories from API
 */
export async function refreshCategoriesCache() {
  invalidateCategoriesCache();
  return getCachedCategories();
}

/**
 * Create a new category (and invalidate cache)
 * @param {Object} categoryData - New category data
 * @returns {Promise<Object>} Created category
 */
export async function createCategoryAndRefresh(categoryData) {
  const res = await fetch("/api/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(categoryData),
  });

  if (!res.ok) throw new Error("Failed to create category");

  invalidateCategoriesCache();
  return await res.json();
}

/**
 * Update category (and invalidate cache)
 * @param {string} categoryId - Category ID
 * @param {Object} updates - Updated fields
 * @returns {Promise<Object>} Updated category
 */
export async function updateCategoryAndRefresh(categoryId, updates) {
  const res = await fetch("/api/categories", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...updates, _id: categoryId }),
  });

  if (!res.ok) throw new Error("Failed to update category");

  invalidateCategoriesCache();
  return await res.json();
}
