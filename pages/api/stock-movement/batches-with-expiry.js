// pages/api/stock-movement/batches-with-expiry.js

import mongoose from "mongoose";
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
      const locationCache = await buildLocationCache();

      // Stage 1 — Build batch list via aggregation ($match first to respect 100MB RAM limit)
      const rawBatches = await StockMovement.aggregate([
        { $match: { "products.expiryDate": { $exists: true, $ne: null } } },
        { $unwind: "$products" },
        { $match: { "products.expiryDate": { $ne: null }, "products.quantity": { $gt: 0 } } },
        { $lookup: {
          from: "products",
          localField: "products.productId",
          foreignField: "_id",
          pipeline: [
            { $project: { name: 1, category: 1, expiryDate: 1, isChildProduct: 1, parentProduct: 1, packType: 1, qtyPerPack: 1 } }
          ],
          as: "productInfo"
        }},
        { $unwind: { path: "$productInfo", preserveNullAndEmptyArrays: false } },
        { $project: {
          transRef: 1,
          toLocationId: 1,
          fromLocationId: 1,
          reason: 1,
          status: 1,
          dateReceived: 1,
          dateSent: 1,
          productId: "$productInfo._id",
          productName: { $ifNull: ["$productInfo.name", "Unknown Product"] },
          category: { $ifNull: ["$productInfo.category", "Top Level"] },
          expiryDate: { $ifNull: ["$products.expiryDate", "$productInfo.expiryDate"] },
          originalQuantity: "$products.quantity",
          costPrice: { $ifNull: ["$products.costPrice", 0] },
        }}
      ]);

      if (rawBatches.length === 0) return [];

      // Build batch list with resolved location names
      const batchProductIds = new Set();
      const batchList = rawBatches.map((batch) => {
        const productId = String(batch.productId);
        batchProductIds.add(productId);

        const destinationName = batch.toLocationId
          ? getLocationName(batch.toLocationId, locationCache)
          : batch.reason === "Restock"
            ? "Vendor"
            : getLocationName(batch.fromLocationId, locationCache, "Vendor");

        return {
          batchId: `${batch.transRef || String(batch._id)}-${productId}`,
          transRef: batch.transRef,
          productId,
          productName: batch.productName,
          category: batch.category,
          locationId: batch.toLocationId,
          locationName: destinationName,
          expiryDate: batch.expiryDate,
          originalQuantity: batch.originalQuantity,
          remainingQuantity: batch.originalQuantity,
          depletedQuantity: 0,
          quantity: batch.originalQuantity,
          costPrice: batch.costPrice,
          dateReceived: batch.dateReceived || batch.dateSent,
          status: batch.status,
          reason: batch.reason,
        };
      });

      sortBatchesForFifo(batchList);

      // Resolve category IDs to names for ObjectId-style values
      const categoryIds = [...new Set(
        batchList.filter((b) => /^[a-f0-9]{24}$/i.test(b.category)).map((b) => b.category)
      )];
      if (categoryIds.length > 0) {
        const cats = await Category.find({ _id: { $in: categoryIds } }).select("_id name").lean();
        const catMap = new Map(cats.map((c) => [String(c._id), c.name]));
        for (const batch of batchList) {
          if (catMap.has(batch.category)) batch.category = catMap.get(batch.category);
        }
      }

      // Fetch only products needed for child-product FIFO resolution
      const productIdObjects = Array.from(batchProductIds).map((id) => new mongoose.Types.ObjectId(id));
      const relevantProducts = await Product.find({
        $or: [
          { _id: { $in: productIdObjects } },
          { isChildProduct: true, parentProduct: { $in: productIdObjects }, packType: { $ne: "pack" } },
        ]
      }).select("_id isChildProduct parentProduct packType qtyPerPack").lean();

      const productMap = new Map(relevantProducts.map((p) => [String(p._id), p]));
      const allProductIds = relevantProducts.map((p) => p._id);

      // Stage 2 — Depletion events from movements (transfers, returns, adjustments)
      const [depletionMovements, depletionTransactions] = await Promise.all([
        StockMovement.aggregate([
          { $match: {
            reason: { $in: ["Transfer", "Return", "Adjustment", "Operational Loss"] },
            "products.productId": { $in: allProductIds },
          }},
          { $unwind: "$products" },
          { $match: { "products.productId": { $in: allProductIds } } },
          { $project: {
            fromLocationId: 1,
            productId: "$products.productId",
            quantity: "$products.quantity",
          }},
        ]),
        // Stage 3 — Depletion events from transactions (sales)
        Transaction.aggregate([
          { $match: {
            status: "completed",
            subStatus: { $ne: "void" },
            "items.productId": { $in: allProductIds },
          }},
          { $unwind: "$items" },
          { $match: { "items.productId": { $in: allProductIds } } },
          { $project: {
            location: 1,
            productId: "$items.productId",
            quantity: { $ifNull: ["$items.qty", "$items.quantity"] },
          }},
        ]),
      ]);

      for (const event of depletionMovements) {
        const sourceName = getLocationName(event.fromLocationId, locationCache, "");
        if (!sourceName) continue;
        const { productId, quantity } = getProductBatchDelta(productMap, event.productId, toQuantity(event.quantity));
        applyFifoDepletion(batchList, productId, sourceName, quantity);
      }

      for (const event of depletionTransactions) {
        const locationName = String(event.location || "").trim();
        if (!locationName) continue;
        const { productId, quantity } = getProductBatchDelta(productMap, event.productId, toQuantity(event.quantity));
        applyFifoDepletion(batchList, productId, locationName, quantity);
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
