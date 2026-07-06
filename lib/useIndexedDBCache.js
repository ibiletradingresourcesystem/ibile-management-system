/**
 * Custom hook for caching data in IndexedDB with TTL support
 * Better than localStorage (5MB limit) and cookies (4KB limit)
 * Ideal for large datasets that rarely change
 */

import { useEffect, useState } from "react";

const DB_NAME = "InventoryAppDB";
const OBJECT_STORE_NAME = "cache";
const DB_VERSION = 1;

// Initialize IndexedDB
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        db.createObjectStore(OBJECT_STORE_NAME, { keyPath: "key" });
      }
    };
  });
}

// Get from IndexedDB
function getFromDB(key) {
  return new Promise((resolve, reject) => {
    initDB()
      .then((db) => {
        const tx = db.transaction([OBJECT_STORE_NAME], "readonly");
        const store = tx.objectStore(OBJECT_STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => {
          const result = request.result;
          resolve(result || null);
        };

        request.onerror = () => reject(request.error);
      })
      .catch(reject);
  });
}

// Set in IndexedDB
function setInDB(key, value, ttlMinutes = 60) {
  return new Promise((resolve, reject) => {
    initDB()
      .then((db) => {
        const tx = db.transaction([OBJECT_STORE_NAME], "readwrite");
        const store = tx.objectStore(OBJECT_STORE_NAME);

        const data = {
          key,
          value,
          timestamp: Date.now(),
          ttl: ttlMinutes * 60 * 1000, // Convert to milliseconds
        };

        const request = store.put(data);

        request.onsuccess = () => resolve(data);
        request.onerror = () => reject(request.error);
      })
      .catch(reject);
  });
}

// Check if cache is still valid (not expired)
function isCacheValid(cached) {
  if (!cached) return false;
  const now = Date.now();
  const age = now - cached.timestamp;
  return age < cached.ttl;
}

/**
 * Custom hook for IndexedDB caching
 * @param {string} key - Cache key
 * @param {function} fetchFn - Async function to fetch data
 * @param {number} ttlMinutes - Time to live in minutes (default: 60)
 * @returns {object} { data, loading, error, refresh }
 */
export function useIndexedDBCache(key, fetchFn, ttlMinutes = 60) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load from cache on mount
  useEffect(() => {
    async function loadFromCache() {
      try {
        const cached = await getFromDB(key);

        if (isCacheValid(cached)) {
          // Use cached data
          setData(cached.value);
          setError(null);
          setLoading(false);
          return;
        }

        // Cache expired or doesn't exist - fetch fresh data
        await fetchFresh();
      } catch (err) {
        console.error("Cache error:", err);
        // Fall back to fetch
        await fetchFresh();
      }
    }

    async function fetchFresh() {
      try {
        setLoading(true);
        const result = await fetchFn();
        setData(result);
        setError(null);

        // Store in IndexedDB
        await setInDB(key, result, ttlMinutes).catch((err) =>
          console.warn("Failed to cache data:", err)
        );
      } catch (err) {
        setError(err.message || "Failed to fetch data");
        setData(null);
      } finally {
        setLoading(false);
      }
    }

    loadFromCache();
  }, [key, fetchFn, ttlMinutes]);

  // Manual refresh function
  const refresh = async () => {
    try {
      setLoading(true);
      const result = await fetchFn();
      setData(result);
      setError(null);
      await setInDB(key, result, ttlMinutes).catch((err) =>
        console.warn("Failed to cache data:", err)
      );
    } catch (err) {
      setError(err.message || "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  };

  return { data, loading, error, refresh };
}

/**
 * Clear specific cache entry
 */
export async function clearCache(key) {
  try {
    const db = await initDB();
    const tx = db.transaction([OBJECT_STORE_NAME], "readwrite");
    const store = tx.objectStore(OBJECT_STORE_NAME);
    await new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Failed to clear cache:", err);
  }
}

/**
 * Clear all cache entries
 */
export async function clearAllCache() {
  try {
    const db = await initDB();
    const tx = db.transaction([OBJECT_STORE_NAME], "readwrite");
    const store = tx.objectStore(OBJECT_STORE_NAME);
    await new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Failed to clear all cache:", err);
  }
}
