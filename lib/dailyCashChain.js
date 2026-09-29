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

  const windowEnd = nextDay(target);
  const limit = new Date(target.getTime() - MAX_DAYS * DAY);

  const reportFilter = { closedAt: { $ne: null } };
  if (locationId) reportFilter.locationId = locationId;
  else reportFilter.locationName = location;

  // With nothing written yet, the chain starts at the first day this location had a till closing
  // or a payment — otherwise a first visit would only write the day being asked for.
  let earliest = previous ? nextDay(previous.date) : target;
  if (!previous) {
    const [firstReport, firstExpense] = await Promise.all([
      EndOfDayReport.findOne({ ...reportFilter, date: { $gte: limit, $lt: windowEnd } })
        .sort({ date: 1 })
        .select("date closedAt")
        .lean(),
      Expense.findOne({ locationName: location, createdAt: { $gte: limit, $lt: windowEnd } })
        .sort({ createdAt: 1 })
        .select("createdAt")
        .lean(),
    ]);
    const starts = [firstReport?.date || firstReport?.closedAt, firstExpense?.createdAt]
      .filter(Boolean)
      .map((value) => startOfDay(value).getTime());
    if (starts.length > 0) earliest = new Date(Math.min(...starts));
  }

  const firstDay = new Date(Math.max(earliest.getTime(), limit.getTime()));
  reportFilter.date = { $gte: firstDay, $lt: windowEnd };

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

    // Nothing came in and nothing went out: leave the day alone rather than filling the ledger
    // with zero entries. The chain still runs through it, so what is carried forward is unaffected.
    const worthWriting = Boolean(existing) || cashReceived !== 0 || totalPayments !== 0;
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
