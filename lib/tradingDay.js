/**
 * The shop's trading day.
 *
 * The shop opens at 6am and its last till can close as late as 2am, so a trading day runs from 6am
 * to 6am the next morning. A till closed at 1:30am holds the previous day's takings and is that
 * day's cash; a payment made at 1am comes out of that same day's cash.
 *
 * Everything here is in the shop's time, Africa/Lagos (UTC+1 all year, no daylight saving), not the
 * server's. The server runs on UTC, where midnight is 1am in the shop, and a till dates its reports
 * by its own clock, so "the day" was an hour out depending on who wrote it.
 *
 * Days are passed around as "YYYY-MM-DD" keys.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Africa/Lagos is UTC+1 all year. */
const SHOP_OFFSET = 1 * HOUR;

/** The hour, shop time, a trading day starts. Anything earlier belongs to the day before. */
export const TRADING_DAY_START_HOUR = 6;
const DAY_START = TRADING_DAY_START_HOUR * HOUR;

const KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function timeOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

const keyAt = (time) => new Date(time).toISOString().slice(0, 10);
const midnightUtc = (key) => Date.parse(`${key}T00:00:00.000Z`);

/** The trading day a moment falls in: 1:30am on the 5th is the 4th. */
export function tradingDayKey(value) {
  const time = timeOf(value);
  return time === null ? null : keyAt(time + SHOP_OFFSET - DAY_START);
}

/**
 * The day a date stands for, as opposed to a moment: a "YYYY-MM-DD" someone picked, or the date on
 * a cash entry. Entries are dated at midnight — UTC midnight when the server wrote them, the shop's
 * midnight when a computer in the shop did — and both read as the same day here.
 */
export function dayKeyOf(value) {
  if (typeof value === "string" && KEY_PATTERN.test(value.trim())) return value.trim();
  const time = timeOf(value);
  return time === null ? null : keyAt(time + SHOP_OFFSET);
}

/** The trading day it is now: before 6am that is still yesterday. */
export const currentTradingDay = (now = new Date()) => tradingDayKey(now);

export const addDays = (key, days) => keyAt(midnightUtc(key) + days * DAY);

export const daysBetween = (fromKey, toKey) => Math.round((midnightUtc(toKey) - midnightUtc(fromKey)) / DAY);

export const earlierDay = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
export const laterDay = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

/** When a trading day starts and ends: 6am that day to 6am the next, shop time. */
export function tradingDayBounds(key) {
  const start = midnightUtc(key) - SHOP_OFFSET + DAY_START;
  return { start: new Date(start), end: new Date(start + DAY) };
}

/** A query range over moments, from the start of one trading day to the end of another. */
export function tradingDaysRange(fromKey, toKey = fromKey) {
  return { $gte: tradingDayBounds(fromKey).start, $lt: tradingDayBounds(toKey).end };
}

/** The date a cash entry for a day is written with: UTC midnight, which reads as that day anywhere. */
export const dayDate = (key) => new Date(midnightUtc(key));

/**
 * Calendar days in the shop, as moments: from the shop's midnight starting `fromKey` to the
 * midnight after `toKey`. This is what a "From"/"To" date picked on a report means — the whole of
 * the last day included, in Lagos, not up to the server's midnight at the start of it.
 */
export function shopDaysBounds(fromKey, toKey = fromKey) {
  return {
    start: new Date(midnightUtc(fromKey) - SHOP_OFFSET),
    end: new Date(midnightUtc(toKey) + DAY - SHOP_OFFSET),
  };
}

/** A query range covering every date an entry for these days can carry, however it was written. */
export function dayDatesRange(fromKey, toKey = fromKey) {
  const { start, end } = shopDaysBounds(fromKey, toKey);
  return { $gte: start, $lt: end };
}

/** "Sat 04/10/2026" — the same on every computer, whatever its own time zone. */
export function formatDayKey(key, { weekday = false } = {}) {
  if (!key || !KEY_PATTERN.test(key)) return "";
  return new Date(`${key}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    ...(weekday ? { weekday: "short" } : {}),
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}
