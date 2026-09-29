/**
 * The daily cash entry for a location, and the chain of days behind it.
 *
 * Each day is: cash brought forward + cash taken − payments out = cash at hand, and the next day
 * starts from that. The figures used to be written only for the day someone happened to open, and
 * only for the till that closed last, so a day nobody looked at left a hole and the days after it
 * carried a stale figure. This fills every day from the last one that was written up to the day
 * asked for, and sums every till that closed on each of them.
 */

import DailyCash from "@/models/DailyCash";
import EndOfDayReport from "@/models/EndOfDayReport";
import Expense from "@/models/Expense";
import { summariseDayCash } from "@/lib/endOfDayCash";

/** How far back to rebuild in one request, so a long-idle location cannot stall a page load. */
const MAX_DAYS = 120;
const DAY = 24 * 60 * 60 * 1000;

export const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const nextDay = (value) => new Date(startOfDay(value).getTime() + DAY);
const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();

/**
 * Rebuilds this location's daily cash up to and including `date`, and returns that day.
 * `locationId` is optional and only used to find the till reports, which are keyed by id.
 */
export async function updateDailyCashChain({ location, locationId, date = new Date() }) {
  const target = startOfDay(date);

  // The last day already written before the one asked for: the chain continues from there
  const previous = await DailyCash.findOne({ location, date: { $lt: target } })
    .sort({ date: -1 })
    .lean();

  const earliest = previous ? nextDay(previous.date) : target;
  const firstDay = new Date(Math.max(earliest.getTime(), target.getTime() - MAX_DAYS * DAY));
  const windowEnd = nextDay(target);

  const reportFilter = { closedAt: { $ne: null }, date: { $gte: firstDay, $lt: windowEnd } };
  if (locationId) reportFilter.locationId = locationId;
  else reportFilter.locationName = location;

  const [reports, expenses] = await Promise.all([
    EndOfDayReport.find(reportFilter)
      .select("date closedAt openingBalance physicalCount expectedClosingBalance totalSales tenderBreakdown tenderActual")
      .lean(),
    Expense.find({ locationName: location, createdAt: { $gte: firstDay, $lt: windowEnd } })
      .select("amount createdAt")
      .lean(),
  ]);

  const existingRows = await DailyCash.find({ location, date: { $gte: firstDay, $lt: windowEnd } }).lean();

  let broughtForward = previous ? Number(previous.cashAtHand) || 0 : 0;
  let result = null;

  for (let day = new Date(firstDay); day <= target; day = nextDay(day)) {
    const dayReports = reports.filter((report) => sameDay(report.date || report.closedAt, day));
    const dayExpenses = expenses.filter((expense) => sameDay(expense.createdAt, day));
    const existing = existingRows.find((row) => sameDay(row.date, day));

    const summary = summariseDayCash(dayReports);
    // A figure typed in by hand is what the person counted, so it wins over the tills
    const manual = existing?.source === "manual" ? Number(existing.amount) || 0 : null;
    const cashReceived = manual !== null ? manual : summary.cash;
    const totalPayments = dayExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
    const totalCashAvailable = broughtForward + cashReceived;
    const cashAtHand = totalCashAvailable - totalPayments;

    const row = {
      date: startOfDay(day),
      location,
      amount: cashReceived,
      cashBroughtForward: broughtForward,
      totalPayments,
      totalCashAvailable,
      cashAtHand,
    };

    // Nothing happened and nothing was written before: leave the day alone rather than
    // filling the ledger with empty rows
    const worthWriting = existing || cashReceived !== 0 || totalPayments !== 0 || broughtForward !== 0;
    if (worthWriting) {
      await DailyCash.findOneAndUpdate(
        { location, date: { $gte: startOfDay(day), $lt: nextDay(day) } },
        { $set: { ...row, source: existing?.source || (summary.reports > 0 ? "pos" : "manual") } },
        { upsert: true }
      );
    }

    broughtForward = cashAtHand;

    if (sameDay(day, target)) {
      result = {
        ...row,
        cashReceived,
        expectedCash: summary.expectedCash,
        countedCash: summary.counted,
        tillsClosed: summary.reports,
        source: existing?.source || (summary.reports > 0 ? "pos" : "manual"),
      };
    }
  }

  return result;
}
