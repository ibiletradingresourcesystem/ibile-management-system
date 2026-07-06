/**
 * Store logo utility - fetches logo from store data and caches permanently in localStorage
 */

const LOGO_CACHE_KEY = "_store_logo_url";
export const DEFAULT_LOGO = "/images/logo.png"; // Default logo if none is set

/**
 * Get cached logo URL synchronously (for component render)
 */
export function getCachedLogo() {
  if (typeof window === "undefined") return DEFAULT_LOGO;
  return localStorage.getItem(LOGO_CACHE_KEY) || DEFAULT_LOGO;
}

/**
 * Fetch store logo from API and cache in localStorage permanently.
 * Only fetches if not already cached.
 */
export async function fetchAndCacheLogo() {
  if (typeof window === "undefined") return DEFAULT_LOGO;

  // Check cache first - if cached, return immediately
  const cached = localStorage.getItem(LOGO_CACHE_KEY);
  if (cached) return cached;

  try {
    const res = await fetch("/api/setup/get");
    const data = await res.json();
    const store = data?.store || data;
    const logo = store?.logo;

    if (logo && logo.trim() !== "") {
      localStorage.setItem(LOGO_CACHE_KEY, logo);
      return logo;
    }
    return DEFAULT_LOGO;
  } catch {
    return DEFAULT_LOGO;
  }
}

/**
 * Force refresh the cached logo (e.g., after store settings update)
 */
export function clearLogoCache() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LOGO_CACHE_KEY);
}
