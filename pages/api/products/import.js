/**
 * API: POST /api/products/import
 * Seeds products from parsed spreadsheet rows.
 *
 * Body: { products: rawRows[], location, dryRun, updateExistingQty, fixBarcodes }
 *   dryRun=true  → returns the plan (what would be created/updated) without saving anything
 *   dryRun=false → applies the plan
 *
 * - New products are created in `location` (categories auto-created) with 7.5% VAT.
 * - `applyVatToAll` (on by default) also puts existing products in the file on 7.5% VAT, so a
 *   product seeded before the rate was applied stops being the odd one out.
 * - `linkChildCost` (on by default) works a child's cost out from its mother's cost and pack
 *   size instead of the file's Cost cell, and marks it to follow the pack from then on.
 * - `skipUnchangedCost` leaves an existing product untouched when its Cost already matches the
 *   file, so re-importing a price list only writes the products whose cost actually moved.
 * - Existing products (matched by name, then barcode) only get cost & sale price updates;
 *   stock qty is updated only when `updateExistingQty` is true. Other details stay the same.
 * - Seeding stock qty needs product or stock-management access (lib/permission-utils.js), not admin.
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
import { canManageProducts } from "@/lib/permission-utils";
import { normalizeImportRow } from "@/lib/productImport";
import { buildImportPlan, nameKey } from "@/lib/productImportPlan";
import { deriveChildrenForParent } from "@/lib/syncPackQty";
import { syncChildCostsForParent } from "@/lib/childPricing";

const MAX_ROWS = 5000;
const PLAN_PRODUCT_FIELDS =
  "name barcode costPrice salePriceIncTax taxRate quantity packType qtyPerPack isChildProduct parentProduct unitsPerChild costFromParent isArchived isStockManaged";

/**
 * Turn a database write error into something the person holding the spreadsheet can act on.
 * Raw driver text ("E11000 duplicate key error collection: ... index: barcode_1 dup key ...")
 * tells them nothing about which cell to change.
 */
function explainWriteError(message) {
  const text = String(message || "").trim();
  if (!text) return "Could not be saved";

  if (text.includes("E11000") || text.toLowerCase().includes("duplicate key")) {
    const field = text.match(/index:\s*([A-Za-z0-9_]+?)_/)?.[1];
    const value = text.match(/dup key:\s*\{[^:]*:\s*"?([^",}]+)"?/)?.[1];
    const where = field ? `${field}` : "value";
    return value
      ? `Another product already uses that ${where} ("${value.trim()}") — change it in the file`
      : `Another product already uses that ${where} — change it in the file`;
  }

  if (text.toLowerCase().includes("validation failed")) {
    // Mongoose writes "<Model> validation failed: <field>: <reason>". Everything after the first
    // colon names the column at fault, which is the part worth showing.
    const detail = text.split(":").slice(1).join(":").trim();
    return detail ? `Rejected by the product rules: ${detail}` : "Rejected by the product rules";
  }

  if (text.toLowerCase().includes("cast to")) {
    return `A value in this row is the wrong type: ${text}`;
  }

  return text;
}

/** Index the per-document failures a bulk write reports, keyed by position in the batch. */
function collectWriteErrors(err) {
  const byIndex = new Map();
  if (!err) return byIndex;

  const list = err.writeErrors || err.result?.result?.writeErrors || [];
  for (const writeError of Array.isArray(list) ? list : [list]) {
    const index = writeError?.index ?? writeError?.err?.index;
    const message = writeError?.errmsg || writeError?.err?.errmsg || writeError?.message;
    if (typeof index === "number") byIndex.set(index, explainWriteError(message));
  }

  // A single-document failure is reported without a writeErrors array
  if (byIndex.size === 0 && err.message) byIndex.set(-1, explainWriteError(err.message));
  return byIndex;
}

/**
 * The row's cleaned cell values, in the template's column order. Sent back only for rows that
 * did not go through, so the operator can download just those, fix them and re-import — without
 * hunting for them in the original file.
 */
function sourceCells(row) {
  return {
    name: row.name || "",
    description: row.description || "",
    costPrice: row.costPrice ?? "",
    salePriceIncTax: row.salePriceIncTax ?? "",
    barcode: (row.barcodes || []).join(", "),
    category: row.category || "",
    quantity: row.quantity ?? "",
    packQty: row.demotePack ? "none" : row.packQty ?? "",
    parent: row.unlinkParent ? "none" : row.parentRef || "",
    unitsPerChild: row.unitsPerChild ?? "",
  };
}

function formatEntry(entry, result) {
  const action = result || entry.action;
  const didNotApply = action === "error" || action === "failed";
  return {
    rowNumber: entry.rowNumber,
    name: entry.name || "(no name)",
    action,
    matchedBy: entry.matchedBy,
    existingName: entry.product && entry.product.name !== entry.name ? entry.product.name : undefined,
    archived: Boolean(entry.product?.isArchived),
    changes: entry.changes,
    warnings: entry.warnings,
    error: entry.error,
    qtyNotApplied: Boolean(entry.qtyNotApplied),
    zeroSalePrice: Boolean(entry.zeroSalePrice),
    source: didNotApply ? sourceCells(entry.row) : undefined,
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

  const {
    products,
    location,
    dryRun = false,
    updateExistingQty = false,
    fixBarcodes = true,
    linkChildCost = true,
    applyVatToAll = true,
    skipUnchangedCost = false,
  } = req.body || {};

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: "No products provided" });
  }

  if (products.length > MAX_ROWS) {
    return res.status(400).json({ error: `Maximum ${MAX_ROWS} products per import` });
  }

  try {
    const rows = products.map((raw, index) => normalizeImportRow(raw, index));
    const existingProducts = await Product.find({}).select(PLAN_PRODUCT_FIELDS).lean();
    // Whoever may edit products or stock levels may also seed stock quantities from the file
    const canSeedQty = canManageProducts(req.user);

    const plan = buildImportPlan({
      rows,
      existingProducts,
      options: {
        canSeedQty,
        updateExistingQty: Boolean(updateExistingQty),
        fixBarcodes: fixBarcodes !== false,
        linkChildCost: linkChildCost !== false,
        applyVatToAll: applyVatToAll !== false,
        skipUnchangedCost: Boolean(skipUnchangedCost),
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

    // Keep each document's position so a write error can be traced back to its row
    const entryByDocIndex = new Map(creates.map((entry, index) => [index, entry]));
    let insertErrorsByIndex = new Map();

    if (newDocs.length > 0) {
      await Product.insertMany(newDocs, { ordered: false }).catch((err) => {
        console.error("Product import insert error:", err.message);
        insertErrorsByIndex = collectWriteErrors(err);
      });
    }
    const insertedIds = new Set(
      newDocs.length > 0
        ? (await Product.find({ _id: { $in: newDocs.map((d) => d._id) } }).select("_id").lean()).map((d) => String(d._id))
        : []
    );
    const failedCreates = new Set(creates.filter((entry) => !insertedIds.has(String(entry.newId))));

    // Attach the reason to each row that did not save, so the preview table can say why instead
    // of showing a bare "Failed" badge.
    const sharedInsertError = insertErrorsByIndex.get(-1);
    for (const [index, entry] of entryByDocIndex) {
      if (!failedCreates.has(entry)) continue;
      entry.error =
        insertErrorsByIndex.get(index) ||
        sharedInsertError ||
        "Could not be saved — check this row for a duplicate name or barcode";
    }

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
    const entryByOpIndex = new Map();
    for (const entry of updates) {
      const set = { ...entry.set };
      if (entry.linkToParent) {
        if (entry.parent?.entry && failedCreates.has(entry.parent.entry)) {
          skippedUpdates.add(entry);
          entry.error = `Its parent "${entry.parent.entry.name}" (row ${entry.parent.entry.rowNumber}) could not be saved`;
          continue;
        }
        set.parentProduct = parentIdFor(entry);
      }
      const update = { $set: set };
      if (entry.unset) update.$unset = entry.unset;
      entryByOpIndex.set(updateOps.length, entry);
      updateOps.push({ updateOne: { filter: { _id: entry.product._id }, update } });
    }
    if (updateOps.length > 0) {
      // An unhandled failure here used to reject the whole request with a 500, losing the report
      // for every row that did save. Failures are now attributed to their own rows.
      await Product.bulkWrite(updateOps, { ordered: false }).catch((err) => {
        console.error("Product import update error:", err.message);
        const errorsByIndex = collectWriteErrors(err);
        const shared = errorsByIndex.get(-1);
        for (const [index, entry] of entryByOpIndex) {
          const reason = errorsByIndex.get(index) || (errorsByIndex.size === 1 && shared ? shared : null);
          if (!reason) continue;
          entry.error = reason;
          skippedUpdates.add(entry);
        }
      });
    }

    // 4. Detach the children of any pack that is no longer a pack (before deriving, so they are
    //    out of the way). Their stock stayed with the pack, so they start at none of their own.
    const childIdsToDetach = updates
      .filter((entry) => !skippedUpdates.has(entry))
      .flatMap((entry) => entry.unlinkChildIds || []);
    if (childIdsToDetach.length > 0) {
      await Product.updateMany(
        { _id: { $in: childIdsToDetach.map((id) => new mongoose.Types.ObjectId(id)) } },
        { $set: { isChildProduct: false, unitsPerChild: 1, quantity: 0 }, $unset: { parentProduct: "" } }
      );
    }

    // 5. Every pack touched by this import pushes its stock back down to its children — including
    //    the pack a product was moved away from, so both sides end up correct.
    const parentIds = new Set();
    for (const entry of [...creates, ...updates]) {
      if (failedCreates.has(entry) || skippedUpdates.has(entry)) continue;
      if (entry.parent) parentIds.add(String(parentIdFor(entry)));
      if (entry.product?.parentProduct) parentIds.add(String(entry.product.parentProduct));
      const packType = entry.doc?.packType || entry.set?.packType || entry.product?.packType;
      if (packType === "pack") parentIds.add(String(productIdFor(entry)));
    }
    for (const parentId of parentIds) {
      await deriveChildrenForParent(parentId);
    }

    // 6. Re-price every child that follows its pack. This covers children created here and any
    //    child already in the system whose pack's cost the file has just changed, so raising a
    //    carton's cost carries down to the singles without a second import.
    let childCostsSynced = 0;
    for (const parentId of parentIds) {
      try {
        childCostsSynced += await syncChildCostsForParent(parentId);
      } catch (syncErr) {
        console.warn(`Child cost sync failed for ${parentId}:`, syncErr.message);
      }
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
        childCostsSynced,
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
