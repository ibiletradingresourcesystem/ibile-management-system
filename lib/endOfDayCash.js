/**
 * What a till actually took, read from an end-of-day report.
 *
 * The till counts *takings*, not the drawer: at close, each tender is counted against what was
 * processed on it, and the opening float is not part of that count (Close Till shows "Counted",
 * "Takings" and "Float" separately). `expectedClosingBalance`, though, is the float plus every sale
 * on every tender, so comparing it with `physicalCount` reports a shortage the size of the float and
 * mixes card and transfer into what is meant to be a cash figure.
 *
 * Everything that needs a cash number — the daily cash entry, the end-of-day list — goes through
 * here so they agree with each other and with the till.
 */

export const CASH_TENDER = "CASH";

const num = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Mongoose Maps, plain objects and missing values all read the same way. */
export function tenderMapToObject(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value.toObject === "function") return value.toObject();
  if (typeof value === "object") return { ...value };
  return {};
}

const byTender = (map, tender) => {
  const entries = tenderMapToObject(map);
  const key = Object.keys(entries).find((name) => String(name).trim().toUpperCase() === tender);
  return key === undefined ? null : num(entries[key], 0);
};

/** Sales the till says it took, on every tender, with the opening float left out. */
export function expectedTakings(report) {
  if (!report) return 0;
  const expectedClosing = num(report.expectedClosingBalance, 0);
  const opening = num(report.openingBalance, 0);
  // expectedClosingBalance = float + sales; totalSales is the same figure without the float
  if (expectedClosing > 0) return expectedClosing - opening;
  return num(report.totalSales, 0);
}

/** What staff counted at close, across every tender (the float is not counted). */
export function countedTakings(report) {
  return num(report?.physicalCount, 0);
}

/** Counted minus expected: over on the day is positive, short is negative. */
export function takingsVariance(report) {
  return countedTakings(report) - expectedTakings(report);
}

/** Cash the sales say should be there. */
export function expectedCash(report) {
  return byTender(report?.tenderBreakdown, CASH_TENDER) || 0;
}

/**
 * Cash staff actually counted, or null when this report does not say.
 *
 * Tills record a count per tender (`tenderActual`). An older report, or one closed from the
 * management app, has only one total: that is the cash count when nothing but cash was taken.
 */
export function countedCash(report) {
  if (!report) return null;

  const perTender = byTender(report.tenderActual, CASH_TENDER);
  if (perTender !== null) return perTender;

  const takings = tenderMapToObject(report.tenderBreakdown);
  const nonCash = Object.entries(takings)
    .filter(([tender]) => String(tender).trim().toUpperCase() !== CASH_TENDER)
    .reduce((sum, [, amount]) => sum + num(amount, 0), 0);
  if (nonCash === 0 && report.physicalCount !== undefined && report.physicalCount !== null) {
    return countedTakings(report);
  }

  return null;
}

/** Cash to bank for a day: what was counted, or what was expected when nothing was counted. */
export function cashForReport(report) {
  const counted = countedCash(report);
  return counted === null ? expectedCash(report) : counted;
}

/**
 * One day's cash across every till that closed.
 * `counted` is false when no report carried a count, so the figure is still the expected one.
 */
export function summariseDayCash(reports = []) {
  const closed = (Array.isArray(reports) ? reports : []).filter((report) => report?.closedAt);

  return closed.reduce(
    (summary, report) => {
      const counted = countedCash(report);
      return {
        cash: summary.cash + (counted === null ? expectedCash(report) : counted),
        expectedCash: summary.expectedCash + expectedCash(report),
        counted: summary.counted || counted !== null,
        reports: summary.reports + 1,
      };
    },
    { cash: 0, expectedCash: 0, counted: false, reports: 0 }
  );
}
