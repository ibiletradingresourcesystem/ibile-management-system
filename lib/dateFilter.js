/**
 * Shared date filter utility for consistent time range filtering across all pages
 */

export const REPORT_TIME_ZONE = "Africa/Lagos";

const dateFormatterCache = new Map();
const dateTimeFormatterCache = new Map();

function getDateFormatter(timeZone = REPORT_TIME_ZONE) {
  if (!dateFormatterCache.has(timeZone)) {
    dateFormatterCache.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    );
  }

  return dateFormatterCache.get(timeZone);
}

function getDateTimeFormatter(timeZone = REPORT_TIME_ZONE) {
  if (!dateTimeFormatterCache.has(timeZone)) {
    dateTimeFormatterCache.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
    );
  }

  return dateTimeFormatterCache.get(timeZone);
}

function getFormatterPart(parts, type) {
  return parts.find((part) => part.type === type)?.value || null;
}

function toValidDate(value) {
  if (value === null || value === undefined || value === "") return null;

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateKeyFromDate(date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toLocalDateFromKey(value) {
  const parsed = parseDateKey(value);
  if (!parsed) return null;

  return new Date(parsed.year, parsed.month - 1, parsed.day);
}

export function parseDateKey(value) {
  if (!value) return null;

  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;

  return {
    year,
    month,
    day,
    key: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

export function getDateKey(value, timeZone = REPORT_TIME_ZONE) {
  const date = toValidDate(value);
  if (!date) return null;

  const parts = getDateFormatter(timeZone).formatToParts(date);
  const year = getFormatterPart(parts, "year");
  const month = getFormatterPart(parts, "month");
  const day = getFormatterPart(parts, "day");

  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

export function getDateTimeParts(value, timeZone = REPORT_TIME_ZONE) {
  const date = toValidDate(value);
  if (!date) return null;

  const parts = getDateTimeFormatter(timeZone).formatToParts(date);
  const year = getFormatterPart(parts, "year");
  const month = getFormatterPart(parts, "month");
  const day = getFormatterPart(parts, "day");
  const hour = getFormatterPart(parts, "hour");
  const minute = getFormatterPart(parts, "minute");

  if (!year || !month || !day || !hour || !minute) return null;

  return {
    year,
    month,
    day,
    hour,
    minute,
    dateKey: `${year}-${month}-${day}`,
  };
}

export function getTodayDateKey(timeZone = REPORT_TIME_ZONE) {
  return getDateKey(new Date(), timeZone);
}

export function addDaysToDateKey(value, days) {
  const date = toLocalDateFromKey(value);
  if (!date) return null;

  date.setDate(date.getDate() + days);
  return formatDateKeyFromDate(date);
}

export function getWeekStartDateKey(value, timeZone = REPORT_TIME_ZONE) {
  const dateKey = parseDateKey(value)?.key || getDateKey(value, timeZone);
  const date = toLocalDateFromKey(dateKey);
  if (!date) return null;

  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return formatDateKeyFromDate(date);
}

export function isInTimeRange(txDate, timeRange, timeZone = REPORT_TIME_ZONE) {
  const todayKey = getTodayDateKey(timeZone);
  const txKey = getDateKey(txDate, timeZone);
  const today = toLocalDateFromKey(todayKey);
  const tx = toLocalDateFromKey(txKey);
  const todayParts = parseDateKey(todayKey);

  if (!today || !tx || !todayParts || !txKey) return false;

  const diff = Math.floor((today - tx) / 86400000);

  switch (timeRange) {
    case "today":
      return diff === 0;
    case "yesterday":
      return diff === 1;
    case "thisWeek": {
      const weekStart = getWeekStartDateKey(todayKey, timeZone);
      return Boolean(weekStart && txKey >= weekStart);
    }
    case "thisMonth":
      return txKey >= `${String(todayParts.year).padStart(4, "0")}-${String(todayParts.month).padStart(2, "0")}-01`;
    case "lastWeek": {
      const thisWeekStart = getWeekStartDateKey(todayKey, timeZone);
      const lastWeekStart = addDaysToDateKey(thisWeekStart, -7);
      const lastWeekEnd = addDaysToDateKey(thisWeekStart, -1);
      return Boolean(lastWeekStart && lastWeekEnd && txKey >= lastWeekStart && txKey <= lastWeekEnd);
    }
    case "lastMonth": {
      const currentMonthStart = toLocalDateFromKey(
        `${String(todayParts.year).padStart(4, "0")}-${String(todayParts.month).padStart(2, "0")}-01`
      );
      if (!currentMonthStart) return false;

      const lastMonthEnd = new Date(currentMonthStart);
      lastMonthEnd.setDate(0);
      const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);

      return txKey >= formatDateKeyFromDate(lastMonthStart) && txKey <= formatDateKeyFromDate(lastMonthEnd);
    }
    case "thisYear":
      return txKey >= `${String(todayParts.year).padStart(4, "0")}-01-01`;
    case "lastYear":
      return (
        txKey >= `${String(todayParts.year - 1).padStart(4, "0")}-01-01` &&
        txKey <= `${String(todayParts.year - 1).padStart(4, "0")}-12-31`
      );
    default: {
      const daysMap = {
        last7: 7,
        last14: 14,
        last30: 30,
        last60: 60,
        last90: 90,
        last365: 365,
      };
      return diff <= (daysMap[timeRange] || 30);
    }
  }
}

/**
 * Check if a date falls within a custom date range
 */
export function isInDateRange(txDate, startDate, endDate, timeZone = REPORT_TIME_ZONE) {
  const txKey = getDateKey(txDate, timeZone);
  const startKey = parseDateKey(startDate)?.key;
  const endKey = parseDateKey(endDate)?.key;

  return Boolean(txKey && startKey && endKey && txKey >= startKey && txKey <= endKey);
}
