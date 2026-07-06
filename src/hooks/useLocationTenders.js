import { useEffect, useState } from "react";

function cacheKey(locationId) {
  return `pos_location_tenders_${locationId}`;
}

function readCachedTenders(locationId) {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(cacheKey(locationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedTenders(locationId, tenders) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(cacheKey(locationId), JSON.stringify(tenders));
  } catch {
    // Ignore cache write failures.
  }
}

export function useLocationTenders(locationId) {
  const [tenders, setTenders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!locationId) {
      setTenders([]);
      setLoading(false);
      setError("No location ID provided");
      return;
    }

    const fetchLocationTenders = async () => {
      const cached = readCachedTenders(locationId);
      if (cached.length) setTenders(cached);

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setLoading(false);
        setError(cached.length ? null : "Offline and no cached tenders");
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const token =
          typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
        const response = await fetch(
          `/api/setup/location-items?locationId=${locationId}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          }
        );

        if (!response.ok) {
          throw new Error(
            `Failed to fetch tenders: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.message || "Failed to fetch location data");
        }

        const locationTenders = data.location?.tenders || [];
        const normalizedTenders = locationTenders
          .map((tender) => {
            const tenderObj = typeof tender === "string" ? { _id: tender } : tender;
            return {
              id: tenderObj._id || tenderObj.id,
              name: tenderObj.name || "Unknown Tender",
              description: tenderObj.description || "",
              classification: tenderObj.classification || "Other",
              buttonColor: tenderObj.buttonColor || "#A3E635",
              tillOrder: Number(tenderObj.tillOrder || 0),
            };
          })
          .sort((a, b) => a.tillOrder - b.tillOrder);

        setTenders(normalizedTenders);
        writeCachedTenders(locationId, normalizedTenders);
      } catch (err) {
        setError(err.message || "Failed to load tenders");
        if (!cached.length) setTenders([]);
      } finally {
        setLoading(false);
      }
    };

    fetchLocationTenders();
  }, [locationId]);

  return {
    tenders,
    loading,
    error,
  };
}
