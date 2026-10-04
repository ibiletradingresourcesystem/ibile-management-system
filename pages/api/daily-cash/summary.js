/**
 * API: GET /api/daily-cash/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&location=
 *
 * The cash for a run of trading days (6am to 6am), per location and in total: what the tills took,
 * what was paid out, and the cash at hand at the start and at the end. Without `from` it runs from
 * the first entry; without `to`, up to today; without `location`, across every location.
 *
 * This is what the cards on Expenses → Analysis show for the period and location picked there.
 * They used to show the one day in the End of Day box below, for every location, whatever was
 * picked.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { summariseCashDays } from "@/lib/dailyCashChain";
import { currentTradingDay, dayKeyOf, earlierDay } from "@/lib/tradingDay";

const FIGURES = ["cashBroughtForward", "cashReceived", "totalPayments", "cashAtHand"];

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  await mongooseConnect();

  const today = currentTradingDay();
  const to = earlierDay((req.query.to && dayKeyOf(req.query.to)) || today, today);
  const from = req.query.from ? dayKeyOf(req.query.from) : null;
  if (req.query.from && !from) return res.status(400).json({ error: "from is not a valid day" });

  const wanted = String(req.query.location || "").trim();
  const store = await Store.findOne({}).select("locations").lean();
  const names = (store?.locations || [])
    .map((entry) => (typeof entry === "string" ? entry : entry?.name))
    .filter(Boolean);
  const locations = wanted ? [wanted] : names;

  // A period that has not started yet has no cash in it
  const perLocation =
    from && from > to
      ? locations.map((location) => ({ location, days: 0, ...Object.fromEntries(FIGURES.map((field) => [field, 0])) }))
      : await Promise.all(locations.map((location) => summariseCashDays({ location, fromDay: from, toDay: to })));

  const totals = Object.fromEntries(
    FIGURES.map((field) => [field, perLocation.reduce((sum, entry) => sum + (Number(entry[field]) || 0), 0)])
  );

  return res.status(200).json({ from, to, locations: perLocation, totals });
}
