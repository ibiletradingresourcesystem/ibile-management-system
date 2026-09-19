/**
 * A child product's cost price, worked out from the pack it belongs to.
 *
 * A pack of 24 costing ₦6,000 makes each base unit ₦250, so a child holding 6 of them costs
 * ₦1,500. A child can either hold its own cost — bought separately, or priced by hand — or follow
 * the pack, which is what `costFromParent` on the product chooses between.
 */
import Product from "@/models/Product";
import { getPackSize, getUnitsPerChild, isDerivedChild } from "@/lib/packUnits";
import { calculateMarginPercent, normalizeTaxRate, roundMoney } from "@/lib/pricing";

const CHILD_FILTER = { isChildProduct: true, packType: { $ne: "pack" } };
const PRICING_FIELDS = "costPrice salePriceIncTax taxRate unitsPerChild costFromParent quantity";

/** @returns {number} the child's share of the pack's cost */
export function deriveChildCostPrice(parent, child) {
  const packCost = Number(parent?.costPrice) || 0;
  return roundMoney((packCost / getPackSize(parent)) * getUnitsPerChild(child));
}

/** The cost, and the margin that follows from it, for a child that tracks its parent. */
export function buildChildCostUpdate(parent, child) {
  const costPrice = deriveChildCostPrice(parent, child);
  const taxRate = normalizeTaxRate(child?.taxRate);
  return {
    costPrice,
    margin: roundMoney(calculateMarginPercent(costPrice, child?.salePriceIncTax)),
    taxRate,
  };
}

/**
 * Re-prices every child of a pack that follows its cost. Called after the pack's cost or pack
 * size changes, and after a child is linked or its units change.
 * @returns {Promise<number>} how many children were re-priced
 */
export async function syncChildCostsForParent(parentId) {
  if (!parentId) return 0;

  const [parent, children] = await Promise.all([
    Product.findById(parentId).select("costPrice qtyPerPack").lean(),
    Product.find({ parentProduct: parentId, ...CHILD_FILTER, costFromParent: true })
      .select(PRICING_FIELDS)
      .lean(),
  ]);
  if (!parent || children.length === 0) return 0;

  const ops = children
    .map((child) => ({ child, update: buildChildCostUpdate(parent, child) }))
    .filter(({ child, update }) => Math.abs((Number(child.costPrice) || 0) - update.costPrice) > 0.005)
    .map(({ child, update }) => ({ updateOne: { filter: { _id: child._id }, update: { $set: update } } }));

  if (ops.length > 0) await Product.bulkWrite(ops);
  return ops.length;
}

/** The cost a single child should carry right now, or null when it holds its own cost. */
export async function resolveChildCost(child) {
  if (!child?.costFromParent || !isDerivedChild(child)) return null;

  const parent = await Product.findById(child.parentProduct).select("costPrice qtyPerPack").lean();
  if (!parent) return null;

  return buildChildCostUpdate(parent, child);
}
