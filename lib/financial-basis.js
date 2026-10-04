/**
 * One basis for every money report.
 *
 * The tax dashboard and the books used to read the same month differently, so
 * the two pages quoted different revenue, different cost and different profit
 * for the same period. Every rule they disagreed on now lives here and both
 * sides import it:
 *
 *   what counts as a sale   completed, credit and refunded sales all happened;
 *                           a voided sale never did, so it is excluded outright
 *   how VAT is read         prices carry VAT inside them, so VAT is the slice
 *                           within the price, never 7.5% added on top of it
 *   what revenue means      net of VAT. The VAT collected is money held for the
 *                           taxman, not turnover
 *   how cost is read        the cost recorded on the sale line, falling back to
 *                           the current product cost only when there is none
 *   how refunds are read    a reversal in the period the refund was given, not
 *                           a sale retroactively deleted from an earlier one
 *   when an expense lands   on the date it was incurred, not the date the
 *                           record happened to be typed in
 *
 * Nothing here touches the database, so the API routes and the tests both use
 * it directly.
 */
import { VAT_RATE, normalizeTaxRate } from "@/lib/pricing";
import { dayKeyOf } from "@/lib/tradingDay";

export { VAT_RATE };

/** National Health Insurance levy, charged on turnover. */
export const NHL_RATE = 0.5;

/**
 * Statuses that mean a sale took place. A refunded sale is included: it did
 * happen, and the refund reverses it in the period the refund was given.
 */
export const SALE_STATUSES = ["completed", "credit", "refunded"];

export function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function roundCurrency(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

/**
 * A voided sale is a mistake struck off the record, not income.
 *
 * The till and the approval page mark every refund "void" as well as "refunded". That is still a
 * refund — the sale happened and is reversed in the period the money went back — so it is not
 * read as a void. Reading it as one took refunded sales out of the month they were made in,
 * after that month had been reported, and left no refund in the month it was given.
 */
export function isVoided(tx) {
  return String(tx?.subStatus || "") === "void" && String(tx?.status || "") !== "refunded";
}

export function countsAsSale(tx) {
  if (!tx || isVoided(tx)) return false;
  return SALE_STATUSES.includes(String(tx.status || ""));
}

/** What the customer owed, VAT included. Credit sales keep their original total. */
export function saleGross(tx) {
  if (!tx) return 0;
  if (String(tx.status || "") === "credit") {
    return roundCurrency(toNumber(tx.creditOriginalTotal) || toNumber(tx.total));
  }
  return roundCurrency(tx.total);
}

export function lineQty(item) {
  return toNumber(item?.qty ?? item?.quantity);
}

/** What the line sold for in total, VAT inside. */
export function lineGross(item) {
  return toNumber(item?.salePriceIncTax ?? item?.price) * lineQty(item);
}

/** The line VAT rate: whatever the POS stamped on it, else the product rate. */
export function lineTaxRate(item, productMap = {}) {
  if (item?.taxRate !== undefined && item?.taxRate !== null) {
    return normalizeTaxRate(item.taxRate);
  }
  const info = productMap[String(item?.productId || "")];
  return info ? normalizeTaxRate(info.taxRate) : 0;
}

/** The VAT sitting inside a VAT-inclusive amount. */
export function vatWithin(amountIncTax, rate = VAT_RATE) {
  const taxRate = toNumber(rate);
  if (taxRate <= 0) return 0;
  const amount = toNumber(amountIncTax);
  return roundCurrency(amount - amount / (1 + taxRate / 100));
}

/** The VAT-inclusive amount that holds a given amount of VAT. */
export function grossHoldingVat(vatAmount, rate = VAT_RATE) {
  const taxRate = toNumber(rate);
  if (taxRate <= 0) return 0;
  return roundCurrency((toNumber(vatAmount) * (100 + taxRate)) / taxRate);
}

/**
 * The VAT on a sale. The figure the POS recorded wins, because that is what the
 * customer was actually charged; otherwise it is read out of the VAT-able lines.
 */
export function saleVat(tx, productMap = {}) {
  const items = Array.isArray(tx?.items) ? tx.items : [];
  let vatableGross = 0;
  for (const item of items) {
    if (lineTaxRate(item, productMap) > 0) vatableGross += lineGross(item);
  }

  const recorded = roundCurrency(tx?.tax);
  const derived = vatWithin(vatableGross);
  const vat = recorded > 0 ? recorded : derived;

  return {
    // A sold-and-since-deleted product leaves no line to read, so the VAT-able
    // slice is worked back out of the VAT that was charged.
    vatableGross: vatableGross > 0 ? roundCurrency(vatableGross) : grossHoldingVat(vat),
    vat,
    vatSource: recorded > 0 ? "recorded" : derived > 0 ? "derived" : "none",
  };
}

/**
 * What the goods on a sale cost. The cost stamped on the line is what the stock
 * cost at the time it went out; the current product cost is only a fallback,
 * and lines with neither are counted so a report can admit it is incomplete.
 */
export function saleCogs(tx, productMap = {}) {
  const items = Array.isArray(tx?.items) ? tx.items : [];
  let cost = 0;
  let missingCostLines = 0;

  for (const item of items) {
    const quantity = lineQty(item);
    if (quantity <= 0) continue;

    const lineCost = toNumber(item?.costPrice ?? item?.unitCost ?? item?.purchasePrice);
    if (lineCost > 0) {
      cost += quantity * lineCost;
      continue;
    }

    const productCost = toNumber(productMap[String(item?.productId || "")]?.costPrice);
    if (productCost > 0) cost += quantity * productCost;
    else missingCostLines += 1;
  }

  return { cost: roundCurrency(cost), missingCostLines };
}

/**
 * Month bucket for a date, in the shop's time (Lagos): a sortable key plus the label the reports
 * print. Read in the server's time, a sale at 12:30am on the 1st went into the month before.
 */
export function monthBucket(date) {
  const day = date ? dayKeyOf(date) : null;
  if (!day) return null;
  const monthKey = day.slice(0, 7);
  return {
    monthKey,
    month: new Date(`${monthKey}-15T12:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

/**
 * Wording that gives away an expense which is really stock buying. It is only a
 * fallback: a category marked INVENTORY on the categories page decides outright,
 * and this catches the rows that predate the marking, including the petty cash
 * "Supplies/Stock Purchase" entries the till writes.
 */
export const STOCK_PURCHASE_KEYWORDS = [
  "stock purchase",
  "supplies/stock",
  "purchase of stock",
  "stock bought",
  "restock",
  "goods for resale",
  "goods purchase",
  "purchase of goods",
  "product purchase",
  "purchase product",
  "inventory purchase",
  "merchandise",
  "cost of goods",
];

/**
 * EXPENSE or INVENTORY. Stock bought for resale is not a cost of running the
 * business: it sits in inventory and only reaches profit as cost of goods sold
 * when it sells, so treating it as an expense as well charges it twice.
 *
 * `categoryTreatments` is keyed by category id and by lower-cased category name.
 */
export function expenseTreatment(expense, categoryTreatments = {}) {
  const categoryId = expense?.categoryId || expense?.category;
  const marked =
    (categoryId && categoryTreatments[String(categoryId)]) ||
    (expense?.categoryName && categoryTreatments[String(expense.categoryName).trim().toLowerCase()]);
  if (marked) return String(marked).toUpperCase() === "INVENTORY" ? "INVENTORY" : "EXPENSE";

  const text = [expense?.categoryName, expense?.title, expense?.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return STOCK_PURCHASE_KEYWORDS.some((keyword) => text.includes(keyword)) ? "INVENTORY" : "EXPENSE";
}

export function isStockPurchase(expense, categoryTreatments = {}) {
  return expenseTreatment(expense, categoryTreatments) === "INVENTORY";
}

/** The date an expense belongs to: when it was incurred, not when it was typed. */
export function expenseDateOf(expense) {
  return expense?.expenseDate || expense?.createdAt || null;
}

function emptyMonth(bucket) {
  return {
    ...bucket,
    grossSales: 0,
    vat: 0,
    netSales: 0,
    vatableGross: 0,
    cogs: 0,
    refundGross: 0,
    refundVat: 0,
    refundNet: 0,
    refundCogs: 0,
    expenses: 0,
    stockPurchases: 0,
  };
}

/**
 * Every money figure for one period, on the one basis.
 *
 * `sales` are the sales made inside the period; `refunds` are the refunds given
 * inside it, whichever period the original sale belonged to. That separation is
 * what stops a refund quietly rewriting a month that has already been reported.
 */
export function summarizePeriod({
  sales = [],
  refunds = [],
  expenses = [],
  productMap = {},
  categoryTreatments = {},
  voidedCount = 0,
} = {}) {
  const months = new Map();
  const monthFor = (date) => {
    const bucket = monthBucket(date);
    if (!bucket) return null;
    if (!months.has(bucket.monthKey)) months.set(bucket.monthKey, emptyMonth(bucket));
    return months.get(bucket.monthKey);
  };

  const totals = {
    grossSales: 0,
    vat: 0,
    vatableGross: 0,
    cogs: 0,
    missingCostLines: 0,
    refundGross: 0,
    refundVat: 0,
    refundCogs: 0,
    expenses: 0,
    stockPurchases: 0,
  };
  const counts = { sales: 0, cash: 0, credit: 0, refunds: 0, voided: voidedCount, stockPurchases: 0 };

  for (const tx of sales) {
    if (!countsAsSale(tx)) continue;
    const gross = saleGross(tx);
    const { vat, vatableGross } = saleVat(tx, productMap);
    const { cost, missingCostLines } = saleCogs(tx, productMap);

    totals.grossSales += gross;
    totals.vat += vat;
    totals.vatableGross += vatableGross;
    totals.cogs += cost;
    totals.missingCostLines += missingCostLines;
    counts.sales += 1;
    if (String(tx.status || "") === "credit") counts.credit += 1;
    else counts.cash += 1;

    const month = monthFor(tx.createdAt);
    if (month) {
      month.grossSales += gross;
      month.vat += vat;
      month.netSales += gross - vat;
      month.vatableGross += vatableGross;
      month.cogs += cost;
    }
  }

  for (const tx of refunds) {
    if (isVoided(tx)) continue;
    const gross = saleGross(tx);
    const { vat } = saleVat(tx, productMap);
    const { cost } = saleCogs(tx, productMap);

    totals.refundGross += gross;
    totals.refundVat += vat;
    totals.refundCogs += cost;
    counts.refunds += 1;

    const month = monthFor(tx.refundedAt || tx.createdAt);
    if (month) {
      month.refundGross += gross;
      month.refundVat += vat;
      month.refundNet += gross - vat;
      month.refundCogs += cost;
    }
  }

  for (const expense of expenses) {
    const amount = toNumber(expense?.amount);
    // Stock buying is held apart: it is already in the cost of sales figure the
    // moment the goods sell, so charging it here as well would double count it.
    const isStock = isStockPurchase(expense, categoryTreatments);
    if (isStock) {
      totals.stockPurchases += amount;
      counts.stockPurchases += 1;
    } else {
      totals.expenses += amount;
    }

    const month = monthFor(expenseDateOf(expense));
    if (month) {
      if (isStock) month.stockPurchases += amount;
      else month.expenses += amount;
    }
  }

  const netSales = roundCurrency(totals.grossSales - totals.vat);
  const refundNet = roundCurrency(totals.refundGross - totals.refundVat);
  const netRevenue = roundCurrency(netSales - refundNet);
  const costOfSales = roundCurrency(totals.cogs - totals.refundCogs);
  const operatingExpenses = roundCurrency(totals.expenses);
  const grossProfit = roundCurrency(netRevenue - costOfSales);

  const monthly = Array.from(months.values())
    .map((month) => ({
      ...month,
      grossSales: roundCurrency(month.grossSales),
      vat: roundCurrency(month.vat),
      netSales: roundCurrency(month.netSales),
      vatableGross: roundCurrency(month.vatableGross),
      cogs: roundCurrency(month.cogs),
      refundGross: roundCurrency(month.refundGross),
      refundVat: roundCurrency(month.refundVat),
      refundNet: roundCurrency(month.refundNet),
      refundCogs: roundCurrency(month.refundCogs),
      expenses: roundCurrency(month.expenses),
      stockPurchases: roundCurrency(month.stockPurchases),
      netRevenue: roundCurrency(month.netSales - month.refundNet),
      grossRevenue: roundCurrency(month.grossSales - month.refundGross),
      vatPayable: roundCurrency(month.vat - month.refundVat),
      costOfSales: roundCurrency(month.cogs - month.refundCogs),
    }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  return {
    grossSales: roundCurrency(totals.grossSales),
    vat: roundCurrency(totals.vat),
    netSales,
    vatableGross: roundCurrency(totals.vatableGross),
    cogs: roundCurrency(totals.cogs),
    missingCostLines: totals.missingCostLines,

    refundGross: roundCurrency(totals.refundGross),
    refundVat: roundCurrency(totals.refundVat),
    refundNet,
    refundCogs: roundCurrency(totals.refundCogs),

    /** What customers paid, refunds taken off, VAT still inside. */
    grossRevenue: roundCurrency(totals.grossSales - totals.refundGross),
    /** Turnover: the same figure with the VAT taken out. Both reports quote this. */
    netRevenue,
    /** VAT owed for the period: collected on sales, less VAT handed back. */
    vatPayable: roundCurrency(totals.vat - totals.refundVat),
    costOfSales,
    expenses: operatingExpenses,
    /**
     * Money spent buying stock in the period. Not deducted from profit here: it
     * is an asset until it sells, and it reaches profit through costOfSales.
     */
    stockPurchases: roundCurrency(totals.stockPurchases),
    grossProfit,
    netProfit: roundCurrency(grossProfit - operatingExpenses),

    counts,
    monthly,
  };
}
