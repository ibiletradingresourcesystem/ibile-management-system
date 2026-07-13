/**
 * Sales Analytics Service
 * 
 * Performs all sales-related business calculations using MongoDB aggregation.
 * Returns structured JSON metrics — NEVER uses AI for calculations.
 */
import { Transaction } from "@/models/Transactions";

/**
 * @typedef {Object} DateRange
 * @property {Date} start
 * @property {Date} end
 */

/**
 * Build a date range object for common periods
 * @param {"today"|"yesterday"|"week"|"month"|"year"|"last30"|"last90"} period
 * @returns {DateRange}
 */
export function buildSalesDateRange(period = "month") {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start, end;

  switch (period) {
    case "today":
      start = today;
      end = new Date(today.getTime() + 86400000);
      break;
    case "yesterday":
      start = new Date(today.getTime() - 86400000);
      end = today;
      break;
    case "week":
      start = new Date(today);
      start.setDate(start.getDate() - 7);
      end = new Date(today.getTime() + 86400000);
      break;
    case "month":
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getTime() + 86400000);
      break;
    case "year":
      start = new Date(today.getFullYear(), 0, 1);
      end = new Date(today.getTime() + 86400000);
      break;
    case "last30":
      start = new Date(today.getTime() - 30 * 86400000);
      end = new Date(today.getTime() + 86400000);
      break;
    case "last90":
      start = new Date(today.getTime() - 90 * 86400000);
      end = new Date(today.getTime() + 86400000);
      break;
    default:
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getTime() + 86400000);
  }
  return { start, end };
}

/**
 * Calculate sales metrics for a given period
 * @param {DateRange} dateRange
 * @param {string} [location] - Optional location filter
 * @returns {Promise<Object>}
 */
export async function calculateSalesMetrics(dateRange, location) {
  const match = {
    status: "completed",
    subStatus: { $ne: "void" },
    createdAt: { $gte: dateRange.start, $lt: dateRange.end },
  };
  if (location) match.location = location;

  const [result] = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalSales: { $sum: "$total" },
        totalTax: { $sum: { $ifNull: ["$tax", 0] } },
        totalDiscount: { $sum: { $ifNull: ["$discount", 0] } },
        transactionCount: { $sum: 1 },
        totalItemsSold: { $sum: { $sum: "$items.qty" } },
        avgTransactionValue: { $avg: "$total" },
      },
    },
  ]);

  return {
    totalSales: result?.totalSales || 0,
    totalTax: result?.totalTax || 0,
    totalDiscount: result?.totalDiscount || 0,
    transactionCount: result?.transactionCount || 0,
    totalItemsSold: result?.totalItemsSold || 0,
    avgTransactionValue: result?.avgTransactionValue || 0,
  };
}

/**
 * Calculate daily sales breakdown for a period
 * @param {DateRange} dateRange
 * @param {string} [location]
 * @returns {Promise<Array>}
 */
export async function calculateDailySales(dateRange, location) {
  const match = {
    status: "completed",
    subStatus: { $ne: "void" },
    createdAt: { $gte: dateRange.start, $lt: dateRange.end },
  };
  if (location) match.location = location;

  return Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        sales: { $sum: "$total" },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);
}

/**
 * Calculate top selling products
 * @param {DateRange} dateRange
 * @param {number} [limit=10]
 * @param {string} [location]
 * @returns {Promise<Array>}
 */
export async function calculateTopSellingProducts(dateRange, limit = 10, location) {
  const match = {
    status: "completed",
    subStatus: { $ne: "void" },
    createdAt: { $gte: dateRange.start, $lt: dateRange.end },
  };
  if (location) match.location = location;

  return Transaction.aggregate([
    { $match: match },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.productId",
        name: { $first: "$items.name" },
        unitsSold: { $sum: { $ifNull: ["$items.qty", "$items.quantity"] } },
        revenue: { $sum: { $multiply: [{ $ifNull: ["$items.salePriceIncTax", "$items.price"] }, { $ifNull: ["$items.qty", "$items.quantity"] }] } },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: limit },
  ]);
}

/**
 * Calculate sales growth rate comparing current period to previous period
 * @param {DateRange} currentRange
 * @param {string} [location]
 * @returns {Promise<Object>}
 */
export async function calculateGrowthRate(currentRange, location) {
  const duration = currentRange.end.getTime() - currentRange.start.getTime();
  const previousRange = {
    start: new Date(currentRange.start.getTime() - duration),
    end: currentRange.start,
  };

  const [current, previous] = await Promise.all([
    calculateSalesMetrics(currentRange, location),
    calculateSalesMetrics(previousRange, location),
  ]);

  const salesGrowth = previous.totalSales > 0
    ? ((current.totalSales - previous.totalSales) / previous.totalSales) * 100
    : current.totalSales > 0 ? 100 : 0;

  const transactionGrowth = previous.transactionCount > 0
    ? ((current.transactionCount - previous.transactionCount) / previous.transactionCount) * 100
    : current.transactionCount > 0 ? 100 : 0;

  return {
    salesGrowth: Math.round(salesGrowth * 10) / 10,
    transactionGrowth: Math.round(transactionGrowth * 10) / 10,
    currentPeriodSales: current.totalSales,
    previousPeriodSales: previous.totalSales,
    currentTransactions: current.transactionCount,
    previousTransactions: previous.transactionCount,
  };
}

/**
 * Calculate refund metrics
 * @param {DateRange} dateRange
 * @param {string} [location]
 * @returns {Promise<Object>}
 */
export async function calculateRefundMetrics(dateRange, location) {
  const match = {
    status: "refunded",
    createdAt: { $gte: dateRange.start, $lt: dateRange.end },
  };
  if (location) match.location = location;

  const [result] = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalRefunds: { $sum: "$total" },
        refundCount: { $sum: 1 },
      },
    },
  ]);

  return {
    totalRefunds: result?.totalRefunds || 0,
    refundCount: result?.refundCount || 0,
  };
}

/**
 * Calculate credit sales metrics
 * @param {DateRange} dateRange
 * @param {string} [location]
 * @returns {Promise<Object>}
 */
export async function calculateCreditMetrics(dateRange, location) {
  const match = {
    status: "credit",
    createdAt: { $gte: dateRange.start, $lt: dateRange.end },
  };
  if (location) match.location = location;

  const [result] = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalCredit: { $sum: "$creditOriginalTotal" },
        totalPaid: { $sum: "$creditPaidAmount" },
        totalBalance: { $sum: "$creditBalance" },
        creditCount: { $sum: 1 },
        overdueCount: { $sum: { $cond: [{ $eq: ["$creditStatus", "overdue"] }, 1, 0] } },
      },
    },
  ]);

  return {
    totalCredit: result?.totalCredit || 0,
    totalPaid: result?.totalPaid || 0,
    totalBalance: result?.totalBalance || 0,
    creditCount: result?.creditCount || 0,
    overdueCount: result?.overdueCount || 0,
  };
}
