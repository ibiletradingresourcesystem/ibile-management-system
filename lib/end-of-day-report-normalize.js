import {
  countedCash,
  countedTakings,
  expectedCash,
  expectedTakings,
  takingsVariance,
} from "@/lib/endOfDayCash";
import { tradingDayKey } from "@/lib/tradingDay";

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function normalizeEndOfDayReport(report) {
  if (!report || typeof report !== "object" || !report.closedAt) {
    return report;
  }

  const physicalCount = countedTakings(report);
  const expectedClosingBalance = safeNumber(report.expectedClosingBalance, 0);
  // The till counts takings; the float stays in the drawer and is not counted against sales
  const expected = expectedTakings(report);
  const variance = takingsVariance(report);
  const variancePercentage = expected > 0 ? (variance / expected) * 100 : 0;
  const cashCounted = countedCash(report);

  return {
    ...report,
    physicalCount,
    expectedClosingBalance,
    expectedTakings: expected,
    variance,
    variancePercentage,
    // What the cash entry for the day is built from
    expectedCash: expectedCash(report),
    countedCash: cashCounted,
    cashCounted: cashCounted !== null,
    status: Math.abs(variance) < 1 ? "RECONCILED" : "VARIANCE_NOTED",
    // The day this till's cash and sales belong to: a till closed at 1:30am is the day before's
    tradingDay: tradingDayKey(report.closedAt),
  };
}

export function normalizeEndOfDayReports(reports = []) {
  if (!Array.isArray(reports)) {
    return [];
  }

  return reports.map(normalizeEndOfDayReport);
}