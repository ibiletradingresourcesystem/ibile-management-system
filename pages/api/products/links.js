/**
 * API: /api/products/links
 * Links existing products together as a mother (pack) product and its children,
 * without creating new products. A pack can have many children, e.g.
 *   pack of 24 → unit of 6, unit of 2, unit of 1
 * Children never hold stock: child.qty = parent.qty × parent.qtyPerPack ÷ child.unitsPerChild.
 *
 * GET    ?productId=                                            → { product, parent, children }
 * POST   { parentId, childId, unitsPerChild, moveStockToParent, costFromParent } → link a child
 * PATCH  { childId, unitsPerChild }                              → change units in a child
 * DELETE ?childId=                                               → unlink a child (it starts at 0 stock)
 */
import { mongooseConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { deriveChildrenForParent } from "@/lib/syncPackQty";
import { syncChildCostsForParent } from "@/lib/childPricing";
import {
  childQtyToParentQty,
  deriveChildQuantity,
  getPackSize,
  isDerivedChild,
} from "@/lib/packUnits";

const CHILD_FILTER = { isChildProduct: true, packType: { $ne: "pack" } };
const SUMMARY_FIELDS =
  "name barcode quantity costPrice salePriceIncTax taxRate packType qtyPerPack isChildProduct parentProduct unitsPerChild costFromParent isStockManaged isArchived";

function isObjectId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || ""));
}

function parseUnits(value) {
  const units = Number(value);
  return Number.isInteger(units) && units >= 1 ? units : null;
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function countActiveChildren(parentId) {
  return Product.countDocuments({ parentProduct: parentId, ...CHILD_FILTER, isArchived: { $ne: true } });
}

/** The product, its parent (when it is a child) and every child of the pack it belongs to. */
async function loadRelations(productId) {
  const product = await Product.findById(productId).select(SUMMARY_FIELDS).lean();
  if (!product) return null;

  const productIsChild = isDerivedChild(product);
  const parent = productIsChild
    ? await Product.findById(product.parentProduct).select(SUMMARY_FIELDS).lean()
    : null;
  const pack = parent || product;

  const children = await Product.find({
    parentProduct: pack._id,
    ...CHILD_FILTER,
    isArchived: { $ne: true },
  })
    .select(SUMMARY_FIELDS)
    .sort({ unitsPerChild: -1, name: 1 })
    .lean();

  const withDerivedQty = (child) => ({
    ...child,
    quantity: deriveChildQuantity(pack.quantity, pack, child),
  });

  return {
    product: productIsChild && parent ? withDerivedQty(product) : product,
    parent,
    children: children.map(withDerivedQty),
  };
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  await mongooseConnect();

  try {
    if (req.method === "GET") {
      const { productId } = req.query;
      if (!isObjectId(productId)) return fail(res, 400, "Valid productId is required");

      const relations = await loadRelations(productId);
      if (!relations) return fail(res, 404, "Product not found");
      return res.json({ success: true, data: relations });
    }

    if (req.method === "POST") {
      const { parentId, childId, unitsPerChild, moveStockToParent, costFromParent } = req.body || {};
      if (!isObjectId(parentId) || !isObjectId(childId)) {
        return fail(res, 400, "Select both a parent and a child product");
      }
      if (String(parentId) === String(childId)) {
        return fail(res, 400, "A product can't be linked to itself");
      }

      const units = parseUnits(unitsPerChild);
      if (!units) return fail(res, 400, "Units per child must be a whole number of 1 or more");

      const [parent, child] = await Promise.all([
        Product.findById(parentId).select(SUMMARY_FIELDS).lean(),
        Product.findById(childId).select(SUMMARY_FIELDS).lean(),
      ]);
      if (!parent || parent.isArchived) return fail(res, 404, "Parent product not found");
      if (!child || child.isArchived) return fail(res, 404, "Child product not found");

      if (isDerivedChild(parent)) {
        return fail(res, 400, `"${parent.name}" is itself a child product, so it can't be a parent`);
      }
      // A pack of 1 is a parent too: a set sold whole or as a part (a dispenser with its
      // bottle, and the dispenser alone), each sale taking 1 off the same stock.
      if (parent.packType !== "pack") {
        return fail(
          res,
          400,
          `Set "${parent.name}" as a Pack (and save) before linking children. Qty Per Pack can be 1 for a set sold whole or as a part`
        );
      }
      if (units > getPackSize(parent)) {
        return fail(res, 400, `Units per child (${units}) can't be more than the pack size (${parent.qtyPerPack})`);
      }

      const childChildren = await countActiveChildren(child._id);
      if (childChildren > 0) {
        return fail(
          res,
          400,
          `"${child.name}" is a parent of ${childChildren} product(s). Unlink its children before making it a child`
        );
      }

      // Stock a product held on its own can be converted into the parent's packs
      const canMoveStock =
        moveStockToParent === true &&
        !isDerivedChild(child) &&
        child.isStockManaged !== false &&
        parent.isStockManaged !== false &&
        Number(child.quantity) > 0;
      const movedPacks = canMoveStock ? childQtyToParentQty(child.quantity, { unitsPerChild: units }, parent) : 0;

      if (movedPacks) {
        await Product.updateOne({ _id: parent._id }, { $inc: { quantity: movedPacks } });
      }

      await Product.updateOne(
        { _id: child._id },
        {
          $set: {
            isChildProduct: true,
            parentProduct: parent._id,
            unitsPerChild: units,
            packType: "unit",
            qtyPerPack: 1,
            costFromParent: costFromParent === undefined ? Boolean(child.costFromParent) : Boolean(costFromParent),
          },
        }
      );
      await deriveChildrenForParent(parent._id);
      await syncChildCostsForParent(parent._id);

      return res.json({
        success: true,
        message: movedPacks
          ? `"${child.name}" linked to "${parent.name}". Moved ${child.quantity} in stock into the pack.`
          : `"${child.name}" linked to "${parent.name}"`,
        movedPacks,
        data: await loadRelations(parent._id),
      });
    }

    if (req.method === "PATCH") {
      const { childId, unitsPerChild } = req.body || {};
      if (!isObjectId(childId)) return fail(res, 400, "Valid childId is required");

      const units = parseUnits(unitsPerChild);
      if (!units) return fail(res, 400, "Units per child must be a whole number of 1 or more");

      const child = await Product.findById(childId).select(SUMMARY_FIELDS).lean();
      if (!child || !isDerivedChild(child)) return fail(res, 404, "Linked child product not found");

      const parent = await Product.findById(child.parentProduct).select(SUMMARY_FIELDS).lean();
      if (!parent) return fail(res, 404, "Parent product not found");
      if (units > getPackSize(parent)) {
        return fail(res, 400, `Units per child (${units}) can't be more than the pack size (${parent.qtyPerPack})`);
      }

      await Product.updateOne({ _id: child._id }, { $set: { unitsPerChild: units } });
      await deriveChildrenForParent(parent._id);
      await syncChildCostsForParent(parent._id);

      return res.json({
        success: true,
        message: `"${child.name}" now holds ${units} unit(s) of the pack`,
        data: await loadRelations(parent._id),
      });
    }

    if (req.method === "DELETE") {
      const { childId } = req.query;
      if (!isObjectId(childId)) return fail(res, 400, "Valid childId is required");

      const child = await Product.findById(childId).select(SUMMARY_FIELDS).lean();
      if (!child || !isDerivedChild(child)) return fail(res, 404, "Linked child product not found");

      // The stock stays with the parent, so the unlinked product starts with none of its own
      await Product.updateOne(
        { _id: child._id },
        { $set: { isChildProduct: false, unitsPerChild: 1, quantity: 0, costFromParent: false }, $unset: { parentProduct: "" } }
      );

      return res.json({
        success: true,
        message: `"${child.name}" unlinked`,
        data: await loadRelations(child.parentProduct),
      });
    }

    return fail(res, 405, `Method ${req.method} not allowed`);
  } catch (error) {
    console.error("Product links API error:", error);
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
}
