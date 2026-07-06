function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function normalizeEndOfDayReport(report) {
  if (!report || typeof report !== "object" || !report.closedAt) {
    return report;
  }

  const physicalCount = safeNumber(report.physicalCount, 0);
  const expectedClosingBalance = safeNumber(report.expectedClosingBalance, 0);
  const variance = physicalCount - expectedClosingBalance;
  const variancePercentage =
    expectedClosingBalance > 0 ? (variance / expectedClosingBalance) * 100 : 0;

  return {
    ...report,
    physicalCount,
    expectedClosingBalance,
    variance,
    variancePercentage,
    status: Math.abs(variance) < 1 ? "RECONCILED" : "VARIANCE_NOTED",
  };
}

export function normalizeEndOfDayReports(reports = []) {
  if (!Array.isArray(reports)) {
    return [];
  }

  return reports.map(normalizeEndOfDayReport);
}