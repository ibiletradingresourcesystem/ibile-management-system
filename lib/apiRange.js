/**
 * Date-range reading for list APIs, so a report can ask for "everything between these two days"
 * instead of taking whatever fits on one page — a page of 50 is what made reports look incomplete.
 *
 * A plain "YYYY-MM-DD" is read in the store's time zone (Africa/Lagos, a fixed +01:00). The range
 * is padded by a day at each end so nothing is lost to a clock difference between the browser and
 * the server; callers still filter exactly on what comes back.
 */
const RANGE_PADDING_MS = 24 * 60 * 60 * 1000;

/** How many records a single "give me everything" request may return. */
export const MAX_RANGE_RECORDS = 20000;

export function parseRangeBound(value) {
  if (!value) return null;
  const text = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00+01:00`) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * @param {object} query           the request query ({ from, to })
 * @param {string[]} dateFields    fields that carry the record's date, in order of preference.
 *                                 More than one means "whichever the record has" (e.g. an expense
 *                                 dated by hand, otherwise by when it was entered).
 * @returns {object} a Mongo filter fragment — {} when no range was asked for
 */
export function buildDateRangeFilter(query = {}, dateFields = ["createdAt"]) {
  const start = parseRangeBound(query.from);
  const end = parseRangeBound(query.to);
  if (!start && !end) return {};

  const range = {};
  if (start) range.$gte = new Date(start.getTime() - RANGE_PADDING_MS);
  if (end) range.$lte = new Date(end.getTime() + 2 * RANGE_PADDING_MS);

  const [primary, ...fallbacks] = dateFields;
  if (fallbacks.length === 0) return { [primary]: range };

  // A record counts when its own date is in range, or when it has none and its fallback is
  return {
    $or: [
      { [primary]: range },
      ...fallbacks.map((field) => ({ [primary]: { $in: [null, ""] }, [field]: range })),
    ],
  };
}

/** True when the caller wants every matching record rather than a page of them. */
export function wantsEveryRecord(query = {}) {
  return query.all === "true" || String(query.limit).toLowerCase() === "all";
}
