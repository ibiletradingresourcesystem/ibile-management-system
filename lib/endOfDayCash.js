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

const findTender = (entries, tender) => {
  const key = Object.keys(entries).find((name) => String(name).trim().toUpperCase() === tender);
  return key === undefined ? undefined : entries[key];
};

/**
 * A till read back method by method: what the sales took on each payment method against what
 * staff counted on it at close, with totals that add up to the report's own.
 *
 *   rows      [{ tender, expected, counted, difference }]   counted is null when not entered;
 *             difference is counted − expected (over +, short −), null when it cannot be known
 *   perTender false for an older report that only has one counted total
 *   totals    { expected, counted, difference }             the float is not in either
 *   mixUp     { over, short, overBy, shortBy } when one method is over and another short by about
 *             the same: sales recorded on one method but paid with the other
 *   float     the opening float, which stays in the drawer and is not part of the count
 */
export function tenderReconciliation(report) {
  const processed = tenderMapToObject(report?.tenderBreakdown);
  const counted = tenderMapToObject(report?.tenderActual);
  const variances = tenderMapToObject(report?.tenderVariances);
  const perTender = Object.keys(counted).length > 0 || Object.keys(variances).length > 0;

  const names = new Map();
  for (const name of [...Object.keys(processed), ...Object.keys(counted), ...Object.keys(variances)]) {
    const key = String(name).trim().toUpperCase();
    if (key && !names.has(key)) names.set(key, String(name).trim());
  }

  const rows = [...names].map(([key, tender]) => {
    const variance = findTender(variances, key);
    const processedValue = findTender(processed, key);
    const expected = num(processedValue ?? variance?.processed, 0);
    let countedValue = findTender(counted, key);
    if (countedValue === undefined && variance && variance.counted !== undefined && variance.counted !== null) {
      countedValue = variance.counted;
    }
    countedValue = countedValue === undefined || countedValue === null ? null : num(countedValue, 0);
    // An older report: one total, which is the cash count when only cash was taken
    if (!perTender && key === CASH_TENDER) countedValue = countedCash(report);

    let difference = null;
    if (countedValue !== null) difference = countedValue - expected;
    // Counted method by method, but nothing entered for this one: the total counts it as none
    else if (perTender) difference = -expected;
    return { tender, expected, counted: countedValue, difference };
  });

  rows.sort((a, b) => {
    const aCash = a.tender.toUpperCase() === CASH_TENDER;
    const bCash = b.tender.toUpperCase() === CASH_TENDER;
    if (aCash !== bCash) return aCash ? -1 : 1;
    return b.expected - a.expected || a.tender.localeCompare(b.tender);
  });

  const totals = {
    expected: expectedTakings(report),
    counted: countedTakings(report),
    difference: takingsVariance(report),
  };

  // One method over and another short by nearly the same amount
  let mixUp = null;
  const known = rows.filter((row) => row.difference !== null);
  const over = known.reduce((best, row) => (row.difference > (best?.difference ?? 0) ? row : best), null);
  const short = known.reduce((best, row) => (row.difference < (best?.difference ?? 0) ? row : best), null);
  if (over && short) {
    const smaller = Math.min(over.difference, -short.difference);
    if (smaller >= 100 && Math.abs(over.difference + short.difference) <= smaller * 0.25) {
      mixUp = { over: over.tender, short: short.tender, overBy: over.difference, shortBy: -short.difference };
    }
  }

  return { rows, perTender, totals, mixUp, float: num(report?.openingBalance, 0) };
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
