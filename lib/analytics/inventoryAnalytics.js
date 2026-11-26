/**
 * Inventory Analytics Service
 * 
 * Performs all inventory-related business calculations using MongoDB aggregation.
 * Returns structured JSON metrics — NEVER uses AI for calculations.
 */
import Product from "@/models/Product";
import Category from "@/models/Category";
import { Transaction } from "@/models/Transactions";
import { DEAD_STOCK_DAYS, LONG_LIFE_CATEGORY_TYPES, LONG_LIFE_DEAD_STOCK_DAYS } from "@/lib/ai/shopRules";

// Child products take their stock from their parent pack, so counting them would count that stock twice
const EXCLUDE_DERIVED_CHILDREN = { $nor: [{ isChildProduct: true, packType: { $ne: "pack" } }] };
const DAY_MS = 86400000;

/**
 * When each product last sold within the last `days`: product id → Date. Read from the sales
 * themselves (nothing keeps a last-sold date on the product). A unit sold from a pack counts for
 * the pack too, since the pack holds the stock.
 */
export async function lastSaleDates(days) {
  const since = new Date(Date.now() - days * DAY_MS);
  const [sold, children] = await Promise.all([
    Transaction.aggregate([
      { $match: { status: { $in: ["completed", "credit"] }, subStatus: { $ne: "void" }, createdAt: { $gte: since } } },
      { $unwind: "$items" },
      { $match: { "items.productId": { $ne: null } } },
      { $group: { _id: "$items.productId", lastSold: { $max: "$createdAt" } } },
    ]),
    Product.find({ isChildProduct: true, parentProduct: { $ne: null } }, { parentProduct: 1 }).lean(),
  ]);

  const lastSold = new Map(sold.map((row) => [String(row._id), row.lastSold]));
  for (const child of children) {
    const childSold = lastSold.get(String(child._id));
    const parentId = String(child.parentProduct);
    if (childSold && !(lastSold.get(parentId) >= childSold)) lastSold.set(parentId, childSold);
  }
  return lastSold;
}

/**
 * Category ids and lower-cased names whose goods are long-life (lib/ai/shopRules.js). A
 * sub-category with no type of its own takes its parent's.
 */
async function longLifeCategoryKeys() {
  const categories = await Category.find({}, { name: 1, icon: 1, parent: 1 }).lean();
  const byId = new Map(categories.map((category) => [String(category._id), category]));
  const isLongLife = (category, depth = 0) => {
    if (!category || depth > 10) return false;
    if (category.icon) return LONG_LIFE_CATEGORY_TYPES.has(category.icon);
    return category.parent ? isLongLife(byId.get(String(category.parent)), depth + 1) : false;
  };

  const keys = new Set();
  for (const category of categories) {
    if (!isLongLife(category)) continue;
    keys.add(String(category._id));
    if (category.name) keys.add(String(category.name).trim().toLowerCase());
  }
  return keys;
}

/**
 * Calculate overall inventory value and stats
 * @returns {Promise<Object>}
 */
export async function calculateInventoryValue() {
  const [result] = await Product.aggregate([
    { $match: { isArchived: { $ne: true }, isStockManaged: true, ...EXCLUDE_DERIVED_CHILDREN } },
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
        ...EXCLUDE_DERIVED_CHILDREN,
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
 * Dead stock: products with stock that have not sold a single unit in 2 months, or 3 months for
 * Home & Kitchen and other long-life goods (lib/ai/shopRules.js). A product newer than its window
 * has not had the chance to sell, so it is not counted. The count and value cover every dead
 * product; the list is the 20 holding the most money.
 * @returns {Promise<Object>}
 */
export async function calculateDeadStock() {
  const [lastSold, longLife, products] = await Promise.all([
    lastSaleDates(LONG_LIFE_DEAD_STOCK_DAYS),
    longLifeCategoryKeys(),
    Product.find(
      { isArchived: { $ne: true }, isStockManaged: true, quantity: { $gt: 0 }, ...EXCLUDE_DERIVED_CHILDREN },
      { name: 1, quantity: 1, costPrice: 1, category: 1, createdAt: 1 }
    ).lean(),
  ]);

  const now = Date.now();
  const dead = [];
  for (const product of products) {
    const category = String(product.category || "");
    const windowDays = longLife.has(category) || longLife.has(category.trim().toLowerCase())
      ? LONG_LIFE_DEAD_STOCK_DAYS
      : DEAD_STOCK_DAYS;
    const window = windowDays * DAY_MS;
    if (product.createdAt && now - new Date(product.createdAt).getTime() < window) continue;
    const last = lastSold.get(String(product._id));
    if (last && now - new Date(last).getTime() < window) continue;

    const quantity = Number(product.quantity) || 0;
    dead.push({
      productId: String(product._id),
      name: product.name,
      quantity,
      tiedUpValue: quantity * (Number(product.costPrice) || 0),
      lastSoldAt: last || null,
      // Null when it has not sold in the last 3 months at all
      daysSinceLastSale: last ? Math.floor((now - new Date(last).getTime()) / DAY_MS) : null,
      deadAfterDays: windowDays,
    });
  }

  dead.sort((a, b) => b.tiedUpValue - a.tiedUpValue);
  return {
    deadStockCount: dead.length,
    totalTiedUpValue: dead.reduce((sum, product) => sum + product.tiedUpValue, 0),
    deadStockProducts: dead.slice(0, 20),
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
    { $match: { isArchived: { $ne: true }, isStockManaged: true, ...EXCLUDE_DERIVED_CHILDREN } },
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
