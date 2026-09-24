/**
 * Which stock band a product is in — worked out in one place so the cards, the
 * filters, the Status column and the exported report all agree.
 *
 * The bands used to overlap: "critical" was `quantity < minStock / 2` and "low" was
 * `quantity < minStock`, so every critical product was counted as low as well, and
 * for the many products with no minimum set both rules collapsed to "below zero" —
 * which is why the two cards showed almost the same number.
 *
 * Every product now falls in exactly one band, so the cards add up to the catalogue.
 */

export const STOCK_STATES = {
  NEGATIVE: "negative",
  NONE: "none",
  CRITICAL: "critical",
  LOW: "low",
  HEALTHY: "healthy",
};

export const STOCK_STATE_LABELS = {
  [STOCK_STATES.NEGATIVE]: "Negative Stock",
  [STOCK_STATES.NONE]: "Out of Stock",
  [STOCK_STATES.CRITICAL]: "Critical",
  [STOCK_STATES.LOW]: "Low Stock",
  [STOCK_STATES.HEALTHY]: "In Stock",
};

/**
 * @returns {"negative"|"none"|"critical"|"low"|"healthy"}
 *
 * Below zero is negative; nothing left is none. After that the minimum stock level
 * decides: at or under half of it is critical, under it is low, at or over it is
 * healthy. A product with no minimum set has no threshold to fall below, so it is
 * healthy as long as it has stock.
 */
export function getStockState(product) {
  const quantity = Number(product?.quantity) || 0;
  const minStock = Number(product?.minStock) || 0;

  if (quantity < 0) return STOCK_STATES.NEGATIVE;
  if (quantity === 0) return STOCK_STATES.NONE;
  if (minStock > 0 && quantity <= minStock / 2) return STOCK_STATES.CRITICAL;
  if (minStock > 0 && quantity < minStock) return STOCK_STATES.LOW;
  return STOCK_STATES.HEALTHY;
}

export const getStockStateLabel = (product) => STOCK_STATE_LABELS[getStockState(product)];

/** How many products are in each band. */
export function countStockStates(products = []) {
  const counts = { negative: 0, none: 0, critical: 0, low: 0, healthy: 0 };
  for (const product of products) counts[getStockState(product)] += 1;
  return counts;
}
