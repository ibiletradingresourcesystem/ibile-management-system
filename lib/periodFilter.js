/**
 * The period a list is being looked at over — today, this week, and so on.
 *
 * Every screen that grew a date filter wrote its own week and month arithmetic,
 * which is how one page came to count a week from Sunday and another from the
 * day it happened to be. The options and the maths live here now, so a period
 * means the same thing wherever it is offered.
 */

/** The periods, in the order a filter should offer them. */
export const PERIOD_OPTIONS = [
  ["today", "Today"],
  ["thisWeek", "This Week"],
  ["lastWeek", "Last Week"],
  ["thisMonth", "This Month"],
  ["lastMonth", "Last Month"],
  ["tillDate", "Till Date"],
];

export const PERIOD_KEYS = PERIOD_OPTIONS.map(([key]) => key);

export function periodLabel(key) {
  return PERIOD_OPTIONS.find(([option]) => option === key)?.[1] || "Till Date";
}

function startOfDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

/** The week runs Monday to Sunday, the way a shop counts one. */
function startOfWeek(value) {
  const date = startOfDay(value);
  if (!date) return null;
  const dayOfWeek = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayOfWeek);
  return date;
}

/**
 * The window a period covers: `[from, to)`. Till date has no window.
 * @returns {{from: Date, to: Date}|null}
 */
export function periodRange(period, now = new Date()) {
  const today = startOfDay(now);
  if (!today || period === "tillDate" || !PERIOD_KEYS.includes(period)) return null;

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (period === "today") return { from: today, to: tomorrow };

  if (period === "thisWeek") {
    const from = startOfWeek(now);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    return { from, to };
  }

  if (period === "lastWeek") {
    const thisWeek = startOfWeek(now);
    const from = new Date(thisWeek);
    from.setDate(from.getDate() - 7);
    return { from, to: thisWeek };
  }

  if (period === "thisMonth") {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    const to = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return { from, to };
  }

  // lastMonth
  const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const to = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from, to };
}

/** Does this date fall in the period? A missing date never does, except till date. */
export function isWithinPeriod(value, period, now = new Date()) {
  const range = periodRange(period, now);
  if (!range) return true;

  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return false;
  return date >= range.from && date < range.to;
}

/**
 * Keep the rows whose date falls in the period.
 * `dateOf` says which date on a row is the one that matters — when it was paid,
 * rather than when it was raised, for anything being looked at as money spent.
 */
export function filterByPeriod(rows = [], period = "tillDate", dateOf = (row) => row?.date, now = new Date()) {
  if (!periodRange(period, now)) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => isWithinPeriod(dateOf(row), period, now));
}
