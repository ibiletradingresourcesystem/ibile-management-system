/**
 * Counting rules shared by the stock take screens (desktop and phone): what counting a line does,
 * pack + each groups, the totals, and references.
 */

export function generateStockTakeRef() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ST-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${rand}`;
}

export const isCounted = (item) => item?.countedQty !== null && item?.countedQty !== undefined;

export function markItemCounted(item, countedQty, countedBy = "System") {
  item.countedQty = Number(countedQty || 0);
  item.variance = item.countedQty - item.systemQty;
  item.varianceValue = item.variance * item.costPrice;
  item.status = "counted";
  item.countedAt = new Date();
  item.countedBy = countedBy;
  item.reason = item.variance !== 0 ? (item.reason || "Stock Take") : "";
}

/** A pack + each product's lines, by product. */
export function groupByProduct(items = []) {
  const groups = new Map();
  for (const item of items) {
    const productId = String(item.productId || "");
    if (!productId) continue;
    const group = groups.get(productId) || [];
    group.push(item);
    groups.set(productId, group);
  }
  return groups;
}

/** A pack + each product with one of its lines counted has the other counted as 0. */
export function completePartiallyCountedPackGroups(stockTake, countedBy = "System") {
  for (const groupItems of groupByProduct(stockTake.items || []).values()) {
    const hasLooseUnits = groupItems.some((item) => item.countType === "loose-units");
    if (!hasLooseUnits) continue;
    if (!groupItems.some(isCounted)) continue;
    groupItems.forEach((item) => {
      if (!isCounted(item)) markItemCounted(item, 0, countedBy);
    });
  }
}

export function recalcSummary(stockTake) {
  const items = stockTake.items || [];
  stockTake.totalItems = items.length;
  stockTake.countedItems = items.filter((item) => item.status === "counted").length;
  stockTake.totalSystemQty = items.reduce((sum, item) => sum + (item.systemQty || 0), 0);
  stockTake.totalCountedQty = items
    .filter((item) => item.countedQty !== null)
    .reduce((sum, item) => sum + item.countedQty, 0);
  stockTake.totalVariance = items
    .filter((item) => item.countedQty !== null)
    .reduce((sum, item) => sum + item.variance, 0);
  stockTake.totalVarianceValue = items
    .filter((item) => item.countedQty !== null)
    .reduce((sum, item) => sum + item.varianceValue, 0);
  stockTake.positiveVariance = items.filter((item) => item.variance > 0).reduce((sum, item) => sum + item.variance, 0);
  stockTake.negativeVariance = items.filter((item) => item.variance < 0).reduce((sum, item) => sum + Math.abs(item.variance), 0);
  stockTake.accuracyRate = stockTake.totalItems > 0
    ? Math.round((items.filter((item) => item.countedQty !== null && item.variance === 0).length / stockTake.totalItems) * 100)
    : 0;
}
