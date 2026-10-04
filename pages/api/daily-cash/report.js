/**
 * API: GET /api/daily-cash/report?location=&date=YYYY-MM-DD
 *
 * One day's cash for a location: brought forward, taken, paid out, at hand — and the days behind it,
 * which are rebuilt on the way (see lib/dailyCashChain.js), so a day nobody opened does not leave the
 * ones after it carrying a stale figure.
 *
 * The day is a trading day, 6am to 6am in the shop (lib/tradingDay.js): a till closed at 1:30am is
 * counted on the day before, with the sales it holds.
 *
 * The cash taken is what the tills *counted* at close, not what the sales say should be there. Those
 * differ whenever a drawer is over or short, and the point of the entry is the money that is
 * actually in hand.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Expense from "@/models/Expense";
import Store from "@/models/Store";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { paymentsWithin, updateDailyCashChain } from "@/lib/dailyCashChain";
import { currentTradingDay, dayDate, dayKeyOf, tradingDaysRange } from "@/lib/tradingDay";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();

  const { location, date } = req.query;
  if (!location) return res.status(400).json({ error: "Location is required" });

  const day = (date && dayKeyOf(date)) || currentTradingDay();

  // Till reports are keyed by location id; the entry itself is keyed by name
  const store = await Store.findOne({}).select("locations").lean();
  const locationId = store?.locations?.find((entry) => entry.name === location)?._id || null;

  const result = await updateDailyCashChain({ location, locationId, day });

  const moments = tradingDaysRange(day);
  const expenses = await Expense.find({ locationName: location, ...paymentsWithin(moments) })
    .sort({ expenseDate: 1, createdAt: 1 })
    .lean();

  return res.status(200).json({
    date: dayDate(day),
    day,
    // The moments the day runs between, 6am to 6am
    from: moments.$gte,
    to: moments.$lt,
    location,
    cashBroughtForward: result?.cashBroughtForward || 0,
    cashReceived: result?.cashReceived || 0,
    totalCashAvailable: result?.totalCashAvailable || 0,
    totalPayments: result?.totalPayments || 0,
    cashAtHand: result?.cashAtHand || 0,
    // Where the figure came from, so a difference between the drawer and the sales is visible
    expectedCash: result?.expectedCash || 0,
    countedCash: Boolean(result?.countedCash),
    tillsClosed: result?.tillsClosed || 0,
    addedCash: result?.addedCash || 0,
    source: result?.source || "manual",
    expenses,
  });
}
