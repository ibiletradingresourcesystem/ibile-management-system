// pages/api/stock-take/[id].js
import { mongooseConnect } from "@/lib/mongodb";
import StockTake from "@/models/StockTake";
import Product from "@/models/Product";
import Category from "@/models/Category";
import Vendor from "@/models/Vendor";
import { deriveChildQty } from "@/lib/syncPackQty";
import { authMiddleware, isAdmin, isStaff } from "@/lib/auth-middleware";
import { isValidObjectId } from "mongoose";

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

function markItemCounted(item, countedQty, countedBy = "System") {
  item.countedQty = Number(countedQty || 0);
  item.variance = item.countedQty - item.systemQty;
  item.varianceValue = item.variance * item.costPrice;
  item.status = "counted";
  item.countedAt = new Date();
  item.countedBy = countedBy;
  item.reason = item.variance !== 0 ? (item.reason || "Stock Take") : "";
}

function completePartiallyCountedPackGroups(stockTake, countedBy = "System") {
  const groups = new Map();

  for (const item of stockTake.items || []) {
    const productId = String(item.productId || "");
    if (!productId) continue;
    const group = groups.get(productId) || [];
    group.push(item);
    groups.set(productId, group);
  }

  for (const groupItems of groups.values()) {
    const hasLooseUnits = groupItems.some((item) => item.countType === "loose-units");
    if (!hasLooseUnits) continue;

    const hasAnyCount = groupItems.some((item) => item.countedQty !== null && item.countedQty !== undefined);
    if (!hasAnyCount) continue;

    groupItems.forEach((item) => {
      if (item.countedQty === null || item.countedQty === undefined) {
        markItemCounted(item, 0, countedBy);
      }
    });
  }
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

async function refreshOpenStockTakeSystemQuantities(stockTake) {
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
        if (!["draft", "in-progress"].includes(stockTake.status)) {
          return res.status(400).json({ success: false, message: "Cannot create a list in the current status" });
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
        if (!["draft", "in-progress"].includes(stockTake.status)) {
          return res.status(400).json({ success: false, message: "Cannot add items in the current status" });
        }

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
        if (!["draft", "in-progress"].includes(stockTake.status)) {
          return res.status(400).json({ success: false, message: "Cannot clear the list in the current status" });
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
        if (!["draft", "in-progress"].includes(stockTake.status)) {
          return res.status(400).json({ success: false, message: "Cannot update counts in current status" });
        }

        if (stockTake.status === "draft") {
          stockTake.status = "in-progress";
          stockTake.startedAt = stockTake.startedAt || new Date();
        }

        await refreshOpenStockTakeSystemQuantities(stockTake);

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

        recalcSummary(stockTake);
        await stockTake.save();
        return res.status(200).json({ success: true, message: "Counts updated", stockTake: stockTake.toObject() });
      }

      if (action === "zero-uncounted") {
        if (!["draft", "in-progress"].includes(stockTake.status)) {
          return res.status(400).json({ success: false, message: "Cannot zero uncounted items in the current status" });
        }

        await refreshOpenStockTakeSystemQuantities(stockTake);

        let updatedCount = 0;
        for (const item of stockTake.items) {
          if (item.countedQty !== null) continue;

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

        recalcSummary(stockTake);
        await stockTake.save();
        return res.status(200).json({
          success: true,
          message: `${updatedCount} uncounted item(s) set to zero`,
          stockTake: stockTake.toObject(),
        });
      }

      if (action === "remove-uncounted") {
        if (!["draft", "in-progress"].includes(stockTake.status)) {
          return res.status(400).json({ success: false, message: "Cannot remove uncounted items in the current status" });
        }

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

        const productQtyMap = new Map();
        for (const item of stockTake.items) {
          if (item.status !== "counted" || item.countedQty === null) continue;

          const productId = String(item.productId);
          if (!productQtyMap.has(productId)) {
            productQtyMap.set(productId, { packs: null, looseUnits: 0, looseUnitsCounted: false, qtyPerPack: 1 });
          }
          const entry = productQtyMap.get(productId);

          if (item.countType === "loose-units") {
            entry.looseUnits = item.countedQty || 0;
            entry.looseUnitsCounted = true;
            entry.qtyPerPack = item.qtyPerPack || 1;
          } else {
            entry.packs = item.countedQty;
          }
        }

        const bulkOps = [];
        for (const [productId, { packs, looseUnits, looseUnitsCounted, qtyPerPack }] of productQtyMap.entries()) {
          if (packs === null && !looseUnitsCounted) continue;

          const finalQty = (packs ?? 0) + (looseUnits / qtyPerPack);
          const current = await Product.findById(productId).select("quantity").lean();
          if (!current || current.quantity === finalQty) continue;

          bulkOps.push({
            updateOne: {
              filter: { _id: productId },
              update: { $set: { quantity: finalQty } },
            },
          });
        }

        if (bulkOps.length > 0) {
          await Product.bulkWrite(bulkOps);
          for (const [productId] of productQtyMap.entries()) {
            await deriveChildQty(productId);
          }
        }

        stockTake.adjustmentApplied = true;
        stockTake.adjustedAt = new Date();
        await stockTake.save();

        return res.status(200).json({
          success: true,
          message: `Adjustments applied to ${bulkOps.length} product(s)`,
          adjustedCount: bulkOps.length,
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
        if (!["draft", "in-progress"].includes(stockTake.status)) {
          return res.status(400).json({ success: false, message: "Cannot zero counts in current status" });
        }

        if (stockTake.status === "draft") {
          stockTake.status = "in-progress";
          stockTake.startedAt = stockTake.startedAt || new Date();
        }

        if (!Array.isArray(stockTake.items) || stockTake.items.length === 0) {
          const products = await fetchProductsForStockTake();
          stockTake.items = buildStockTakeItems(products);
        } else {
          await refreshOpenStockTakeSystemQuantities(stockTake);
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

        recalcSummary(stockTake);
        await stockTake.save();
        return res.status(200).json({
          success: true,
          message: `All ${stockTake.items.length} items set to zero`,
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

function recalcSummary(stockTake) {
  const items = stockTake.items || [];
  stockTake.totalItems = items.length;
  stockTake.countedItems = items.filter((item) => item.status === "counted").length;
  stockTake.totalSystemQty = items.reduce((sum, item) => sum + (item.systemQty || 0), 0);
  stockTake.totalCountedQty = items
    .filter((item) => item.countedQty !== null)
    .reduce((sum, item) => sum + item.countedQty, 0);
  stockTake.totalVariance = items
    .filter((item) => item.countedQty !== null)
    .reduce((sum, item) => sum + item.variance, 0);
  stockTake.totalVarianceValue = items
    .filter((item) => item.countedQty !== null)
    .reduce((sum, item) => sum + item.varianceValue, 0);
  stockTake.positiveVariance = items.filter((item) => item.variance > 0).reduce((sum, item) => sum + item.variance, 0);
  stockTake.negativeVariance = items.filter((item) => item.variance < 0).reduce((sum, item) => sum + Math.abs(item.variance), 0);
  stockTake.accuracyRate = stockTake.totalItems > 0
    ? Math.round((items.filter((item) => item.countedQty !== null && item.variance === 0).length / stockTake.totalItems) * 100)
    : 0;
}
