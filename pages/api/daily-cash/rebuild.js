/**
 * API: POST /api/daily-cash/rebuild  { location?, from?, to? }
 *
 * Recalculates the daily cash entries for a location (or every location) from the till reports.
 *
 * Entries written before this took the *expected* cash — what the sales said should be in the
 * drawer — and only the last till to close each day, so older days read wrong and the carried
 * forward chain drifted. This walks the days again and writes what was actually counted. A figure
 * someone typed in by hand is left alone.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import EndOfDayReport from "@/models/EndOfDayReport";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { canManageProducts } from "@/lib/permission-utils";
import { updateDailyCashChain, startOfDay } from "@/lib/dailyCashChain";

const MAX_DAYS = 120;
const DAY = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });
  // Same people who may correct stock and prices may correct the cash ledger
  if (!canManageProducts(req.user)) {
    return res.status(403).json({ error: "You do not have permission to rebuild the cash entries" });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  await mongooseConnect();

  const store = await Store.findOne({}).select("locations").lean();
  const storeLocations = Array.isArray(store?.locations) ? store.locations : [];
  const wanted = String(req.body?.location || "").trim();
  const locations = wanted
    ? storeLocations.filter((entry) => entry.name === wanted)
    : storeLocations;

  if (locations.length === 0) {
    return res.status(400).json({ error: wanted ? `Location "${wanted}" was not found` : "No locations to rebuild" });
  }

  const today = startOfDay(new Date());
  const to = req.body?.to ? startOfDay(new Date(req.body.to)) : today;
  const earliestAllowed = new Date(to.getTime() - MAX_DAYS * DAY);

  const rebuilt = [];
  for (const location of locations) {
    // Start at the first till report for this location, or as far back as allowed
    const firstReport = await EndOfDayReport.findOne({ locationId: location._id, closedAt: { $ne: null } })
      .sort({ date: 1 })
      .select("date closedAt")
      .lean();

    const requestedFrom = req.body?.from ? startOfDay(new Date(req.body.from)) : null;
    const reportStart = firstReport ? startOfDay(firstReport.date || firstReport.closedAt) : to;
    const from = new Date(Math.max((requestedFrom || reportStart).getTime(), earliestAllowed.getTime()));

    let days = 0;
    for (let day = new Date(from); day <= to; day = new Date(day.getTime() + DAY)) {
      // Each call rebuilds the chain up to that day, so walking forward fills them in order
      await updateDailyCashChain({ location: location.name, locationId: location._id, date: day });
      days += 1;
    }

    rebuilt.push({ location: location.name, from, to, days });
  }

  return res.status(200).json({ success: true, rebuilt });
}
