/**
 * Parent-child product quantity management for admin app.
 * 
 * RULE: Child qty = parent.qty * qtyPerPack. Always derived, never independent.
 *
 * updateInventoryForSale(items): Smart sale decrement that skips child products.
 * reverseInventoryForRefund(items): Smart refund that skips child restocks.
 * deriveChildQty(productId): Recalculates child qty from parent.
 */

import Product from "@/models/Product";

/**
 * Smart inventory update for a sale.
 * Child products are NEVER decremented directly — their qty is derived from parent.
 */
export async function updateInventoryForSale(items) {
  if (!items || items.length === 0) return;

  const validItems = items.filter(i => i.productId && i.qty);
  if (validItems.length === 0) return;

  const productIds = validItems.map(i => i.productId);
  const soldProducts = await Product.find({ _id: { $in: productIds } })
    .select("_id isChildProduct parentProduct packType qtyPerPack")
    .lean();
  const productMap = new Map(soldProducts.map(p => [String(p._id), p]));

  const directDecrements = [];
  const childToParent = new Map();

  for (const item of validItems) {
    const product = productMap.get(String(item.productId));
    if (product && product.isChildProduct && product.parentProduct && product.packType !== "pack") {
      const parentId = String(product.parentProduct);
      childToParent.set(parentId, (childToParent.get(parentId) || 0) + item.qty);
    } else {
      directDecrements.push(item);
    }
  }

  // Decrement normal/parent products
  for (const item of directDecrements) {
    await Product.findByIdAndUpdate(item.productId, { $inc: { quantity: -item.qty } });
  }

  // Decrement parents for child sales
  for (const [parentId, totalUnits] of childToParent.entries()) {
    const parent = await Product.findById(parentId).select("qtyPerPack").lean();
    if (parent && parent.qtyPerPack > 0) {
      await Product.findByIdAndUpdate(parentId, { $inc: { quantity: -(totalUnits / parent.qtyPerPack) } });
    }
  }

  // Derive child qty for all affected parents
  const allParentIds = new Set([
    ...childToParent.keys(),
    ...directDecrements
      .filter(item => {
        const p = productMap.get(String(item.productId));
        return p && p.packType === "pack" && p.qtyPerPack > 0;
      })
      .map(item => String(item.productId)),
  ]);

  for (const parentId of allParentIds) {
    await deriveChildQty(parentId);
  }
}

/**
 * Reverse inventory for a refund. Child refunds redirect to parent.
 */
export async function reverseInventoryForRefund(items) {
  if (!items || items.length === 0) return;

  const validItems = items.filter(i => i.productId && i.qty);
  if (validItems.length === 0) return;

  const productIds = validItems.map(i => i.productId);
  const products = await Product.find({ _id: { $in: productIds } })
    .select("_id isChildProduct parentProduct packType qtyPerPack")
    .lean();
  const productMap = new Map(products.map(p => [String(p._id), p]));

  const directIncrements = [];
  const childToParent = new Map();

  for (const item of validItems) {
    const product = productMap.get(String(item.productId));
    if (product && product.isChildProduct && product.parentProduct && product.packType !== "pack") {
      const parentId = String(product.parentProduct);
      childToParent.set(parentId, (childToParent.get(parentId) || 0) + Number(item.qty));
    } else {
      directIncrements.push(item);
    }
  }

  for (const item of directIncrements) {
    await Product.findByIdAndUpdate(item.productId, { $inc: { quantity: Number(item.qty) } });
  }

  for (const [parentId, totalUnits] of childToParent.entries()) {
    const parent = await Product.findById(parentId).select("qtyPerPack").lean();
    if (parent && parent.qtyPerPack > 0) {
      await Product.findByIdAndUpdate(parentId, { $inc: { quantity: totalUnits / parent.qtyPerPack } });
    }
  }

  const allParentIds = new Set([
    ...childToParent.keys(),
    ...directIncrements
      .filter(item => {
        const p = productMap.get(String(item.productId));
        return p && p.packType === "pack" && p.qtyPerPack > 0;
      })
      .map(item => String(item.productId)),
  ]);

  for (const parentId of allParentIds) {
    await deriveChildQty(parentId);
  }
}

/**
 * Derive child qty from parent. Works with either parent or child ID.
 */
export async function deriveChildQty(productId) {
  try {
    const product = await Product.findById(productId)
      .select("isChildProduct parentProduct packType qtyPerPack quantity")
      .lean();
    if (!product) return;

    if (product.isChildProduct && product.parentProduct && product.packType !== "pack") {
      const parent = await Product.findById(product.parentProduct)
        .select("quantity qtyPerPack")
        .lean();
      if (parent && parent.qtyPerPack > 0) {
        await Product.findByIdAndUpdate(productId, {
          $set: { quantity: parent.quantity * parent.qtyPerPack },
        });
      }
    } else if (product.packType === "pack" && product.qtyPerPack > 0) {
      const child = await Product.findOne({
        parentProduct: productId,
        isChildProduct: true,
        packType: { $ne: "pack" },
      }).select("_id").lean();
      if (child) {
        await Product.findByIdAndUpdate(child._id, {
          $set: { quantity: product.quantity * product.qtyPerPack },
        });
      }
    }
  } catch (err) {
    console.warn("deriveChildQty error:", err.message);
  }
}
