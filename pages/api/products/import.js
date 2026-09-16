/**
 * API: POST /api/products/import
 * Seeds products from parsed spreadsheet rows.
 *
 * Body: { products: rawRows[], location, dryRun, updateExistingQty, fixBarcodes }
 *   dryRun=true  → returns the plan (what would be created/updated) without saving anything
 *   dryRun=false → applies the plan
 *
 * - New products are created in `location` (categories auto-created) with 7.5% VAT.
 * - Existing products (matched by name, then barcode) only get cost & sale price updates;
 *   stock qty is updated only when `updateExistingQty` is true. Other details stay the same.
 * - `fixBarcodes` (on by default) repairs barcodes a spreadsheet broke apart on products that
 *   were already seeded, and merges in the codes from the file. No barcode is ever removed.
 * - "Pack Qty" / "Parent" / "Units" columns set up mother (pack) and child products.
 *   Children have no stock of their own — it is derived from the parent after the import.
 */
import mongoose from "mongoose";
import { mongooseConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { Category } from "@/models/Category";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { normalizeImportRow } from "@/lib/productImport";
import { buildImportPlan, nameKey } from "@/lib/productImportPlan";
import { deriveChildrenForParent } from "@/lib/syncPackQty";

const MAX_ROWS = 5000;
const PLAN_PRODUCT_FIELDS =
  "name barcode costPrice salePriceIncTax taxRate quantity packType qtyPerPack isChildProduct parentProduct unitsPerChild isArchived isStockManaged";

function formatEntry(entry, result) {
  return {
    rowNumber: entry.rowNumber,
    name: entry.name || "(no name)",
    action: result || entry.action,
    matchedBy: entry.matchedBy,
    existingName: entry.product && entry.product.name !== entry.name ? entry.product.name : undefined,
    archived: Boolean(entry.product?.isArchived),
    changes: entry.changes,
    warnings: entry.warnings,
    error: entry.error,
    qtyNotApplied: Boolean(entry.qtyNotApplied),
  };
}

async function resolveCategoryIds(names, location, dryRun) {
  const categories = await Category.find({}).select("name").lean();
  const idByName = new Map(categories.map((c) => [nameKey(c.name), String(c._id)]));
  const missing = [...new Set(names.filter((name) => name && !idByName.has(nameKey(name))))];

  if (!dryRun && missing.length > 0) {
    const created = await Category.insertMany(
      missing.map((name) => ({ name, locations: location ? [location] : [], isStockManaged: true })),
      { ordered: false }
    ).catch((err) => err.insertedDocs || []);
    (Array.isArray(created) ? created : []).forEach((c) => idByName.set(nameKey(c.name), String(c._id)));
  }

  return { idByName, missing };
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  const { products, location, dryRun = false, updateExistingQty = false, fixBarcodes = true } = req.body || {};

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: "No products provided" });
  }

  if (products.length > MAX_ROWS) {
    return res.status(400).json({ error: `Maximum ${MAX_ROWS} products per import` });
  }

  try {
    const rows = products.map((raw, index) => normalizeImportRow(raw, index));
    const existingProducts = await Product.find({}).select(PLAN_PRODUCT_FIELDS).lean();
    const canSeedQty = req.user?.role === "admin";

    const plan = buildImportPlan({
      rows,
      existingProducts,
      options: {
        canSeedQty,
        updateExistingQty: Boolean(updateExistingQty),
        fixBarcodes: fixBarcodes !== false,
      },
    });

    const { missing: categoriesToCreate } = await resolveCategoryIds(plan.categoriesToCreate, location, true);

    if (dryRun) {
      return res.status(200).json({
        success: true,
        dryRun: true,
        canSeedQty,
        summary: { ...plan.summary, categoriesToCreate: categoriesToCreate.length },
        categoriesToCreate,
        rows: plan.entries.map((entry) => formatEntry(entry)),
      });
    }

    const creates = plan.entries.filter((entry) => entry.action === "create");
    const updates = plan.entries.filter((entry) => entry.action === "update");

    if (creates.length > 0 && !location) {
      return res.status(400).json({ error: "Select a location for the new products" });
    }

    // 1. Categories for new products
    const { idByName } = await resolveCategoryIds(plan.categoriesToCreate, location, false);

    // 2. Ids up front so children can point at parents created in this same import
    creates.forEach((entry) => {
      entry.newId = new mongoose.Types.ObjectId();
    });
    const productIdFor = (entry) => entry.product?._id || entry.newId;
    const parentIdFor = (entry) =>
      entry.parent?.product ? entry.parent.product._id : entry.parent?.entry ? productIdFor(entry.parent.entry) : null;

    const newDocs = creates.map((entry) => {
      const { categoryName, isChildProduct, ...doc } = entry.doc;
      return {
        ...doc,
        _id: entry.newId,
        category: idByName.get(nameKey(categoryName)) || "Top Level",
        locations: location ? [location] : [],
        showOnWeb: true,
        isStockManaged: true,
        isArchived: false,
        ...(isChildProduct ? { isChildProduct: true, parentProduct: parentIdFor(entry) } : {}),
      };
    });

    if (newDocs.length > 0) {
      await Product.insertMany(newDocs, { ordered: false }).catch((err) => {
        console.error("Product import insert error:", err.message);
      });
    }
    const insertedIds = new Set(
      newDocs.length > 0
        ? (await Product.find({ _id: { $in: newDocs.map((d) => d._id) } }).select("_id").lean()).map((d) => String(d._id))
        : []
    );
    const failedCreates = new Set(creates.filter((entry) => !insertedIds.has(String(entry.newId))));

    // New children whose new parent failed to save must not point at a missing product
    const orphanedChildren = creates.filter(
      (entry) => !failedCreates.has(entry) && entry.parent?.entry && failedCreates.has(entry.parent.entry)
    );
    if (orphanedChildren.length > 0) {
      await Product.updateMany(
        { _id: { $in: orphanedChildren.map((entry) => entry.newId) } },
        { $set: { isChildProduct: false, unitsPerChild: 1 }, $unset: { parentProduct: "" } }
      );
      orphanedChildren.forEach((entry) => {
        entry.warnings.push("Its parent failed to save, so it was created without a parent link");
        entry.parent = null;
      });
    }

    // 3. Updates to existing products (skip child links whose new parent failed to save)
    const skippedUpdates = new Set();
    const updateOps = [];
    for (const entry of updates) {
      const set = { ...entry.set };
      if (entry.linkToParent) {
        if (entry.parent?.entry && failedCreates.has(entry.parent.entry)) {
          skippedUpdates.add(entry);
          continue;
        }
        set.parentProduct = parentIdFor(entry);
      }
      updateOps.push({ updateOne: { filter: { _id: entry.product._id }, update: { $set: set } } });
    }
    if (updateOps.length > 0) {
      await Product.bulkWrite(updateOps, { ordered: false });
    }

    // 4. Children take their stock from the parent
    const parentIds = new Set();
    for (const entry of [...creates, ...updates]) {
      if (failedCreates.has(entry) || skippedUpdates.has(entry)) continue;
      if (entry.parent) parentIds.add(String(parentIdFor(entry)));
      const packType = entry.doc?.packType || entry.set?.packType || entry.product?.packType;
      if (packType === "pack") parentIds.add(String(productIdFor(entry)));
    }
    for (const parentId of parentIds) {
      await deriveChildrenForParent(parentId);
    }

    const resultFor = (entry) => {
      if (failedCreates.has(entry)) return "failed";
      if (skippedUpdates.has(entry)) return "failed";
      return entry.action;
    };

    return res.status(200).json({
      success: true,
      dryRun: false,
      canSeedQty,
      summary: {
        ...plan.summary,
        create: creates.length - failedCreates.size,
        update: updates.length - skippedUpdates.size,
        failed: failedCreates.size + skippedUpdates.size,
        categoriesCreated: categoriesToCreate.length,
      },
      rows: plan.entries.map((entry) => formatEntry(entry, resultFor(entry))),
    });
  } catch (err) {
    console.error("Product import error:", err.message);
    return res.status(500).json({ error: err.message || "Import failed" });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "10mb" } },
  maxDuration: 60,
};
