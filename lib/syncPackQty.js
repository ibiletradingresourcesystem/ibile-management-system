/**
 * Parent-child product quantity management for admin app.
 *
 * RULE: A child never holds stock of its own. A parent can have many children, and each
 * child's qty is derived from the parent: child.qty = parent.qty × qtyPerPack ÷ unitsPerChild.
 *
 * updateInventoryForSale(items): Smart sale decrement that redirects child sales to the parent.
 * reverseInventoryForRefund(items): Smart refund that redirects child restocks to the parent.
 * deriveChildQty(productId): Recalculates children qty from the parent (parent or child ID).
 * deriveChildrenForParent(parentId): Recalculates qty for every child of a parent.
 */

import Product from "@/models/Product";
import { childQtyToParentQty, deriveChildQuantity, isDerivedChild } from "@/lib/packUnits";

const CHILD_FILTER = { isChildProduct: true, packType: { $ne: "pack" } };

async function applyInventoryChange(items, sign) {
  if (!items || items.length === 0) return;

  const validItems = items.filter(i => i.productId && Number(i.qty));
  if (validItems.length === 0) return;

  const productIds = validItems.map(i => i.productId);
  const products = await Product.find({ _id: { $in: productIds } })
    .select("_id isChildProduct parentProduct packType qtyPerPack unitsPerChild")
    .lean();
  const productMap = new Map(products.map(p => [String(p._id), p]));

  const directChanges = [];
  const childItemsByParent = new Map(); // parentId -> [{ child, qty }]

  for (const item of validItems) {
    const product = productMap.get(String(item.productId));
    if (isDerivedChild(product)) {
      const parentId = String(product.parentProduct);
      const childItems = childItemsByParent.get(parentId) || [];
      childItems.push({ child: product, qty: Number(item.qty) });
      childItemsByParent.set(parentId, childItems);
    } else {
      directChanges.push({ productId: item.productId, qty: Number(item.qty) });
    }
  }

  // Normal/parent products change directly
  for (const { productId, qty } of directChanges) {
    await Product.findByIdAndUpdate(productId, { $inc: { quantity: sign * qty } });
  }

  // Child items change the parent by their share of a pack
  if (childItemsByParent.size > 0) {
    const parents = await Product.find({ _id: { $in: [...childItemsByParent.keys()] } })
      .select("_id qtyPerPack")
      .lean();
    for (const parent of parents) {
      const packs = childItemsByParent
        .get(String(parent._id))
        .reduce((sum, { child, qty }) => sum + childQtyToParentQty(qty, child, parent), 0);
      if (packs) {
        await Product.findByIdAndUpdate(parent._id, { $inc: { quantity: sign * packs } });
      }
    }
  }

  const affectedParentIds = new Set(childItemsByParent.keys());
  for (const { productId } of directChanges) {
    if (productMap.get(String(productId))?.packType === "pack") {
      affectedParentIds.add(String(productId));
    }
  }

  for (const parentId of affectedParentIds) {
    await deriveChildrenForParent(parentId);
  }
}

/**
 * Smart inventory update for a sale.
 * Child products are NEVER decremented directly — their qty is derived from parent.
 */
export async function updateInventoryForSale(items) {
  await applyInventoryChange(items, -1);
}

/**
 * Reverse inventory for a refund. Child refunds redirect to parent.
 */
export async function reverseInventoryForRefund(items) {
  await applyInventoryChange(items, 1);
}

/**
 * Set every child's qty from its parent's current stock.
 */
export async function deriveChildrenForParent(parentId) {
  const [parent, children] = await Promise.all([
    Product.findById(parentId).select("_id quantity qtyPerPack").lean(),
    Product.find({ parentProduct: parentId, ...CHILD_FILTER }).select("_id quantity unitsPerChild").lean(),
  ]);
  if (!parent || children.length === 0) return;

  const bulkOps = children
    .map((child) => ({ child, quantity: deriveChildQuantity(parent.quantity, parent, child) }))
    .filter(({ child, quantity }) => child.quantity !== quantity)
    .map(({ child, quantity }) => ({
      updateOne: { filter: { _id: child._id }, update: { $set: { quantity } } },
    }));

  if (bulkOps.length > 0) {
    await Product.bulkWrite(bulkOps);
  }
}

/**
 * Derive child qty from parent. Works with either parent or child ID.
 */
export async function deriveChildQty(productId) {
  try {
    const product = await Product.findById(productId)
      .select("_id isChildProduct parentProduct packType")
      .lean();
    if (!product) return;

    if (isDerivedChild(product)) {
      await deriveChildrenForParent(product.parentProduct);
    } else if (product.packType === "pack") {
      await deriveChildrenForParent(product._id);
    }
  } catch (err) {
    console.warn("deriveChildQty error:", err.message);
  }
}
