/**
 * Who actually sold during a till session.
 *
 * An end-of-day report is written by whoever closed the till, so every figure on it
 * carries that one name — but several people sell across a day on the same till.
 * These helpers take the day's sales, grouped by trading day, location and seller, and
 * turn them into a breakdown for the period and for each report.
 */
import { dayKeyOf, tradingDayKey } from "@/lib/tradingDay";

const rowKey = (row) => ({
  day: row?._id?.day || "",
  location: row?._id?.location || "Unknown",
  staff: row?._id?.staff || "Unknown",
});

/** The period's sellers, biggest takings first. */
export function summariseSellers(rows = []) {
  const bySeller = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const { staff } = rowKey(row);
    const entry = bySeller.get(staff) || {
      staff,
      transactions: 0,
      totalSales: 0,
      days: new Set(),
      locations: new Set(),
    };
    entry.transactions += Number(row.transactions) || 0;
    entry.totalSales += Number(row.totalSales) || 0;
    const { day, location } = rowKey(row);
    if (day) entry.days.add(day);
    if (location) entry.locations.add(location);
    bySeller.set(staff, entry);
  }

  return [...bySeller.values()]
    .map((entry) => ({
      staff: entry.staff,
      transactions: entry.transactions,
      totalSales: entry.totalSales,
      days: entry.days.size,
      locations: [...entry.locations],
    }))
    .sort((a, b) => b.totalSales - a.totalSales || a.staff.localeCompare(b.staff));
}

/**
 * Hang each report's own sellers off it, matched on the day and location the report
 * covers. Mutates the reports, which is what the caller wants to send on.
 */
export function attachSellersToReports(reports = [], rows = []) {
  const byDayLocation = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const { day, location, staff } = rowKey(row);
    const key = `${day}|${String(location).toLowerCase()}`;
    const list = byDayLocation.get(key) || [];
    list.push({
      staff,
      transactions: Number(row.transactions) || 0,
      totalSales: Number(row.totalSales) || 0,
      firstSale: row.firstSale || null,
      lastSale: row.lastSale || null,
    });
    byDayLocation.set(key, list);
  }

  for (const report of Array.isArray(reports) ? reports : []) {
    const location = String(report?.locationName || "Unknown").toLowerCase();
    /*
     * The trading day the till closed in (6am to 6am, so a till closed at 1:30am is the
     * day before's, where its sales are), then the one it was opened in, then the day
     * it is dated.
     */
    const candidateDays = [
      tradingDayKey(report?.closedAt),
      tradingDayKey(report?.openedAt),
      dayKeyOf(report?.date),
    ].filter(Boolean);

    const matchedDay = candidateDays.find((day) => (byDayLocation.get(`${day}|${location}`) || []).length > 0);
    const sellers = [...(byDayLocation.get(`${matchedDay}|${location}`) || [])].sort(
      (a, b) => b.totalSales - a.totalSales || a.staff.localeCompare(b.staff)
    );
    report.sellers = sellers;
    report.sellerCount = sellers.length;
  }

  return reports;
}
