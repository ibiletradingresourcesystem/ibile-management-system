/**
 * Product promotions: a promo price on a product between two dates.
 *
 * That is all a product promotion stores (isPromotion, promoPrice, promoStart, promoEnd). The
 * promotions pages used to offer deal types, quantities, days of the week and customer types that
 * were never saved anywhere, and the add page wrote the promotion's name over the name of every
 * product in it. Customer-type deals live in Customer Campaigns, not here.
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

/** The moments a promotion runs between: the shop's midnight on its first day to the end of its last. */
export function promotionWindow(startInput, endInput) {
  const startDay = pickedDay(startInput);
  const endDay = pickedDay(endInput);
  const start = startDay ? shopDaysBounds(startDay).start : startInput ? new Date(startInput) : null;
  const end = endDay ? new Date(shopDaysBounds(endDay).end.getTime() - 1) : endInput ? new Date(endInput) : null;
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

/** The price after taking a percentage off, to the nearest naira. */
export function priceAfterPercentOff(price, percentOff) {
  const base = Number(price) || 0;
  const percent = Math.min(Math.max(Number(percentOff) || 0, 0), 100);
  return Math.round(base * (1 - percent / 100));
}

/** What is wrong with a promo price for a product, or "" when it is fine. */
export function promoPriceProblem(product, promoPrice) {
  const price = Number(promoPrice);
  const normal = Number(product?.salePriceIncTax) || 0;
  if (!Number.isFinite(price) || price <= 0) return "The promo price must be more than ₦0";
  if (normal > 0 && price >= normal) return `The promo price must be below the normal price of ₦${normal.toLocaleString("en-NG")}`;
  return "";
}
