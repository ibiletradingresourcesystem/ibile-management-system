/**
 * AI Restock Recommendation Engine
 *
 * The plan — what to order, how much, how long the stock will last, what it will cost — is worked
 * out here from each product's own sales over the last 30 days. It used to be handed to the AI to
 * do that arithmetic, which a language model gets wrong often enough to matter, and the plan only
 * ever looked at the 30 products with the least stock, so a fast seller with 60 left never made it
 * onto the list. The AI now writes the summary and the order of priority around figures it is
 * given, and if no AI is available the plan still stands.
 */
import { executeRecommendationPipeline } from "./orchestrator";
import Product from "@/models/Product";
import { Transaction } from "@/models/Transactions";
import { childQtyToParentQty, isDerivedChild } from "@/lib/packUnits";
import { generateAIText } from "./provider";

/** Days of sales the plan reads. */
const SALES_WINDOW_DAYS = 30;
/** How long local suppliers take to deliver, and the cushion kept on top. */
export const LEAD_DAYS = 5;
export const SAFETY_DAYS = 3;
/** An order should leave this many days of stock once it arrives. */
export const COVER_DAYS = 14;

const LIST_LIMIT = 25;

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * The restock plan from stock and sales alone. Sales are completed and credit sales (a credit
 * sale empties the shelf too); a single sold out of a pack counts as the part of a pack it used.
 */
export async function buildRestockPlan({ now = new Date() } = {}) {
  const since = new Date(now.getTime() - SALES_WINDOW_DAYS * 86400000);

  const [products, sales] = await Promise.all([
    Product.find({ isArchived: { $ne: true }, isStockManaged: true })
      .select("name quantity costPrice minStock maxStock isChildProduct parentProduct packType qtyPerPack unitsPerChild")
      .lean(),
    Transaction.aggregate([
      { $match: { status: { $in: ["completed", "credit"] }, subStatus: { $ne: "void" }, createdAt: { $gte: since } } },
      { $unwind: "$items" },
      { $group: { _id: "$items.productId", units: { $sum: { $ifNull: ["$items.qty", "$items.quantity"] } } } },
    ]),
  ]);

  const byId = new Map(products.map((product) => [String(product._id), product]));
  const unitsSold = new Map();
  for (const row of sales) {
    const product = byId.get(String(row._id));
    if (!product) continue;
    // A child has no stock of its own: what it sold came out of its parent's packs
    if (isDerivedChild(product)) {
      const parent = byId.get(String(product.parentProduct));
      if (!parent) continue;
      const key = String(parent._id);
      unitsSold.set(key, (unitsSold.get(key) || 0) + childQtyToParentQty(row.units, product, parent));
    } else {
      const key = String(product._id);
      unitsSold.set(key, (unitsSold.get(key) || 0) + (Number(row.units) || 0));
    }
  }

  const lines = [];
  for (const product of products) {
    if (isDerivedChild(product)) continue;
    const stock = Math.max(0, Number(product.quantity) || 0);
    const sold = unitsSold.get(String(product._id)) || 0;
    const avgDailySales = sold / SALES_WINDOW_DAYS;
    const minStock = Number(product.minStock) || 0;
    const maxStock = Number(product.maxStock) || 0;
    const daysOfStock = avgDailySales > 0 ? stock / avgDailySales : null;

    // Enough to see out the delivery and the cover after it, never below the minimum set
    let target = Math.max(avgDailySales * (LEAD_DAYS + COVER_DAYS), minStock);
    if (maxStock > 0) target = Math.min(target, maxStock);
    const recommendedQty = Math.max(0, Math.ceil(target - stock));

    let urgency = null;
    if (avgDailySales > 0) {
      if (stock <= 0 || daysOfStock < SAFETY_DAYS) urgency = "critical";
      else if (daysOfStock < LEAD_DAYS + SAFETY_DAYS) urgency = "high";
      else if (minStock > 0 && stock <= minStock) urgency = "medium";
    }

    lines.push({
      productId: String(product._id),
      product: product.name,
      currentStock: round1(stock),
      soldLast30Days: round1(sold),
      avgDailySales: round1(avgDailySales),
      daysUntilStockout: daysOfStock === null ? null : Math.floor(daysOfStock),
      recommendedQty,
      unitCost: Number(product.costPrice) || 0,
      estimatedCost: Math.round(recommendedQty * (Number(product.costPrice) || 0)),
      urgency,
      lowAndNotSelling: avgDailySales === 0 && minStock > 0 && stock <= minStock,
    });
  }

  const bySoonestOut = (a, b) => (a.daysUntilStockout ?? 0) - (b.daysUntilStockout ?? 0) || b.avgDailySales - a.avgDailySales;
  const urgentRestock = lines
    .filter((line) => (line.urgency === "critical" || line.urgency === "high") && line.recommendedQty > 0)
    .sort(bySoonestOut)
    .slice(0, LIST_LIMIT)
    .map(({ lowAndNotSelling, ...line }) => line);
  const routineRestock = lines
    .filter((line) => line.urgency === "medium" && line.recommendedQty > 0)
    .sort(bySoonestOut)
    .slice(0, LIST_LIMIT)
    .map(({ lowAndNotSelling, urgency, ...line }) => ({
      ...line,
      reason: `At or below its minimum of stock, selling about ${line.avgDailySales} a day`,
    }));
  const doNotRestock = lines
    .filter((line) => line.lowAndNotSelling)
    .slice(0, 15)
    .map((line) => ({
      productId: line.productId,
      product: line.product,
      currentStock: line.currentStock,
      reason: `Low on stock but nothing sold in ${SALES_WINDOW_DAYS} days — order only if it is seasonal or on request`,
    }));

  const totalEstimatedCost = [...urgentRestock, ...routineRestock].reduce((sum, line) => sum + line.estimatedCost, 0);
  const hasCritical = urgentRestock.some((line) => line.urgency === "critical");
  const priority = hasCritical ? "critical" : urgentRestock.length > 0 ? "high" : routineRestock.length > 0 ? "medium" : "low";

  return {
    urgentRestock,
    routineRestock,
    doNotRestock,
    totalEstimatedCost,
    recommendedOrderDate: hasCritical ? "ASAP" : urgentRestock.length > 0 ? "This week" : "Next week",
    priority,
    assumptions: { salesWindowDays: SALES_WINDOW_DAYS, leadDays: LEAD_DAYS, safetyDays: SAFETY_DAYS, coverDays: COVER_DAYS },
  };
}

/** A plain summary of the plan, for when no AI can write one. */
function planSummary(plan) {
  const critical = plan.urgentRestock.filter((line) => line.urgency === "critical");
  if (plan.urgentRestock.length === 0 && plan.routineRestock.length === 0) {
    return "No product is close to running out at its current rate of sale.";
  }
  const parts = [];
  if (critical.length) parts.push(`${critical.length} product${critical.length === 1 ? " is" : "s are"} out of stock or will be within ${SAFETY_DAYS} days (${critical.slice(0, 3).map((l) => l.product).join(", ")})`);
  const high = plan.urgentRestock.length - critical.length;
  if (high) parts.push(`${high} more will run out before a new delivery arrives`);
  if (plan.routineRestock.length) parts.push(`${plan.routineRestock.length} are at their minimum stock`);
  return `${parts.join("; ")}. Ordering all of it comes to about ₦${Math.round(plan.totalEstimatedCost).toLocaleString("en-NG")}.`;
}

const RESTOCK_PROMPT = `You are a supply chain analyst for a Nigerian retail business.
Below is a restock plan already worked out from each product's sales over the last 30 days,
with lead time, safety stock and order quantities calculated. Do not change any number.

Write:
- "summary": 2-3 sentences for the owner: what is urgent, roughly what it costs (₦), what to do first
- "notes": up to 6 short notes on specific products worth a second look (e.g. a fast seller with
  no stock, an order that ties up a lot of cash, a low item that is not selling)
- "confidence": 0-100, how much the plan can be relied on given the data (few sales = lower)

Respond with JSON only: {"summary": "...", "notes": [{"product": "name", "note": "..."}], "confidence": 0}

RESTOCK PLAN:
`;

/**
 * Generate restock recommendations
 * @param {Object} [options]
 * @param {boolean} [options.forceRegenerate]
 * @returns {Promise<Object>}
 */
export async function generateRestockRecommendations(options = {}) {
  const plan = await buildRestockPlan();
  // Only what the AI needs to read, and what decides whether the stored plan is out of date
  const metrics = {
    urgentRestock: plan.urgentRestock.map(({ productId, ...line }) => line),
    routineRestock: plan.routineRestock.map(({ productId, ...line }) => line),
    doNotRestock: plan.doNotRestock.map(({ productId, ...line }) => line),
    totalEstimatedCost: plan.totalEstimatedCost,
    assumptions: plan.assumptions,
  };

  return executeRecommendationPipeline({
    recommendationType: "restock",
    entityType: "global",
    entityName: "Restock Plan",
    metrics,
    generateAI: async (m) => {
      const startTime = Date.now();
      // Nothing to explain: no AI call needed
      if (m.urgentRestock.length === 0 && m.routineRestock.length === 0) {
        return { success: true, data: { summary: planSummary(plan), notes: [], confidence: 90 }, meta: { provider: "", model: "calculated", executionTimeMs: 0 } };
      }
      const result = await generateAIText(RESTOCK_PROMPT + JSON.stringify(m, null, 2), { json: true });
      if (result.success) return { success: true, data: result.data, meta: result.meta };
      // The plan is sound without the AI's words: keep it, and say why there is no commentary
      return {
        success: true,
        data: { summary: planSummary(plan), notes: [], confidence: 70, aiUnavailable: result.error },
        meta: { ...result.meta, model: "calculated", executionTimeMs: Date.now() - startTime },
      };
    },
    formatResult: (aiData) => {
      const data = {
        ...plan,
        summary: aiData.summary || planSummary(plan),
        notes: Array.isArray(aiData.notes) ? aiData.notes : [],
        ...(aiData.aiUnavailable ? { aiUnavailable: aiData.aiUnavailable } : {}),
      };
      return {
        recommendation: data.summary,
        reason: `${plan.urgentRestock.length} urgent, ${plan.routineRestock.length} routine · about ₦${Math.round(plan.totalEstimatedCost).toLocaleString("en-NG")}`,
        priority: plan.priority,
        confidence: Number(aiData.confidence) || 0,
        estimatedBenefit: plan.totalEstimatedCost,
        riskLevel: plan.urgentRestock.some((line) => line.urgency === "critical") ? "high" : plan.urgentRestock.length > 0 ? "medium" : "low",
        category: "restock",
        data,
      };
    },
    forceRegenerate: options.forceRegenerate,
  });
}
