/**
 * Dashboard Analytics — Master Service
 * 
 * Orchestrates all analytics services to produce a unified metrics object
 * that becomes the input for AI insight generation.
 */
import { calculateSalesMetrics, calculateTopSellingProducts, calculateGrowthRate, calculateRefundMetrics, calculateCreditMetrics, buildSalesDateRange } from "./salesAnalytics";
import { calculateInventoryValue, calculateLowStock, calculateDeadStock, calculateInventoryHealth } from "./inventoryAnalytics";
import { calculateProfitMetrics, calculateExpenseBreakdown, calculatePurchaseMetrics } from "./profitAnalytics";

/**
 * Generate comprehensive dashboard metrics for a given period
 * @param {"today"|"week"|"month"|"year"|"last30"|"last90"} [period="month"]
 * @param {string} [location] - Optional location filter
 * @returns {Promise<Object>} Unified metrics object
 */
export async function generateDashboardMetrics(period = "month", location) {
  const dateRange = buildSalesDateRange(period);

  // Execute all analytics in parallel for performance
  const [
    sales,
    growth,
    topProducts,
    refunds,
    credits,
    inventory,
    lowStock,
    deadStock,
    inventoryHealth,
    profit,
    expenses,
    purchases,
  ] = await Promise.all([
    calculateSalesMetrics(dateRange, location),
    calculateGrowthRate(dateRange, location),
    calculateTopSellingProducts(dateRange, 10, location),
    calculateRefundMetrics(dateRange, location),
    calculateCreditMetrics(dateRange, location),
    calculateInventoryValue(),
    calculateLowStock(10),
    calculateDeadStock(30),
    calculateInventoryHealth(),
    calculateProfitMetrics(dateRange, location),
    calculateExpenseBreakdown(dateRange, location),
    calculatePurchaseMetrics(dateRange),
  ]);

  // Format period label
  const periodLabel = formatPeriodLabel(period, dateRange);

  return {
    reportPeriod: periodLabel,
    generatedAt: new Date().toISOString(),
    period,
    location: location || "All Locations",

    sales: {
      totalSales: sales.totalSales,
      transactionCount: sales.transactionCount,
      avgTransactionValue: Math.round(sales.avgTransactionValue),
      totalItemsSold: sales.totalItemsSold,
      totalTax: sales.totalTax,
      totalDiscount: sales.totalDiscount,
    },

    growth: {
      salesGrowth: growth.salesGrowth,
      transactionGrowth: growth.transactionGrowth,
      currentPeriodSales: growth.currentPeriodSales,
      previousPeriodSales: growth.previousPeriodSales,
    },

    topProducts: topProducts.map((p) => ({
      name: p.name || "Unknown",
      unitsSold: p.unitsSold,
      revenue: Math.round(p.revenue),
    })),

    refunds: {
      totalRefunds: refunds.totalRefunds,
      refundCount: refunds.refundCount,
    },

    credits: {
      totalCredit: credits.totalCredit,
      totalBalance: credits.totalBalance,
      creditCount: credits.creditCount,
      overdueCount: credits.overdueCount,
    },

    inventory: {
      totalCostValue: inventory.totalCostValue,
      totalRetailValue: inventory.totalRetailValue,
      potentialProfit: inventory.potentialProfit,
      totalProducts: inventory.totalProducts,
      totalUnits: inventory.totalUnits,
    },

    stockHealth: {
      healthScore: inventoryHealth.healthScore,
      inStock: inventoryHealth.inStock,
      outOfStock: inventoryHealth.outOfStock,
      lowStockCount: lowStock.lowStockCount,
      deadStockCount: deadStock.deadStockCount,
      deadStockValue: deadStock.totalTiedUpValue,
    },

    lowStockProducts: lowStock.lowStockProducts.slice(0, 5),
    deadStockProducts: deadStock.deadStockProducts.slice(0, 5),

    profit: {
      totalRevenue: profit.totalRevenue,
      totalCOGS: profit.totalCOGS,
      grossProfit: profit.grossProfit,
      netProfit: profit.netProfit,
      grossMargin: profit.grossMargin,
      netMargin: profit.netMargin,
      totalExpenses: profit.totalExpenses,
    },

    expenseBreakdown: expenses.slice(0, 6).map((e) => ({
      category: e._id,
      total: e.total,
      count: e.count,
    })),

    purchases: {
      totalPurchases: purchases.totalPurchases,
      totalPaid: purchases.totalPaid,
      totalBalance: purchases.totalBalance,
      orderCount: purchases.orderCount,
    },
  };
}

/**
 * Format a human-readable period label
 * @param {string} period
 * @param {{start: Date, end: Date}} dateRange
 * @returns {string}
 */
function formatPeriodLabel(period, dateRange) {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const now = new Date();
  switch (period) {
    case "today": return `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
    case "yesterday": { const y = new Date(now.getTime() - 86400000); return `${y.getDate()} ${months[y.getMonth()]} ${y.getFullYear()}`; }
    case "week": return `Week of ${dateRange.start.getDate()} ${months[dateRange.start.getMonth()]}`;
    case "month": return `${months[now.getMonth()]} ${now.getFullYear()}`;
    case "year": return `${now.getFullYear()}`;
    case "last30": return "Last 30 Days";
    case "last90": return "Last 90 Days";
    default: return `${months[now.getMonth()]} ${now.getFullYear()}`;
  }
}
