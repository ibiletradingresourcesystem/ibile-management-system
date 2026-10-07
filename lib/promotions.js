/**
 * Product promotions: dates and status.
 *
 * What a promotion is and what it takes off a sale is in lib/promotionRules.js, shared with the
 * till. This file is the management app's side: reading the dates a promotion form sends, and
 * whether a promotion is running, scheduled or over.
 *
 * Days are the shop's (Lagos): a promotion runs from the start of its first day to the end of its
 * last. Stored at midnight UTC, the last day ended at 1am and the sweep that clears expired
 * promotions took it off a day early.
 */
import { dayKeyOf, shopDaysBounds } from "@/lib/tradingDay";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day a promotion date stands for: a "YYYY-MM-DD" from a date picker, or a picked date that
 * arrived as midnight (UTC or Lagos). A real moment of the day is left as it is.
 */
function pickedDay(value) {
  if (!value) return null;
  if (typeof value === "string" && DATE_ONLY.test(value.trim())) return value.trim();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  if (iso.endsWith("T00:00:00.000Z")) return iso.slice(0, 10);
  if (iso.endsWith("T23:00:00.000Z")) return dayKeyOf(date);
  return null;
}

/** A date and time picked on a form ("YYYY-MM-DDTHH:mm", no zone), read as Lagos time. */
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
function shopMoment(value) {
  if (typeof value !== "string" || !LOCAL_DATE_TIME.test(value.trim())) return null;
  const text = value.trim();
  return new Date(`${text}${text.length === 16 ? ":00" : ""}+01:00`);
}

/**
 * The moments a promotion runs between. A date and time is taken as it is (Lagos time); a date on
 * its own runs from the shop's midnight on the first day to the end of the last.
 */
export function promotionWindow(startInput, endInput) {
  const startDay = pickedDay(startInput);
  const endDay = pickedDay(endInput);
  const start = shopMoment(startInput) || (startDay ? shopDaysBounds(startDay).start : startInput ? new Date(startInput) : null);
  const end = shopMoment(endInput) || (endDay ? new Date(shopDaysBounds(endDay).end.getTime() - 1) : endInput ? new Date(endInput) : null);
  return {
    start: start && !Number.isNaN(start.getTime()) ? start : null,
    end: end && !Number.isNaN(end.getTime()) ? end : null,
  };
}

/** "scheduled", "running", "ended", or "off" for a product with no promotion. */
export function promotionStatus(product, now = new Date()) {
  if (!product?.isPromotion) return "off";
  const start = product.promoStart ? new Date(product.promoStart) : null;
  const end = product.promoEnd ? new Date(product.promoEnd) : null;
  if (end && end < now) return "ended";
  if (start && start > now) return "scheduled";
  return "running";
}
