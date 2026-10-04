/**
 * The daily cash entry for a location, and the chain of days behind it.
 *
 * Each day is: cash brought forward + cash taken − payments out = cash at hand, and the next day
 * starts from that. The figures used to be written only for the day someone happened to open, and
 * only for the till that closed last, so a day nobody looked at left a hole and the days after it
 * carried a stale figure. This fills every day from the last one that was written up to the day
 * asked for, and sums every till that closed on each of them.
 *
 * A day is a trading day (lib/tradingDay.js), 6am to 6am in the shop: a till closed at 1:30am is
 * the cash of the day before, where its sales are, and a payment made at 1am comes out of that day.
 * Going by the calendar day of the close put those tills on the wrong day.
 */

import DailyCash from "@/models/DailyCash";
import EndOfDayReport from "@/models/EndOfDayReport";
import Expense from "@/models/Expense";
import Store from "@/models/Store";
import { summariseDayCash } from "@/lib/endOfDayCash";
import {
  addDays,
  currentTradingDay,
  dayDate,
  dayDatesRange,
  dayKeyOf,
  earlierDay,
  laterDay,
  tradingDayKey,
  tradingDaysRange,
} from "@/lib/tradingDay";

/** How far back to rebuild in one request, so a long-idle location cannot stall a page load. */
const MAX_DAYS = 120;

/**
 * Days before the one asked for that are worked out again every time. A till can close after
 * midnight, and one that was offline sends its report when it is back, so a day's entry is often
 * written before all of its tills are in.
 */
const RECHECK_DAYS = 7;

const FIGURES = ["amount", "cashBroughtForward", "totalPayments", "totalCashAvailable", "cashAtHand"];

/** When a payment went out: when it was paid (a petty cash order), otherwise when it was entered. */
export const paidAt = (expense) => expense?.expenseDate || expense?.createdAt;

/** Payments made within a range of moments. Older entries have no expenseDate. */
export const paymentsWithin = (range) => ({
  $or: [{ expenseDate: range }, { expenseDate: null, createdAt: range }],
});

/**
 * A figure a person typed in is what they counted, so it wins over the tills. An earlier version of
 * this chain marked its own empty days "manual" with an amount of 0 and no name on them; those are
 * nobody's count, and treating them as one kept a till's takings off that day for good.
 */
export const typedByPerson = (row) =>
  row?.source === "manual" && !(Number(row.amount) === 0 && !row.staffName && !row.posSessionId);

const rank = (row) => (typedByPerson(row) ? 2 : Number(row?.addedCash) > 0 ? 1 : 0);

/**
 * One entry per day. A day can have been written twice — by the server and by a computer whose
 * midnight is an hour different — so a person's figure is preferred, then one with cash added by
 * hand, then the newest.
 */
function pickRow(rows) {
  if (!rows || rows.length === 0) return { row: null, duplicates: [] };
  const sorted = [...rows].sort(
    (a, b) => rank(b) - rank(a) || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  );
  return { row: sorted[0], duplicates: sorted.slice(1) };
}

/** The entry for a location's day, if there is one (a Mongoose document, ready to change). */
export async function findDayRow(location, day) {
  const rows = await DailyCash.find({ location, date: dayDatesRange(day) });
  return pickRow(rows).row;
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/**
 * Rebuilds this location's daily cash around `day` ("YYYY-MM-DD", a trading day) and returns it.
 *
 * The walk starts a week before `day` — or further back, at the last day already written, when
 * days in between were never written (or at `fromDay`, for a rebuild) — and runs forward to
 * whichever is later: `day`, or the newest day already written. Starting before `day` picks up a
 * till that closed after its day's entry was written; running on past `day` matters because a till
 * closed late, or a correction to an earlier day, changes what every day after it brought forward.
 *
 * Rows this function writes are the tills' own figures (source "pos"), even on a day with only
 * payments and no takings yet. Only a person makes a row "manual" — by typing a figure in — and
 * only those are kept as they are. Cash a person added on top of the tills (addedCash) is added to
 * the tills' figure, so a till that closes after it still counts.
 *
 * `locationId` is optional and only used to find the till reports, which are keyed by id.
 */
export async function updateDailyCashChain({ location, locationId, day, fromDay = null }) {
  const today = currentTradingDay();
  const target = dayKeyOf(day) || today;
  const limit = addDays(earlierDay(target, today), -MAX_DAYS);

  // Till reports are keyed by location id (closed in the management app) or carry the name
  // (closed at the till), so a report is matched by either
  let resolvedId = locationId;
  if (!resolvedId) {
    const store = await Store.findOne({}).select("locations").lean();
    resolvedId = store?.locations?.find((entry) => entry.name === location)?._id || null;
  }
  const locationMatch = [{ locationName: location }, ...(resolvedId ? [{ locationId: resolvedId }] : [])];

  // Where the walk starts, and what it carries in
  const startAt = fromDay ? dayKeyOf(fromDay) : null;
  const walkFrom = startAt || addDays(target, -RECHECK_DAYS);
  const previous = await DailyCash.findOne({ location, date: { $lt: dayDatesRange(walkFrom).$gte } })
    .sort({ date: -1 })
    .lean();

  // ...and where it ends: the day asked for, or the newest day already written, never past today
  const newest = await DailyCash.findOne({ location, date: { $gte: dayDatesRange(target).$gte } })
    .sort({ date: -1 })
    .lean();
  const lastDay = earlierDay(laterDay(target, newest ? dayKeyOf(newest.date) : null), laterDay(today, target));

  const windowStart = laterDay(startAt || (previous ? addDays(dayKeyOf(previous.date), 1) : limit), limit);
  const moments = tradingDaysRange(windowStart, lastDay);

  const [reports, expenses, existingRows] = await Promise.all([
    EndOfDayReport.find({ closedAt: moments, $or: locationMatch })
      .select("date closedAt openingBalance physicalCount expectedClosingBalance totalSales tenderBreakdown tenderActual")
      .lean(),
    Expense.find({ locationName: location, ...paymentsWithin(moments) })
      .select("amount expenseDate createdAt")
      .lean(),
    DailyCash.find({ location, date: dayDatesRange(windowStart, lastDay) }).lean(),
  ]);

  const reportsByDay = groupBy(reports, (report) => tradingDayKey(report.closedAt));
  const paymentsByDay = groupBy(expenses, (expense) => tradingDayKey(paidAt(expense)));
  const rowsByDay = groupBy(existingRows, (row) => dayKeyOf(row.date));

  // Nothing written yet: begin at this location's first till closing, payment or entry
  let firstDay = windowStart;
  if (!startAt && !previous) {
    const firstActive = [...reportsByDay.keys(), ...paymentsByDay.keys(), ...rowsByDay.keys()].sort()[0];
    firstDay = firstActive && firstActive < target ? firstActive : target;
  }

  let broughtForward = previous ? Number(previous.cashAtHand) || 0 : 0;
  let result = null;

  for (let key = firstDay; key <= lastDay; key = addDays(key, 1)) {
    const summary = summariseDayCash(reportsByDay.get(key) || []);
    const totalPayments = (paymentsByDay.get(key) || []).reduce(
      (sum, expense) => sum + (Number(expense.amount) || 0),
      0
    );
    const { row: existing, duplicates } = pickRow(rowsByDay.get(key));

    const manual = typedByPerson(existing) ? Number(existing.amount) || 0 : null;
    const addedCash = manual === null ? Number(existing?.addedCash) || 0 : 0;
    const cashReceived = manual !== null ? manual : summary.cash + addedCash;
    const totalCashAvailable = broughtForward + cashReceived;
    const cashAtHand = totalCashAvailable - totalPayments;
    const source = manual !== null ? "manual" : "pos";

    const row = {
      date: dayDate(key),
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
    // Most days the walk passes over are already right, and are left untouched
    const unchanged =
      existing &&
      existing.source === source &&
      new Date(existing.date).getTime() === row.date.getTime() &&
      FIGURES.every((field) => Number(existing[field]) === row[field]);
    if (worthWriting && !unchanged) {
      if (existing) {
        await DailyCash.updateOne({ _id: existing._id }, { $set: { ...row, source } });
      } else {
        await DailyCash.findOneAndUpdate(
          { location, date: dayDatesRange(key) },
          { $set: { ...row, source } },
          { upsert: true }
        );
      }
    }
    // The same day written twice showed up twice. The chain's own copies are dropped; anything a
    // person typed or added is never removed.
    const spare = duplicates.filter((duplicate) => rank(duplicate) === 0);
    if (spare.length > 0) {
      await DailyCash.deleteMany({ _id: { $in: spare.map((duplicate) => duplicate._id) } });
    }

    broughtForward = cashAtHand;

    if (key === target) {
      result = {
        ...row,
        day: key,
        cashReceived,
        addedCash,
        expectedCash: summary.expectedCash,
        countedCash: summary.counted,
        tillsClosed: summary.reports,
        source,
      };
    }
  }

  return result;
}
