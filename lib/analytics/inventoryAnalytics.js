/**
 * Inventory Analytics Service
 * 
 * Performs all inventory-related business calculations using MongoDB aggregation.
 * Returns structured JSON metrics — NEVER uses AI for calculations.
 */
import Product from "@/models/Product";

/**
 * Calculate overall inventory value and stats
 * @returns {Promise<Object>}
 */
export async function calculateInventoryValue() {
  const [result] = await Product.aggregate([
    { $match: { isArchived: { $ne: true }, isStockManaged: true } },
    {
      $group: {
        _id: null,
        totalCostValue: { $sum: { $multiply: ["$quantity", { $ifNull: ["$costPrice", 0] }] } },
        totalRetailValue: { $sum: { $multiply: ["$quantity", { $ifNull: ["$salePriceIncTax", 0] }] } },
        totalProducts: { $sum: 1 },
        totalUnits: { $sum: "$quantity" },
        avgCostPrice: { $avg: "$costPrice" },
      },
    },
  ]);

  return {
    totalCostValue: result?.totalCostValue || 0,
    totalRetailValue: result?.totalRetailValue || 0,
    potentialProfit: (result?.totalRetailValue || 0) - (result?.totalCostValue || 0),
    totalProducts: result?.totalProducts || 0,
    totalUnits: result?.totalUnits || 0,
    avgCostPrice: result?.avgCostPrice || 0,
  };
}

/**
 * Calculate low stock products (quantity <= minStock)
 * @param {number} [limit=20]
 * @returns {Promise<Object>}
 */
export async function calculateLowStock(limit = 20) {
  const lowStockProducts = await Product.aggregate([
    {
      $match: {
        isArchived: { $ne: true },
        isStockManaged: true,
        $expr: { $lte: ["$quantity", { $ifNull: ["$minStock", 5] }] },
        quantity: { $gte: 0 },
      },
    },
    {
      $project: {
        name: 1,
        quantity: 1,
        minStock: 1,
        costPrice: 1,
        salePriceIncTax: 1,
        deficit: { $subtract: [{ $ifNull: ["$minStock", 5] }, "$quantity"] },
      },
    },
    { $sort: { quantity: 1 } },
    { $limit: limit },
  ]);

  return {
    lowStockCount: lowStockProducts.length,
    lowStockProducts: lowStockProducts.map((p) => ({
      name: p.name,
      quantity: p.quantity,
      minStock: p.minStock || 5,
      deficit: p.deficit,
    })),
  };
}

/**
 * Calculate dead stock (products with zero sales in 30+ days)
 * @param {number} [daysSinceLastSale=30]
 * @returns {Promise<Object>}
 */
export async function calculateDeadStock(daysSinceLastSale = 30) {
  const cutoff = new Date(Date.now() - daysSinceLastSale * 86400000);

  const deadStock = await Product.aggregate([
    {
      $match: {
        isArchived: { $ne: true },
        isStockManaged: true,
        quantity: { $gt: 0 },
        $or: [
          { lastSoldAt: { $lt: cutoff } },
          { lastSoldAt: null },
          { lastSoldAt: { $exists: false } },
        ],
      },
    },
    {
      $project: {
        name: 1,
        quantity: 1,
        costPrice: 1,
        lastSoldAt: 1,
        tiedUpValue: { $multiply: ["$quantity", { $ifNull: ["$costPrice", 0] }] },
      },
    },
    { $sort: { tiedUpValue: -1 } },
    { $limit: 20 },
  ]);

  const totalTiedUp = deadStock.reduce((s, p) => s + (p.tiedUpValue || 0), 0);

  return {
    deadStockCount: deadStock.length,
    totalTiedUpValue: totalTiedUp,
    deadStockProducts: deadStock.map((p) => ({
      name: p.name,
      quantity: p.quantity,
      tiedUpValue: p.tiedUpValue,
      lastSoldAt: p.lastSoldAt,
    })),
  };
}

/**
 * Calculate slow-moving products (low sales velocity)
 * @param {number} [daysPeriod=30]
 * @param {number} [limit=15]
 * @returns {Promise<Array>}
 */
export async function calculateSlowMovingProducts(daysPeriod = 30, limit = 15) {
  const cutoff = new Date(Date.now() - daysPeriod * 86400000);

  return Product.aggregate([
    {
      $match: {
        isArchived: { $ne: true },
        isStockManaged: true,
        quantity: { $gt: 0 },
        totalUnitsSold: { $gt: 0 },
        lastSoldAt: { $lt: cutoff },
      },
    },
    {
      $project: {
        name: 1,
        quantity: 1,
        totalUnitsSold: 1,
        lastSoldAt: 1,
        daysSinceLastSale: {
          $divide: [{ $subtract: [new Date(), "$lastSoldAt"] }, 86400000],
        },
      },
    },
    { $sort: { daysSinceLastSale: -1 } },
    { $limit: limit },
  ]);
}

/**
 * Calculate inventory health score (0-100)
 * @returns {Promise<Object>}
 */
export async function calculateInventoryHealth() {
  const [totals] = await Product.aggregate([
    { $match: { isArchived: { $ne: true }, isStockManaged: true } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        inStock: { $sum: { $cond: [{ $gt: ["$quantity", 0] }, 1, 0] } },
        outOfStock: { $sum: { $cond: [{ $lte: ["$quantity", 0] }, 1, 0] } },
        lowStock: { $sum: { $cond: [{ $and: [{ $gt: ["$quantity", 0] }, { $lte: ["$quantity", { $ifNull: ["$minStock", 5] }] }] }, 1, 0] } },
        healthyStock: { $sum: { $cond: [{ $gt: ["$quantity", { $ifNull: ["$minStock", 5] }] }, 1, 0] } },
      },
    },
  ]);

  const total = totals?.total || 1;
  const healthScore = Math.round(((totals?.healthyStock || 0) / total) * 100);

  return {
    healthScore,
    totalProducts: totals?.total || 0,
    inStock: totals?.inStock || 0,
    outOfStock: totals?.outOfStock || 0,
    lowStock: totals?.lowStock || 0,
    healthyStock: totals?.healthyStock || 0,
    stockRate: Math.round(((totals?.inStock || 0) / total) * 100),
  };
}
