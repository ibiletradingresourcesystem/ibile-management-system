/**
 * What every /api/market route does first: sign-in, the database, and who is asking.
 * Setting markets, sections and vendors up is for a manager; basic staff use the list
 * (lib/permission-utils.js).
 */
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff, isBasicStaff } from "@/lib/auth-middleware";
import { MarketError } from "@/lib/market";

export async function marketRoute(req, res, { setup = false } = {}) {
  const authError = authMiddleware(req, res);
  if (authError) return false;
  if (!isStaff(req)) {
    res.status(403).json({ error: "Insufficient permissions" });
    return false;
  }
  if (setup && req.method !== "GET" && isBasicStaff(req)) {
    res.status(403).json({ error: "Setting up markets and market vendors is for a manager." });
    return false;
  }
  await mongooseConnect();
  return true;
}

export function sendError(res, error) {
  if (error instanceof MarketError) return res.status(error.status).json({ error: error.message });
  if (error?.name === "ValidationError" || error?.name === "CastError") return res.status(400).json({ error: error.message });
  console.error("Market API error:", error);
  return res.status(500).json({ error: "Something went wrong with the market list. Try again." });
}

export const actorName = (req) => String(req.user?.name || req.user?.email || "").slice(0, 80);
