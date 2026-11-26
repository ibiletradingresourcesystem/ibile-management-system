export function toReportNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

export function isCompletedSale(transaction = {}) {
  return transaction.status === "completed" && transaction.subStatus !== "void";
}

export function isRefundedSale(transaction = {}) {
  return transaction.status === "refunded";
}

export function getReportLocation(transaction = {}) {
  return transaction.location || "online";
}

export function getReportStaffName(transaction = {}) {
  return transaction.staff?.name || transaction.staffName || transaction.staff || "Unknown";
}

export function getReportDevice(transaction = {}) {
  return transaction.device || "POS";
}

export function getTransactionNetSales(transaction = {}) {
  return toReportNumber(transaction.total, 0);
}

export function getTransactionRefundValue(transaction = {}) {
  return toReportNumber(transaction.total, 0);
}

export function getTransactionDiscount(transaction = {}) {
  if (transaction.promotionValueType === "INCREMENT") return 0;
  return toReportNumber(transaction.discount, 0);
}

export function getTransactionTax(transaction = {}) {
  return toReportNumber(transaction.tax, 0);
}

export function getItemQuantity(item = {}) {
  return toReportNumber(item.qty ?? item.quantity, 0);
}

export function getItemUnitPrice(item = {}) {
  return toReportNumber(item.salePriceIncTax ?? item.price, 0);
}

/**
 * What the goods on a sale cost: the cost saved on each line when it sold, else the product's
 * current cost from `productCosts` (the sales feed sends it with costs=true).
 */
export function getTransactionCost(transaction = {}, productCosts = {}) {
  return (Array.isArray(transaction.items) ? transaction.items : []).reduce((sum, item) => {
    const saved = toReportNumber(item.costPrice, 0);
    const unitCost = saved > 0 ? saved : toReportNumber(productCosts[String(item.productId || "")], 0);
    return sum + getItemQuantity(item) * unitCost;
  }, 0);
}

export function getTransactionItemQuantity(transaction = {}) {
  return (Array.isArray(transaction.items) ? transaction.items : []).reduce(
    (sum, item) => sum + getItemQuantity(item),
    0
  );
}

export function getAllocatedLineItems(transaction = {}) {
  const items = (Array.isArray(transaction.items) ? transaction.items : [])
    .map((item) => {
      const quantity = getItemQuantity(item);
      const grossLineTotal = quantity * getItemUnitPrice(item);
      return { item, quantity, grossLineTotal };
    })
    .filter((entry) => entry.quantity > 0);

  const grossTotal = items.reduce((sum, entry) => sum + entry.grossLineTotal, 0);
  const netTotal = getTransactionNetSales(transaction);
  const allocationRatio = grossTotal > 0 ? netTotal / grossTotal : 1;

  return items.map((entry) => ({
    ...entry,
    netLineTotal: entry.grossLineTotal * allocationRatio,
  }));
}
