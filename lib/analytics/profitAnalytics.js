/**
 * Profit Analytics Service
 * 
 * Calculates profit metrics using transaction items cost vs. sale price.
 * Returns structured JSON metrics — NEVER uses AI for calculations.
 */
import { Transaction } from "@/models/Transactions";
import Expense from "@/models/Expense";
import Product from "@/models/Product";
import PurchaseOrder from "@/models/PurchaseOrder";

/**
 * Calculate profit metrics for a given period
 * @param {{start: Date, end: Date}} dateRange
 * @param {string} [location]
 * @returns {Promise<Object>}
 */
export async function calculateProfitMetrics(dateRange, location) {
  const salesMatch = {
    status: "completed",
    subStatus: { $ne: "void" },
    createdAt: { $gte: dateRange.start, $lt: dateRange.end },
  };
  if (location) salesMatch.location = location;

  // Revenue + COGS from transactions, per product. A line's own cost is what the goods cost when
  // sold; lines from before costs were stamped use the product's current cost, as the books do.
  const soldProducts = await Transaction.aggregate([
    { $match: salesMatch },
    { $unwind: "$items" },
    {
      $project: {
        productId: "$items.productId",
        qty: { $ifNull: ["$items.qty", "$items.quantity"] },
        price: { $ifNull: ["$items.salePriceIncTax", "$items.price"] },
        cost: "$items.costPrice",
      },
    },
    {
      $group: {
        _id: "$productId",
        revenue: { $sum: { $multiply: ["$price", "$qty"] } },
        stampedCost: { $sum: { $cond: [{ $gt: ["$cost", 0] }, { $multiply: ["$cost", "$qty"] }, 0] } },
        unstampedQty: { $sum: { $cond: [{ $gt: ["$cost", 0] }, 0, "$qty"] } },
      },
    },
  ]);

  const needCurrentCost = soldProducts.filter((row) => row._id && row.unstampedQty > 0).map((row) => row._id);
  const currentCosts = needCurrentCost.length
    ? await Product.find({ _id: { $in: needCurrentCost } }).select("_id costPrice").lean()
    : [];
  const currentCost = new Map(currentCosts.map((product) => [String(product._id), Number(product.costPrice) || 0]));
  const salesResult = { totalRevenue: 0, totalCOGS: 0 };
  for (const row of soldProducts) {
    salesResult.totalRevenue += row.revenue || 0;
    salesResult.totalCOGS += (row.stampedCost || 0) + (row.unstampedQty || 0) * (currentCost.get(String(row._id)) || 0);
  }

  // Total expenses for the period
  const expenseMatch = {
    $or: [
      { expenseDate: { $gte: dateRange.start, $lt: dateRange.end } },
      { createdAt: { $gte: dateRange.start, $lt: dateRange.end } },
    ],
  };
  if (location) expenseMatch.locationName = location;

  const [expenseResult] = await Expense.aggregate([
    { $match: expenseMatch },
    { $group: { _id: null, totalExpenses: { $sum: "$amount" } } },
  ]);

  const revenue = salesResult?.totalRevenue || 0;
  const cogs = salesResult?.totalCOGS || 0;
  const expenses = expenseResult?.totalExpenses || 0;
  const grossProfit = revenue - cogs;
  const netProfit = grossProfit - expenses;
  const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

  return {
    totalRevenue: revenue,
    totalCOGS: cogs,
    totalExpenses: expenses,
    grossProfit,
    netProfit,
    grossMargin: Math.round(grossMargin * 10) / 10,
    netMargin: Math.round(netMargin * 10) / 10,
  };
}

/**
 * Calculate expense breakdown by category
 * @param {{start: Date, end: Date}} dateRange
 * @param {string} [location]
 * @returns {Promise<Array>}
 */
export async function calculateExpenseBreakdown(dateRange, location) {
  const match = {
    $or: [
      { expenseDate: { $gte: dateRange.start, $lt: dateRange.end } },
      { createdAt: { $gte: dateRange.start, $lt: dateRange.end } },
    ],
  };
  if (location) match.locationName = location;

  return Expense.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $ifNull: ["$categoryName", "General"] },
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
    { $limit: 10 },
  ]);
}

/**
 * Calculate purchase/vendor spending
 * @param {{start: Date, end: Date}} dateRange
 * @returns {Promise<Object>}
 */
export async function calculatePurchaseMetrics(dateRange) {
  const [result] = await PurchaseOrder.aggregate([
    { $match: { date: { $gte: dateRange.start, $lt: dateRange.end } } },
    {
      $group: {
        _id: null,
        totalPurchases: { $sum: "$grandTotal" },
        totalPaid: { $sum: "$paymentMade" },
        totalBalance: { $sum: { $subtract: ["$grandTotal", "$paymentMade"] } },
        orderCount: { $sum: 1 },
        paidCount: { $sum: { $cond: [{ $eq: ["$status", "Paid"] }, 1, 0] } },
        unpaidCount: { $sum: { $cond: [{ $eq: ["$status", "Not Paid"] }, 1, 0] } },
      },
    },
  ]);

  return {
    totalPurchases: result?.totalPurchases || 0,
    totalPaid: result?.totalPaid || 0,
    totalBalance: result?.totalBalance || 0,
    orderCount: result?.orderCount || 0,
    paidCount: result?.paidCount || 0,
    unpaidCount: result?.unpaidCount || 0,
  };
}
