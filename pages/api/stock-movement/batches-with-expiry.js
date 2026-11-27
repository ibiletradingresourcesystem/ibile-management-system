// pages/api/stock-movement/batches-with-expiry.js
//
// Every expiry batch and what is left of it, for Expiry Tracking and the notification bell. The
// working out is in lib/expiryBatches.js. Kept for a minute, as the bell asks on every page;
// `?fresh=1` reads it again (after a disposal, say).

import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { withRetry } from "@/lib/mongodb";
import { loadExpiryBatches } from "@/lib/expiryBatches";

const BATCH_CACHE_TTL_MS = 60 * 1000;
let batchCache = null;

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const fresh = req.query.fresh === "1";
    if (!fresh && batchCache && Date.now() < batchCache.expiresAt) {
      return res.status(200).json({ success: true, data: batchCache.batches, count: batchCache.batches.length, cached: true });
    }

    const batches = await withRetry(() => loadExpiryBatches());
    batchCache = { batches, expiresAt: Date.now() + BATCH_CACHE_TTL_MS };

    return res.status(200).json({ success: true, data: batches, count: batches.length });
  } catch (error) {
    console.error("Error fetching batches with expiry:", error);
    return res.status(500).json({
      error: "Failed to fetch batch data",
      details: error.message,
    });
  }
}
