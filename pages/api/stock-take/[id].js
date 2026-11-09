// pages/api/stock-take/[id].js
import { mongooseConnect } from "@/lib/mongodb";
import StockTake from "@/models/StockTake";
import Product from "@/models/Product";
import Category from "@/models/Category";
import Vendor from "@/models/Vendor";
import { deriveChildQty } from "@/lib/syncPackQty";
import { authMiddleware, isAdmin, isBasicStaff, isStaff } from "@/lib/auth-middleware";
import mongoose, { isValidObjectId } from "mongoose";
import { completePartiallyCountedPackGroups, markItemCounted, recalcSummary } from "@/lib/stockTakeCounts";
import { postStockTakeEntry } from "@/lib/accounting";

const STOCK_TAKE_PRODUCT_SELECT = "name barcode category quantity costPrice packType qtyPerPack isChildProduct parentProduct vendors locations";

function getProductFilter({ vendorIds = [], categoryIds = [], shelfLines = [], productIds = [] } = {}) {
  const filter = { isArchived: { $ne: true }, isStockManaged: true };

  if (Array.isArray(productIds) && productIds.length > 0) {
    filter._id = { $in: productIds };
  }

  if (Array.isArray(vendorIds) && vendorIds.length > 0) {
    filter.vendors = { $in: vendorIds };
  }

  if (Array.isArray(categoryIds) && categoryIds.length > 0) {
    filter.category = { $in: categoryIds };
  }

  if (Array.isArray(shelfLines) && shelfLines.length > 0) {
    filter.locations = { $in: shelfLines };
  }

  return filter;
}

const OPEN_STATUSES = ["draft", "in-progress"];
// Once counting is finished, only an admin may still change the counts. Cancelled stays closed.
const ADMIN_EDITABLE_STATUSES = ["completed", "approved"];

function canEditCounts(req, stockTake) {
  if (OPEN_STATUSES.includes(stockTake.status)) return true;
  return isAdmin(req) && ADMIN_EDITABLE_STATUSES.includes(stockTake.status);
}

function rejectLockedEdit(res, req, stockTake) {
  if (stockTake.status === "cancelled") {
    return res.status(400).json({ success: false, message: "This stock take was cancelled and can no longer be changed" });
  }
  return res.status(403).json({
    success: false,
    message: `This stock take is ${stockTake.status} — only an admin can change it now`,
  });
}

const roundQty = (value) => Math.round(value * 1e6) / 1e6;

/**
 * What the counts change each product's stock by: the count (full packs plus loose units) against
 * what the system held when the line was counted. Stock moves by that difference, not to the
 * count, so anything sold or received after the shelf was counted stays counted.
 * With productIds, only those products.
 */
function stockChangesFromCounts(stockTake, productIds = null) {
  const only = productIds ? new Set([...productIds].map(String)) : null;
  const productQtyMap = new Map();

  for (const item of stockTake.items || []) {
    const productId = String(item.productId);
    if (only && !only.has(productId)) continue;
    if (!productQtyMap.has(productId)) {
      productQtyMap.set(productId, { packs: null, looseUnits: 0, looseUnitsCounted: false, qtyPerPack: 1, systemQty: 0, costPrice: 0 });
    }
    const entry = productQtyMap.get(productId);

    // The loose-units line has no system figure of its own: stock is held in packs
    if (item.countType !== "loose-units") {
      entry.systemQty = item.systemQty || 0;
      entry.costPrice = item.costPrice || 0;
    }

    if (item.status !== "counted" || item.countedQty === null) continue;

    if (item.countType === "loose-units") {
      entry.looseUnits = item.countedQty || 0;
      entry.looseUnitsCounted = true;
      entry.qtyPerPack = item.qtyPerPack || 1;
    } else {
      entry.packs = item.countedQty;
    }
  }

  const changes = [];
  for (const [productId, entry] of productQtyMap) {
    if (!isValidObjectId(productId)) continue;
    if (entry.packs === null && !entry.looseUnitsCounted) continue;
    const counted = (entry.packs ?? 0) + entry.looseUnits / entry.qtyPerPack;
    changes.push({ productId, counted, quantity: roundQty(counted - entry.systemQty), costPrice: entry.costPrice });
  }
  return changes;
}

/**
 * The stock writes for these changes, less whatever this stock take has already applied, and the
 * record of what it will have applied afterwards.
 */
function stockWritesFor(stockTake, changes) {
  const applied = new Map((stockTake.appliedAdjustments || []).map((entry) => [String(entry.productId), entry]));
  // Applied before these records were kept: all that is known is the count, so it is set as it was
  const appliedBeforeRecords = stockTake.adjustmentApplied && applied.size === 0;

  const bulkOps = [];
  for (const { productId, counted, quantity, costPrice } of changes) {
    const difference = roundQty(quantity - (applied.get(productId)?.quantity || 0));
    if (appliedBeforeRecords) {
      bulkOps.push({ updateOne: { filter: { _id: productId }, update: { $set: { quantity: counted } } } });
    } else if (difference !== 0) {
      bulkOps.push({ updateOne: { filter: { _id: productId }, update: { $inc: { quantity: difference } } } });
    }
    if (!appliedBeforeRecords) {
      applied.set(productId, { productId, quantity, value: Math.round(quantity * costPrice * 100) / 100 });
    }
  }

  return { bulkOps, appliedAdjustments: [...applied.values()].filter((entry) => entry.quantity !== 0) };
}

/** Packs' child products take their stock from the pack. Only what actually changed is re-worked. */
async function refreshChildQuantities(bulkOps) {
  for (const { updateOne } of bulkOps) {
    await deriveChildQty(updateOne.filter._id);
  }
}

/**
 * When an admin changes counts on a stock take whose adjustments were already applied, stock
 * follows straight away — otherwise the change (a zeroed count, say) would never reach the shelf.
 * @returns {Promise<string>} text to add to the success message
 */
async function syncAppliedCounts(stockTake, productIds) {
  if (!stockTake.adjustmentApplied) return "";
  const { bulkOps, appliedAdjustments } = stockWritesFor(stockTake, stockChangesFromCounts(stockTake, productIds));
  if (bulkOps.length > 0) {
    await Product.bulkWrite(bulkOps);
    await refreshChildQuantities(bulkOps);
  }
  stockTake.appliedAdjustments = appliedAdjustments;
  stockTake.adjustedAt = new Date();
  return bulkOps.length > 0 ? ` — stock updated for ${bulkOps.length} product(s)` : "";
}

/** The stock take's value in the books. Stock has already moved, so a failure here is only logged. */
async function postAppliedCounts(stockTake) {
  if (!stockTake.adjustmentApplied) return;
  try {
    await postStockTakeEntry(stockTake);
  } catch (acctErr) {
    console.error("Accounting auto-post failed for stock take:", stockTake._id, acctErr.message);
  }
}

function isDerivedChildProduct(product) {
  return Boolean(product?.isChildProduct && product?.packType !== "pack");
}

function buildStockTakeItems(products = []) {
  const items = [];

  for (const product of products) {
    if (!product || isDerivedChildProduct(product)) continue;

    items.push({
      productId: product._id,
      productName: product.name,
      barcode: product.barcode || "",
      category: product.category || "",
      systemQty: product.quantity || 0,
      countedQty: null,
      variance: 0,
      varianceValue: 0,
      costPrice: product.costPrice || 0,
      status: "pending",
      countType: "standard",
    });

    if (product.packType === "pack" && (product.qtyPerPack || 1) > 1) {
      items.push({
        productId: product._id,
        productName: `${product.name} (Loose Units)`,
        barcode: product.barcode ? `${product.barcode}-LU` : "",
        category: product.category || "",
        systemQty: 0,
        countedQty: null,
        variance: 0,
        varianceValue: 0,
        costPrice: Math.round(((product.costPrice || 0) / (product.qtyPerPack || 1)) * 100) / 100,
        status: "pending",
        countType: "loose-units",
        qtyPerPack: product.qtyPerPack || 1,
      });
    }
  }

  return items;
}

function getItemKey(item) {
  return `${String(item?.productId || "")}:${item?.countType || "standard"}`;
}

function mergeUniqueItems(existingItems = [], nextItems = []) {
  const merged = [...existingItems];
  const seenKeys = new Set(existingItems.map((item) => getItemKey(item)));

  for (const item of nextItems) {
    const key = getItemKey(item);
    if (seenKeys.has(key)) continue;
    merged.push(item);
    seenKeys.add(key);
  }

  return merged;
}

async function fetchProductsForStockTake(filters = {}) {
  return Product.find(getProductFilter(filters))
    .select(STOCK_TAKE_PRODUCT_SELECT)
    .sort({ name: 1 })
    .lean();
}

async function getStockTakeBuilderOptions() {
  const baseFilter = getProductFilter();

  const [categoryValues, shelfLineValues, vendors] = await Promise.all([
    Product.distinct("category", baseFilter),
    Product.distinct("locations", baseFilter),
    Vendor.find({ isActive: true }).select("_id companyName").sort({ companyName: 1 }).lean(),
  ]);

  const normalizedCategoryValues = Array.from(
    new Set(
      (Array.isArray(categoryValues) ? categoryValues : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  const objectIdCategoryValues = normalizedCategoryValues.filter((value) => isValidObjectId(value));
  const categoryDocs = objectIdCategoryValues.length > 0
    ? await Category.find({ _id: { $in: objectIdCategoryValues } }).select("_id name").lean()
    : [];
  const categoryNameMap = new Map(categoryDocs.map((category) => [String(category._id), category.name || String(category._id)]));

  const categories = normalizedCategoryValues
    .map((value) => ({
      value,
      label: categoryNameMap.get(value) || value,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));

  const shelfLines = Array.from(
    new Set(
      (Array.isArray(shelfLineValues) ? shelfLineValues : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  )
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: value }));

  return {
    categories,
    shelfLines,
    vendors: vendors.map((vendor) => ({
      value: String(vendor._id),
      label: vendor.companyName || String(vendor._id),
    })),
  };
}

/**
 * Brings uncounted lines up to what the system holds now. A counted line keeps the figure it was
 * counted against, or a sale after the count would read as a difference the count never found.
 * `recounting` holds the ids of lines being counted again now, which do move to the current figure.
 */
async function refreshOpenStockTakeSystemQuantities(stockTake, recounting = new Set()) {
  if (!stockTake || !["draft", "in-progress"].includes(stockTake.status)) {
    return false;
  }

  const itemList = Array.isArray(stockTake.items) ? stockTake.items : [];
  if (itemList.length === 0) {
    return false;
  }

  const productIds = Array.from(
    new Set(
      itemList
        .map((item) => String(item?.productId || "").trim())
        .filter((value) => isValidObjectId(value))
    )
  );

  if (productIds.length === 0) {
    return false;
  }

  const products = await Product.find({ _id: { $in: productIds } })
    .select("_id quantity costPrice qtyPerPack")
    .lean();
  const productMap = new Map(products.map((product) => [String(product._id), product]));

  let changed = false;

  for (const item of itemList) {
    if (item.countedQty !== null && !recounting.has(String(item._id))) continue;

    const product = productMap.get(String(item.productId || ""));
    if (!product) continue;

    const nextSystemQty = item.countType === "loose-units" ? 0 : Number(product.quantity || 0);
    const nextCostPrice = item.countType === "loose-units"
      ? Math.round((((product.costPrice || 0) / (item.qtyPerPack || product.qtyPerPack || 1)) || 0) * 100) / 100
      : Number(product.costPrice || 0);

    if ((item.systemQty || 0) !== nextSystemQty) {
      item.systemQty = nextSystemQty;
      changed = true;
    }

    if ((item.costPrice || 0) !== nextCostPrice) {
      item.costPrice = nextCostPrice;
      changed = true;
    }

    if (item.countedQty !== null) {
      const nextVariance = Number(item.countedQty) - nextSystemQty;
      const nextVarianceValue = nextVariance * nextCostPrice;

      if ((item.variance || 0) !== nextVariance) {
        item.variance = nextVariance;
        changed = true;
      }

      if ((item.varianceValue || 0) !== nextVarianceValue) {
        item.varianceValue = nextVarianceValue;
        changed = true;
      }

      if (item.status !== "counted") {
        item.status = "counted";
        changed = true;
      }

      if (nextVariance === 0 && item.reason) {
        item.reason = "";
        changed = true;
      }
    }
  }

  if (changed) {
    recalcSummary(stockTake);
  }

  return changed;
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) {
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  }

  const { id } = req.query;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: "Invalid stock take ID" });
  }

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const [stockTake, builderOptions] = await Promise.all([
        StockTake.findById(id),
        getStockTakeBuilderOptions(),
      ]);

      if (!stockTake) {
        return res.status(404).json({ success: false, message: "Stock take not found" });
      }

      const didRefreshSystemQty = await refreshOpenStockTakeSystemQuantities(stockTake);
      if (didRefreshSystemQty) {
        await stockTake.save();
      }

      return res.status(200).json({ success: true, stockTake: stockTake.toObject(), builderOptions });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  if (req.method === "PUT") {
    try {
      const stockTake = await StockTake.findById(id);
      if (!stockTake) {
        return res.status(404).json({ success: false, message: "Stock take not found" });
      }

      const { action, items, approvedBy } = req.body;

      if (["approve", "apply-adjustments", "cancel"].includes(action) && isBasicStaff(req)) {
        return res.status(403).json({ success: false, message: "Approving or cancelling a stock take is for a manager" });
      }

      if (action === "start") {
        if (stockTake.status !== "draft") {
          return res.status(400).json({ success: false, message: "Can only start a draft stock take" });
        }

        stockTake.status = "in-progress";
        stockTake.startedAt = new Date();
        await stockTake.save();
        return res.status(200).json({ success: true, message: "Stock take started", stockTake: stockTake.toObject() });
      }

      if (action === "create-list") {
        if (!canEditCounts(req, stockTake)) return rejectLockedEdit(res, req, stockTake);
        if (stockTake.adjustmentApplied) {
          return res.status(400).json({
            success: false,
            message: "Stock has already been adjusted from this list — start a new stock take to count a different list",
          });
        }

        const vendorIds = Array.isArray(req.body.vendorIds)
          ? req.body.vendorIds.map((value) => String(value || "").trim()).filter(Boolean)
          : [];
        const categoryIds = Array.isArray(req.body.categoryIds)
          ? req.body.categoryIds.map((value) => String(value || "").trim()).filter(Boolean)
          : [];
        const shelfLines = Array.isArray(req.body.shelfLines)
          ? req.body.shelfLines.map((value) => String(value || "").trim()).filter(Boolean)
          : [];

        const products = await fetchProductsForStockTake({ vendorIds, categoryIds, shelfLines });
        const nextItems = buildStockTakeItems(products);

        if (nextItems.length === 0) {
          return res.status(400).json({ success: false, message: "No stock-managed products match the selected filters" });
        }

        stockTake.items = nextItems;
        if (stockTake.status === "draft") {
          stockTake.status = "in-progress";
          stockTake.startedAt = stockTake.startedAt || new Date();
        }

        recalcSummary(stockTake);
        await stockTake.save();
        return res.status(200).json({
          success: true,
          message: `${nextItems.length} item(s) added to the stock take list`,
          stockTake: stockTake.toObject(),
        });
      }

      if (action === "add-items") {
        if (!canEditCounts(req, stockTake)) return rejectLockedEdit(res, req, stockTake);

        const productIds = Array.isArray(req.body.productIds)
          ? req.body.productIds.map((value) => String(value || "").trim()).filter(Boolean)
          : [];

        if (productIds.length === 0) {
          return res.status(400).json({ success: false, message: "Select at least one product to add" });
        }

        const products = await fetchProductsForStockTake({ productIds });
        const nextItems = buildStockTakeItems(products);
        const mergedItems = mergeUniqueItems(stockTake.items || [], nextItems);
        const addedCount = mergedItems.length - (stockTake.items?.length || 0);

        if (addedCount === 0) {
          return res.status(400).json({ success: false, message: "Selected products are already on this stock take" });
        }

        stockTake.items = mergedItems;
        if (stockTake.status === "draft") {
          stockTake.status = "in-progress";
          stockTake.startedAt = stockTake.startedAt || new Date();
        }

        recalcSummary(stockTake);
        await stockTake.save();
        return res.status(200).json({
          success: true,
          message: `${addedCount} item(s) added to the stock take`,
          stockTake: stockTake.toObject(),
        });
      }

      if (action === "clear-list") {
        if (!canEditCounts(req, stockTake)) return rejectLockedEdit(res, req, stockTake);
        if (stockTake.adjustmentApplied) {
          return res.status(400).json({
            success: false,
            message: "Stock has already been adjusted from this list — start a new stock take to count a different list",
          });
        }

        stockTake.items = [];
        recalcSummary(stockTake);
        await stockTake.save();

        return res.status(200).json({
          success: true,
          message: "Stock take list cleared",
          stockTake: stockTake.toObject(),
        });
      }

      if (action === "update-counts") {
        if (!canEditCounts(req, stockTake)) return rejectLockedEdit(res, req, stockTake);

        if (stockTake.status === "draft") {
          stockTake.status = "in-progress";
          stockTake.startedAt = stockTake.startedAt || new Date();
        }

        await refreshOpenStockTakeSystemQuantities(
          stockTake,
          new Set((Array.isArray(items) ? items : [])
            .filter((update) => update.countedQty !== undefined && update.countedQty !== null)
            .map((update) => String(update._id)))
        );

        if (Array.isArray(items)) {
          for (const update of items) {
            const item = stockTake.items.id(update._id);
            if (!item) continue;

            if (update.countedQty !== undefined && update.countedQty !== null) {
              markItemCounted(item, update.countedQty, update.countedBy || req.user?.name || "");
            }

            if (update.reason !== undefined) item.reason = String(update.reason || "").trim();
            if (update.notes !== undefined) item.notes = update.notes;
          }
        }

        completePartiallyCountedPackGroups(stockTake, req.user?.name || "System");

        const changedProductIds = (Array.isArray(items) ? items : [])
          .map((update) => stockTake.items.id(update._id)?.productId)
          .filter(Boolean);
        const stockNote = await syncAppliedCounts(stockTake, changedProductIds);

        recalcSummary(stockTake);
        await stockTake.save();
        await postAppliedCounts(stockTake);
        return res.status(200).json({ success: true, message: `Counts updated${stockNote}`, stockTake: stockTake.toObject() });
      }

      if (action === "zero-uncounted") {
        if (!canEditCounts(req, stockTake)) return rejectLockedEdit(res, req, stockTake);

        await refreshOpenStockTakeSystemQuantities(stockTake);

        let updatedCount = 0;
        const zeroedProductIds = [];
        for (const item of stockTake.items) {
          if (item.countedQty !== null) continue;
          zeroedProductIds.push(item.productId);

          item.countedQty = 0;
          item.variance = 0 - item.systemQty;
          item.varianceValue = item.variance * item.costPrice;
          item.status = "counted";
          item.countedAt = new Date();
          item.countedBy = req.user?.name || "System";
          item.reason = item.variance !== 0 ? (item.reason || "Stock Take") : "";
          updatedCount += 1;
        }

        if (updatedCount === 0) {
          return res.status(400).json({ success: false, message: "There are no uncounted items to zero" });
        }

        const zeroNote = await syncAppliedCounts(stockTake, zeroedProductIds);

        recalcSummary(stockTake);
        await stockTake.save();
        await postAppliedCounts(stockTake);
        return res.status(200).json({
          success: true,
          message: `${updatedCount} uncounted item(s) set to zero${zeroNote}`,
          stockTake: stockTake.toObject(),
        });
      }

      if (action === "remove-uncounted") {
        if (!canEditCounts(req, stockTake)) return rejectLockedEdit(res, req, stockTake);

        const originalLength = Array.isArray(stockTake.items) ? stockTake.items.length : 0;
        stockTake.items = (stockTake.items || []).filter((item) => item.countedQty !== null);
        const removedCount = originalLength - stockTake.items.length;

        if (removedCount === 0) {
          return res.status(400).json({ success: false, message: "There are no uncounted items to remove" });
        }

        recalcSummary(stockTake);
        await stockTake.save();
        return res.status(200).json({
          success: true,
          message: `${removedCount} uncounted item(s) removed from the stock take`,
          stockTake: stockTake.toObject(),
        });
      }

      if (action === "complete") {
        if (!isAdmin(req)) {
          return res.status(403).json({ success: false, message: "Only admins can complete a stock take" });
        }
        if (stockTake.status !== "in-progress") {
          return res.status(400).json({ success: false, message: "Can only complete an in-progress stock take" });
        }
        if (!Array.isArray(stockTake.items) || stockTake.items.length === 0) {
          return res.status(400).json({ success: false, message: "Create a list before completing this stock take" });
        }

        await refreshOpenStockTakeSystemQuantities(stockTake);

        if (stockTake.items.some((item) => item.countedQty === null)) {
          return res.status(400).json({ success: false, message: "Zero or remove uncounted items before completing this stock take" });
        }

        recalcSummary(stockTake);
        stockTake.status = "completed";
        stockTake.completedAt = new Date();
        await stockTake.save();
        return res.status(200).json({ success: true, message: "Stock take completed", stockTake: stockTake.toObject() });
      }

      if (action === "approve") {
        if (stockTake.status !== "completed") {
          return res.status(400).json({ success: false, message: "Can only approve a completed stock take" });
        }

        stockTake.status = "approved";
        stockTake.approvedBy = approvedBy || req.user?.name || "";
        stockTake.approvedAt = new Date();
        await stockTake.save();
        return res.status(200).json({ success: true, message: "Stock take approved", stockTake: stockTake.toObject() });
      }

      if (action === "apply-adjustments") {
        if (stockTake.status !== "approved") {
          return res.status(400).json({ success: false, message: "Stock take must be approved before applying adjustments" });
        }
        if (stockTake.adjustmentApplied) {
          return res.status(400).json({ success: false, message: "Adjustments already applied" });
        }

        const { bulkOps, appliedAdjustments } = stockWritesFor(stockTake, stockChangesFromCounts(stockTake));
        const adjustedCount = bulkOps.length;
        const adjustedAt = new Date();

        // Stock moves by a difference now, so it must happen exactly once: the flag and the stock
        // are written together, and a second request finds the flag already set
        const dbSession = await mongoose.startSession();
        try {
          await dbSession.withTransaction(async () => {
            const claimed = await StockTake.updateOne(
              { _id: stockTake._id, status: "approved", adjustmentApplied: { $ne: true } },
              { $set: { adjustmentApplied: true, adjustedAt, appliedAdjustments } },
              { session: dbSession }
            );
            if (claimed.modifiedCount === 0) {
              throw Object.assign(new Error("Adjustments already applied"), { alreadyApplied: true });
            }
            if (bulkOps.length > 0) await Product.bulkWrite(bulkOps, { session: dbSession });
          });
        } catch (applyError) {
          if (applyError.alreadyApplied) {
            return res.status(400).json({ success: false, message: applyError.message });
          }
          throw applyError;
        } finally {
          await dbSession.endSession();
        }

        await refreshChildQuantities(bulkOps);

        stockTake.adjustmentApplied = true;
        stockTake.adjustedAt = adjustedAt;
        stockTake.appliedAdjustments = appliedAdjustments;
        await postAppliedCounts(stockTake);

        return res.status(200).json({
          success: true,
          message: `Adjustments applied to ${adjustedCount} product(s)`,
          adjustedCount,
          stockTake: stockTake.toObject(),
        });
      }

      if (action === "cancel") {
        if (["approved"].includes(stockTake.status) && stockTake.adjustmentApplied) {
          return res.status(400).json({ success: false, message: "Cannot cancel after adjustments are applied" });
        }

        stockTake.status = "cancelled";
        await stockTake.save();
        return res.status(200).json({ success: true, message: "Stock take cancelled", stockTake: stockTake.toObject() });
      }

      if (action === "zero-all") {
        if (!isAdmin(req)) {
          return res.status(403).json({ success: false, message: "Only admins can zero all stock" });
        }
        if (!canEditCounts(req, stockTake)) return rejectLockedEdit(res, req, stockTake);

        if (stockTake.status === "draft") {
          stockTake.status = "in-progress";
          stockTake.startedAt = stockTake.startedAt || new Date();
        }

        if (!Array.isArray(stockTake.items) || stockTake.items.length === 0) {
          const products = await fetchProductsForStockTake();
          stockTake.items = buildStockTakeItems(products);
        } else {
          await refreshOpenStockTakeSystemQuantities(stockTake, new Set(stockTake.items.map((item) => String(item._id))));
        }

        if (!Array.isArray(stockTake.items) || stockTake.items.length === 0) {
          return res.status(400).json({ success: false, message: "No stock-managed products are available to zero" });
        }

        for (const item of stockTake.items) {
          item.countedQty = 0;
          item.variance = 0 - item.systemQty;
          item.varianceValue = item.variance * item.costPrice;
          item.status = "counted";
          item.countedAt = new Date();
          item.countedBy = req.body.countedBy || req.user?.name || "System";
        }

        const allZeroNote = await syncAppliedCounts(stockTake, stockTake.items.map((item) => item.productId));

        recalcSummary(stockTake);
        await stockTake.save();
        await postAppliedCounts(stockTake);
        return res.status(200).json({
          success: true,
          message: `All ${stockTake.items.length} items set to zero${allZeroNote}`,
          stockTake: stockTake.toObject(),
        });
      }

      return res.status(400).json({ success: false, message: "Unknown action" });
    } catch (err) {
      console.error("Stock take PUT error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  if (req.method === "DELETE") {
    if (isBasicStaff(req)) {
      return res.status(403).json({ success: false, message: "Deleting a stock take is for a manager" });
    }

    try {
      const stockTake = await StockTake.findById(id);
      if (!stockTake) {
        return res.status(404).json({ success: false, message: "Stock take not found" });
      }
      if (stockTake.adjustmentApplied) {
        return res.status(400).json({ success: false, message: "Cannot delete a stock take with applied adjustments" });
      }

      await StockTake.deleteOne({ _id: id });
      return res.status(200).json({ success: true, message: "Stock take deleted" });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ message: "Method not allowed" });
}
