// pages/api/stock-movement/batches-with-expiry.js

import { mongooseConnect, withRetry } from "@/lib/mongodb";
import StockMovement from "@/models/StockMovement";
import Product from "@/models/Product";
import Transaction from "@/models/Transactions";
import { Category } from "@/models/Category";
import { buildLocationCache } from "@/lib/serverLocationHelper";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

function normalizeLocationValue(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeProductId(value) {
  if (!value) return "";
  if (typeof value === "object") return String(value._id || value.id || value).trim();
  return String(value).trim();
}

function toQuantity(value) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getLocationName(locationId, locationCache, fallback = "Unknown") {
  const key = String(locationId || "").trim();
  if (!key) return fallback;
  return locationCache[key] || fallback;
}

function getProductBatchDelta(productMap, productId, quantity) {
  const normalizedProductId = normalizeProductId(productId);
  const product = productMap.get(normalizedProductId);

  if (!product || quantity <= 0) {
    return { productId: normalizedProductId, quantity };
  }

  if (product.isChildProduct && product.parentProduct && product.packType !== "pack") {
    const parent = productMap.get(String(product.parentProduct));
    const qtyPerPack = Number(parent?.qtyPerPack || product.qtyPerPack || 1) || 1;
    return { productId: String(product.parentProduct), quantity: quantity / qtyPerPack };
  }

  return { productId: normalizedProductId, quantity };
}

function sortBatchesForFifo(batchList) {
  batchList.sort((left, right) => {
    const leftReceived = new Date(left.dateReceived || left.expiryDate).getTime();
    const rightReceived = new Date(right.dateReceived || right.expiryDate).getTime();
    if (leftReceived !== rightReceived) return leftReceived - rightReceived;
    return new Date(left.expiryDate).getTime() - new Date(right.expiryDate).getTime();
  });
}

function applyFifoDepletion(batchList, productId, locationName, quantity) {
  const normalizedLocation = normalizeLocationValue(locationName);
  let remainingToDeduct = toQuantity(quantity);

  if (!productId || !normalizedLocation || remainingToDeduct <= 0) return;

  const matchingBatches = batchList.filter((batch) => (
    String(batch.productId) === String(productId) &&
    normalizeLocationValue(batch.locationName) === normalizedLocation &&
    batch.remainingQuantity > 0
  ));

  sortBatchesForFifo(matchingBatches);

  for (const batch of matchingBatches) {
    if (remainingToDeduct <= 0) break;
    const deducted = Math.min(batch.remainingQuantity, remainingToDeduct);
    batch.remainingQuantity -= deducted;
    batch.depletedQuantity += deducted;
    remainingToDeduct -= deducted;
  }
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const batches = await withRetry(async () => {
      await mongooseConnect();

      const [locationCache, allCategories, stockMovements, products, transactions] = await Promise.all([
        buildLocationCache(),
        Category.find({}).select("_id name").lean(),
        StockMovement.find({ "products.expiryDate": { $exists: true, $ne: null } })
          .select("transRef toLocationId fromLocationId reason status dateReceived dateSent products")
          .populate({
            path: "products.productId",
            model: Product,
            select: "name category expiryDate _id isChildProduct parentProduct packType qtyPerPack",
          })
          .lean(),
        Product.find({}).select("_id isChildProduct parentProduct packType qtyPerPack").lean(),
        Transaction.find({ status: { $in: ["completed", "refunded", "credit"] } })
          .select("items location status subStatus createdAt")
          .lean(),
      ]);

      const categoryCache = {};
      allCategories.forEach((category) => {
        categoryCache[String(category._id)] = category.name;
      });

      const productMap = new Map(products.map((product) => [String(product._id), product]));
      const batchList = [];

      for (const movement of stockMovements) {
        if (!movement.products?.length) continue;

        const destinationName = movement.toLocationId
          ? getLocationName(movement.toLocationId, locationCache)
          : movement.reason === "Restock"
            ? "Vendor"
            : getLocationName(movement.fromLocationId, locationCache, "Vendor");

        for (const productItem of movement.products) {
          const product = productItem.productId;
          if (!product) continue;

          const expiryDate = productItem.expiryDate || product.expiryDate;
          const originalQuantity = toQuantity(productItem.quantity);
          if (!expiryDate || originalQuantity <= 0) continue;

          let categoryName = "Top Level";
          if (product.category && product.category !== "Top Level") {
            const categoryId = String(product.category);
            categoryName = categoryCache[categoryId] || product.category;
          }

          batchList.push({
            batchId: `${movement.transRef || movement._id.toString()}-${String(product._id)}`,
            transRef: movement.transRef,
            productId: String(product._id),
            productName: product.name || "Unknown Product",
            category: categoryName,
            locationId: movement.toLocationId,
            locationName: destinationName,
            expiryDate,
            originalQuantity,
            remainingQuantity: originalQuantity,
            depletedQuantity: 0,
            quantity: originalQuantity,
            costPrice: productItem.costPrice || 0,
            dateReceived: movement.dateReceived || movement.dateSent,
            status: movement.status,
            reason: movement.reason,
          });
        }
      }

      sortBatchesForFifo(batchList);

      for (const movement of stockMovements) {
        if (!["Transfer", "Return", "Adjustment", "Operational Loss"].includes(movement.reason)) continue;

        const sourceName = getLocationName(movement.fromLocationId, locationCache, "");
        if (!sourceName) continue;

        for (const productItem of movement.products || []) {
          const productId = normalizeProductId(productItem.productId);
          const { productId: resolvedProductId, quantity } = getProductBatchDelta(productMap, productId, toQuantity(productItem.quantity));
          applyFifoDepletion(batchList, resolvedProductId, sourceName, quantity);
        }
      }

      for (const transaction of transactions) {
        if (transaction.status !== "completed" || transaction.subStatus === "void") continue;

        const locationName = String(transaction.location || "").trim();
        if (!locationName) continue;

        for (const item of transaction.items || []) {
          const { productId, quantity } = getProductBatchDelta(productMap, item.productId, toQuantity(item.qty ?? item.quantity));
          applyFifoDepletion(batchList, productId, locationName, quantity);
        }
      }

      return batchList
        .map((batch) => ({
          ...batch,
          remainingQuantity: Math.max(0, Math.round(batch.remainingQuantity * 10000) / 10000),
          depletedQuantity: Math.round(batch.depletedQuantity * 10000) / 10000,
        }))
        .map((batch) => ({
          ...batch,
          quantity: batch.remainingQuantity,
          soldOut: batch.remainingQuantity <= 0,
        }))
        .sort((left, right) => new Date(left.expiryDate) - new Date(right.expiryDate));
    });

    return res.status(200).json({
      success: true,
      data: batches,
      count: batches.length,
    });
  } catch (error) {
    console.error("Error fetching batches with expiry:", error);
    return res.status(500).json({
      error: "Failed to fetch batch data",
      details: error.message,
    });
  }
}
