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
import Store from "@/models/Store";
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
 * Rebuilds this location's daily cash around `date` and returns that day.
 *
 * The walk starts at the last day already written before `date` (or at `from`, for a rebuild)
 * and runs forward to whichever is later: `date`, or the newest day already written. Running on
 * past `date` matters — a till closed late, or a correction to an earlier day, changes what every
 * day after it brought forward, and stopping at `date` left those days with a stale figure.
 *
 * Rows this function writes are the tills' own figures (source "pos"), even on a day with only
 * payments and no takings yet. Only a person makes a row "manual" — by typing a figure in — and
 * only those are kept as they are. Marking its own zero rows "manual" meant the takings of a till
 * that closed later that day were never counted.
 *
 * `locationId` is optional and only used to find the till reports, which are keyed by id.
 */
export async function updateDailyCashChain({ location, locationId, date = new Date(), from = null }) {
  const target = startOfDay(date);
  const today = startOfDay(new Date());
  const limit = new Date(Math.min(target.getTime(), today.getTime()) - MAX_DAYS * DAY);

  // Till reports are keyed by location id (closed in the management app) or carry the name
  // (closed at the till), so a report is matched by either
  let resolvedId = locationId;
  if (!resolvedId) {
    const store = await Store.findOne({}).select("locations").lean();
    resolvedId = store?.locations?.find((entry) => entry.name === location)?._id || null;
  }
  const reportFilter = {
    closedAt: { $ne: null },
    $or: [{ locationName: location }, ...(resolvedId ? [{ locationId: resolvedId }] : [])],
  };

  // Where the walk starts, and what it carries in
  const startAt = from ? startOfDay(from) : null;
  const previous = await DailyCash.findOne({ location, date: { $lt: startAt || target } })
    .sort({ date: -1 })
    .lean();

  let earliest = startAt || (previous ? nextDay(previous.date) : target);
  if (!startAt && !previous) {
    // Nothing written yet: begin at this location's first till closing or payment
    const [firstReport, firstExpense] = await Promise.all([
      EndOfDayReport.findOne({ ...reportFilter, date: { $gte: limit, $lt: nextDay(target) } })
        .sort({ date: 1 })
        .select("date closedAt")
        .lean(),
      Expense.findOne({ locationName: location, createdAt: { $gte: limit, $lt: nextDay(target) } })
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

  // ...and where it ends: the day asked for, or the newest day already written, never past today
  const newest = await DailyCash.findOne({ location, date: { $gte: target } }).sort({ date: -1 }).lean();
  const lastDay = new Date(
    Math.min(Math.max(target.getTime(), newest ? startOfDay(newest.date).getTime() : 0), Math.max(today.getTime(), target.getTime()))
  );
  const windowEnd = nextDay(lastDay);

  reportFilter.date = { $gte: firstDay, $lt: windowEnd };
  const [reports, expenses, existingRows] = await Promise.all([
    EndOfDayReport.find(reportFilter)
      .select("date closedAt openingBalance physicalCount expectedClosingBalance totalSales tenderBreakdown tenderActual")
      .lean(),
    Expense.find({ locationName: location, createdAt: { $gte: firstDay, $lt: windowEnd } })
      .select("amount createdAt")
      .lean(),
    DailyCash.find({ location, date: { $gte: firstDay, $lt: windowEnd } }).lean(),
  ]);

  let broughtForward = previous ? Number(previous.cashAtHand) || 0 : 0;
  let result = null;

  for (let day = new Date(firstDay); day <= lastDay; day = nextDay(day)) {
    const dayReports = reports.filter((report) => sameDay(report.date || report.closedAt, day));
    const dayExpenses = expenses.filter((expense) => sameDay(expense.createdAt, day));
    const existing = existingRows.find((row) => sameDay(row.date, day));

    const summary = summariseDayCash(dayReports);
    // A figure a person typed in is what they counted, so it wins over the tills. An earlier version
    // of this function marked its own empty days "manual" with an amount of 0 and no name on them;
    // those are not anyone's count, and treating them as one kept a till's takings off that day for
    // good. They are recognised and worked out again.
    const writtenByEarlierChain =
      existing?.source === "manual" && Number(existing.amount) === 0 && !existing.staffName && !existing.posSessionId;
    const manual = existing?.source === "manual" && !writtenByEarlierChain ? Number(existing.amount) || 0 : null;
    const cashReceived = manual !== null ? manual : summary.cash;
    const totalPayments = dayExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
    const totalCashAvailable = broughtForward + cashReceived;
    const cashAtHand = totalCashAvailable - totalPayments;
    const source = manual !== null ? "manual" : "pos";

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
        { $set: { ...row, source } },
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
        source,
      };
    }
  }

  return result;
}
