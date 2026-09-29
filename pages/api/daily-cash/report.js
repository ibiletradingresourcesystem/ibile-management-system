/**
 * API: GET /api/daily-cash/report?location=&date=
 *
 * One day's cash for a location: brought forward, taken, paid out, at hand — and the days behind it,
 * which are rebuilt on the way (see lib/dailyCashChain.js), so a day nobody opened does not leave the
 * ones after it carrying a stale figure.
 *
 * The cash taken is what the tills *counted* at close, not what the sales say should be there. Those
 * differ whenever a drawer is over or short, and the point of the entry is the money that is
 * actually in hand.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Expense from "@/models/Expense";
import Store from "@/models/Store";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { updateDailyCashChain, startOfDay } from "@/lib/dailyCashChain";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();

  const { location, date } = req.query;
  if (!location) return res.status(400).json({ error: "Location is required" });

  const targetDate = startOfDay(date ? new Date(date) : new Date());
  const nextDay = new Date(targetDate);
  nextDay.setDate(nextDay.getDate() + 1);

  // Till reports are keyed by location id; the entry itself is keyed by name
  const store = await Store.findOne({}).select("locations").lean();
  const locationId = store?.locations?.find((entry) => entry.name === location)?._id || null;

  const day = await updateDailyCashChain({ location, locationId, date: targetDate });

  const expenses = await Expense.find({
    locationName: location,
    createdAt: { $gte: targetDate, $lt: nextDay },
  }).lean();

  return res.status(200).json({
    date: targetDate,
    location,
    cashBroughtForward: day?.cashBroughtForward || 0,
    cashReceived: day?.cashReceived || 0,
    totalCashAvailable: day?.totalCashAvailable || 0,
    totalPayments: day?.totalPayments || 0,
    cashAtHand: day?.cashAtHand || 0,
    // Where the figure came from, so a difference between the drawer and the sales is visible
    expectedCash: day?.expectedCash || 0,
    countedCash: Boolean(day?.countedCash),
    tillsClosed: day?.tillsClosed || 0,
    source: day?.source || "manual",
    expenses,
  });
}
