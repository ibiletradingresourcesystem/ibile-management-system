/**
 * Number and money formatting for the whole app.
 *
 * Intl.NumberFormat throws a RangeError as soon as the minimum number of
 * fraction digits ends up above the maximum, and that is easy to trigger by
 * asking for whole naira — `formatCurrency(v, { maximumFractionDigits: 0 })`
 * used to land on top of the two-decimal default and throw, which took down
 * whichever page was rendering at the time. A formatter has no business
 * crashing a page, so the digit options are reconciled here and anything that
 * still fails falls back to readable text.
 */

const CURRENCY_DEFAULTS = {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

/**
 * Merge caller options over defaults while keeping
 * minimumFractionDigits <= maximumFractionDigits. What the caller asked for
 * explicitly wins over the default it collides with.
 */
const reconcileDigits = (defaults, options) => {
  const merged = { ...defaults, ...options };
  const min = merged.minimumFractionDigits;
  const max = merged.maximumFractionDigits;
  if (typeof min !== "number" || typeof max !== "number" || min <= max) return merged;

  const askedMin = typeof options.minimumFractionDigits === "number";
  const askedMax = typeof options.maximumFractionDigits === "number";
  if (askedMin && !askedMax) merged.maximumFractionDigits = min;
  else merged.minimumFractionDigits = max;
  return merged;
};

export const formatNumber = (value = 0, options = {}) => {
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) {
    return "0";
  }

  try {
    return new Intl.NumberFormat("en-NG", reconcileDigits({}, options || {})).format(numberValue);
  } catch {
    return String(numberValue);
  }
};

export const formatCurrency = (value = 0, options = {}) => {
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) {
    return "\u20A60.00";
  }

  try {
    return new Intl.NumberFormat("en-NG", reconcileDigits(CURRENCY_DEFAULTS, options || {})).format(numberValue);
  } catch {
    return `\u20A6${numberValue.toFixed(2)}`;
  }
};
