/**
 * A product's expiry batches, for the product page.
 *
 * GET ?productId=…  → { batches, locations }: every batch of the product (received with stock,
 *                     recorded here, or an old date with no quantity) with what is left of each,
 *                     and the store's locations to pick from.
 * PUT { productId, batches: [{ recordId?, expiryDate, quantity, locationId }], noQuantityDate }
 *                   → saves the batches recorded on the product page: new rows are added, changed
 *                     ones updated, rows no longer sent removed. `noQuantityDate` keeps an old
 *                     single expiry date that has no quantity yet ("" drops it).
 *
 * Recording a batch labels stock already on the shelf; it never changes the stock figure.
 */
import mongoose, { isValidObjectId } from "mongoose";
import { mongooseConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import Store from "@/models/Store";
import ExpiryBatch from "@/models/ExpiryBatch";
import { authMiddleware } from "@/lib/auth-middleware";
import { loadExpiryBatches } from "@/lib/expiryBatches";
import { isDerivedChild } from "@/lib/packUnits";

async function storeLocations() {
  const stores = await Store.find({}).select("locations").lean();
  return stores
    .flatMap((store) => store.locations || [])
    .filter((location) => location && location._id && location.isActive !== false)
    .map((location) => ({ _id: String(location._id), name: location.name || "" }));
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  const productId = String(req.query.productId || req.body?.productId || "");
  if (!isValidObjectId(productId)) return res.status(400).json({ success: false, message: "A product is required" });

  try {
    await mongooseConnect();
    const product = await Product.findById(productId).select("_id name isChildProduct parentProduct packType expiryDate").lean();
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    if (req.method === "GET") {
      const [batches, locations] = await Promise.all([loadExpiryBatches({ productIds: [productId] }), storeLocations()]);
      return res.status(200).json({ success: true, batches, locations });
    }

    if (req.method !== "PUT") {
      res.setHeader("Allow", ["GET", "PUT"]);
      return res.status(405).json({ success: false, message: "Method not allowed" });
    }

    if (isDerivedChild(product)) {
      return res.status(400).json({ success: false, message: "A child product's stock is its pack's: record expiry batches on the pack." });
    }

    const rows = Array.isArray(req.body?.batches) ? req.body.batches : [];
    const locations = await storeLocations();
    const locationById = new Map(locations.map((location) => [location._id, location]));
    // A batch is used up by sales at its location, so one sent without one gets the product's
    // first location, else the store's first
    const productLocations = ((await Product.findById(productId).select("locations").lean())?.locations || []).map((value) => String(value).trim().toLowerCase());
    const fallbackLocation = locations.find((location) => productLocations.includes(location.name.trim().toLowerCase()) || productLocations.includes(location._id)) || locations[0] || null;

    const clean = [];
    for (const [index, row] of rows.entries()) {
      const expiryDate = parseDate(row?.expiryDate);
      const quantity = Number(row?.quantity);
      if (!expiryDate) return res.status(400).json({ success: false, message: `Batch ${index + 1}: an expiry date is required` });
      if (row?.quantity === "" || row?.quantity === null || row?.quantity === undefined || !Number.isFinite(quantity) || quantity < 0) {
        return res.status(400).json({ success: false, message: `Batch ${index + 1}: a quantity of zero or more is required` });
      }
      const locationId = String(row?.locationId || fallbackLocation?._id || "");
      if (locationId && !locationById.has(locationId)) {
        return res.status(400).json({ success: false, message: `Batch ${index + 1}: that location is not one of the store's` });
      }
      clean.push({
        recordId: isValidObjectId(row?.recordId) ? String(row.recordId) : null,
        expiryDate,
        quantity,
        locationId: locationId || null,
        locationName: locationId ? locationById.get(locationId).name : "",
      });
    }

    const existing = await ExpiryBatch.find({ productId }).select("_id").lean();
    const existingIds = new Set(existing.map((batch) => String(batch._id)));
    const keep = new Set();
    const writes = [];
    for (const row of clean) {
      const fields = { expiryDate: row.expiryDate, quantity: row.quantity, locationId: row.locationId, locationName: row.locationName };
      if (row.recordId && existingIds.has(row.recordId)) {
        keep.add(row.recordId);
        writes.push({ updateOne: { filter: { _id: row.recordId, productId }, update: { $set: fields } } });
      } else {
        writes.push({ insertOne: { document: { productId: new mongoose.Types.ObjectId(productId), ...fields, recordedBy: req.user?.name || "" } } });
      }
    }
    const removed = [...existingIds].filter((id) => !keep.has(id));
    if (removed.length > 0) writes.push({ deleteMany: { filter: { _id: { $in: removed }, productId } } });
    if (writes.length > 0) await ExpiryBatch.bulkWrite(writes);

    // The old single date, kept only while it has no quantity
    const noQuantityDate = parseDate(req.body?.noQuantityDate);
    await Product.updateOne(
      { _id: productId },
      noQuantityDate
        ? { $set: { expiryDate: noQuantityDate, isExpired: noQuantityDate < new Date() } }
        : { $unset: { expiryDate: "" }, $set: { isExpired: false } }
    );

    const batches = await loadExpiryBatches({ productIds: [productId] });
    return res.status(200).json({ success: true, batches, locations, message: "Expiry batches saved" });
  } catch (error) {
    console.error("Expiry batches error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
}
