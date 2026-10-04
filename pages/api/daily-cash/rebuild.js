/**
 * API: POST /api/daily-cash/rebuild  { location?, from?, to? }
 *
 * Recalculates the daily cash entries for a location (or every location) from the till reports.
 *
 * Entries written before this took the *expected* cash — what the sales said should be in the
 * drawer — and only the last till to close each day, so older days read wrong and the carried
 * forward chain drifted. They also put a till closed after midnight on the calendar day it closed,
 * not the trading day its sales were made in. This walks the days again and writes what was
 * actually counted, on the right day. A figure someone typed in by hand is left alone.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import DailyCash from "@/models/DailyCash";
import EndOfDayReport from "@/models/EndOfDayReport";
import Expense from "@/models/Expense";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { canManageProducts } from "@/lib/permission-utils";
import { paidAt, updateDailyCashChain } from "@/lib/dailyCashChain";
import { addDays, currentTradingDay, dayKeyOf, daysBetween, laterDay, tradingDayKey } from "@/lib/tradingDay";

const MAX_DAYS = 120;

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

  const to = (req.body?.to && dayKeyOf(req.body.to)) || currentTradingDay();
  const earliestAllowed = addDays(to, -MAX_DAYS);
  const requestedFrom = req.body?.from ? dayKeyOf(req.body.from) : null;

  const rebuilt = [];
  for (const location of locations) {
    // Start at the first thing on this location's ledger — a till report, a payment or an entry —
    // so every day is worked out the same way, or as far back as allowed
    const [firstReport, firstPayment, firstEntry] = await Promise.all([
      EndOfDayReport.findOne({
        closedAt: { $ne: null },
        $or: [{ locationId: location._id }, { locationName: location.name }],
      })
        .sort({ closedAt: 1 })
        .select("closedAt")
        .lean(),
      Expense.findOne({ locationName: location.name }).sort({ createdAt: 1 }).select("expenseDate createdAt").lean(),
      DailyCash.findOne({ location: location.name }).sort({ date: 1 }).select("date").lean(),
    ]);
    const firstDay = [
      firstReport && tradingDayKey(firstReport.closedAt),
      firstPayment && tradingDayKey(paidAt(firstPayment)),
      firstEntry && dayKeyOf(firstEntry.date),
    ]
      .filter(Boolean)
      .sort()[0];

    const from = laterDay(requestedFrom || firstDay || to, earliestAllowed);

    // One walk from the first day to the last writes every day in order
    await updateDailyCashChain({ location: location.name, locationId: location._id, day: to, fromDay: from });

    rebuilt.push({ location: location.name, from, to, days: Math.max(0, daysBetween(from, to) + 1) });
  }

  return res.status(200).json({ success: true, rebuilt });
}
