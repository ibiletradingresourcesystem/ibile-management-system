/**
 * Expiry batches, and what is left of each: one place for Expiry Tracking, the notifications, the
 * product page and the monthly email.
 *
 * A batch is stock with an expiry date. It is either
 * - received with one: a Restock or a Transfer in whose stock movement line carries an expiry date;
 * - recorded on the product page against stock already on the shelf (models/ExpiryBatch.js); or
 * - an old single expiry date on the product, with no quantity: shown so someone can fill one in,
 *   and never used up or alerted on.
 *
 * Sales and stock going out of a location (transfers, returns, adjustments, losses) are taken in
 * the order they happened. Each uses up that location's batches that were already there at the
 * time, the one that expires first going first. A disposal (an Operational Loss line naming its
 * batch, recorded from Expiry Tracking) comes off that batch alone, so the batch reads as disposed
 * rather than sold.
 *
 * Quantities are in the product's stock unit: packs for a pack product.
 */
import mongoose, { isValidObjectId } from "mongoose";
import { mongooseConnect } from "@/lib/mongodb";
import StockMovement from "@/models/StockMovement";
import Product from "@/models/Product";
import Transaction from "@/models/Transactions";
import ExpiryBatch from "@/models/ExpiryBatch";
import { Category } from "@/models/Category";
import { buildLocationCache } from "@/lib/serverLocationHelper";
import { childQtyToParentQty, getPackSize, isDerivedChild, isPackProduct } from "@/lib/packUnits";

const EPSILON = 1e-9;
/** Stock arriving with an expiry date starts a batch. */
const RECEIVING_REASONS = ["Restock", "Transfer"];
/** Stock leaving a location uses batches up. */
const OUTGOING_REASONS = ["Transfer", "Return", "Adjustment", "Operational Loss"];
/** Sales whose goods left the shop: a refunded one came back, a voided one never went. */
const SALE_STATUSES = ["completed", "credit"];

// Fine enough that a pack's fractions add back up to whole units (20 cans is 0.833333333 of 24)
const round = (value) => Math.round((Number(value) || 0) * 1e9) / 1e9;
const normalize = (value) => String(value || "").trim().toLowerCase();
const timeOf = (...values) => {
  for (const value of values) {
    const time = value ? new Date(value).getTime() : NaN;
    if (Number.isFinite(time)) return time;
  }
  return null;
};
const dayKey = (date) => {
  const time = timeOf(date);
  return time === null ? "" : new Date(time).toISOString().slice(0, 10).replace(/-/g, "");
};

function locationName(id, cache, fallback = "") {
  const key = String(id || "").trim();
  if (!key) return fallback;
  return cache[key] || fallback;
}

/** First to expire first; then the one that arrived first. */
function expiryOrder(left, right) {
  return (timeOf(left.expiryDate) ?? Infinity) - (timeOf(right.expiryDate) ?? Infinity) || (left.dateIn ?? 0) - (right.dateIn ?? 0);
}

/** Names for categories stored as ids. */
async function categoryNames(products) {
  const ids = [...new Set(products.map((p) => String(p.category || "")).filter((value) => /^[a-f0-9]{24}$/i.test(value)))];
  if (ids.length === 0) return new Map();
  const categories = await Category.find({ _id: { $in: ids } }).select("_id name").lean();
  return new Map(categories.map((category) => [String(category._id), category.name]));
}

/**
 * Every batch, or only those of `productIds`, with { originalQuantity, remainingQuantity,
 * soldQuantity, disposedQuantity, otherQuantity, finished, finishedBy, needsQuantity, source, … }.
 */
export async function loadExpiryBatches({ productIds = null } = {}) {
  await mongooseConnect();
  const only = productIds
    ? [...new Set(productIds.map(String))].filter(isValidObjectId).map((id) => new mongoose.Types.ObjectId(id))
    : null;
  if (only && only.length === 0) return [];
  const forProducts = (field) => (only ? { [field]: { $in: only } } : {});

  const [locationCache, receivedLines, recorded, datedProducts] = await Promise.all([
    buildLocationCache(),
    StockMovement.aggregate([
      { $match: { reason: { $in: RECEIVING_REASONS }, "products.expiryDate": { $ne: null }, ...forProducts("products.productId") } },
      { $unwind: "$products" },
      { $match: { "products.expiryDate": { $ne: null }, "products.quantity": { $gt: 0 }, ...forProducts("products.productId") } },
      {
        $project: {
          transRef: 1, reason: 1, toLocationId: 1, fromLocationId: 1, dateReceived: 1, dateSent: 1, createdAt: 1,
          productId: "$products.productId", expiryDate: "$products.expiryDate", quantity: "$products.quantity", costPrice: "$products.costPrice",
        },
      },
    ]),
    ExpiryBatch.find(forProducts("productId")).lean(),
    // An old single date with no quantity, on a product that has stock
    Product.find({ expiryDate: { $ne: null }, isArchived: { $ne: true }, quantity: { $gt: 0 }, ...forProducts("_id") })
      .select("_id expiryDate")
      .lean(),
  ]);

  const recordedFor = new Set(recorded.map((batch) => String(batch.productId)));
  const legacy = datedProducts.filter((product) => !recordedFor.has(String(product._id)));

  const batchProductIds = [...new Set([
    ...receivedLines.map((line) => String(line.productId)),
    ...recorded.map((batch) => String(batch.productId)),
    ...legacy.map((product) => String(product._id)),
  ])];
  if (batchProductIds.length === 0) return [];
  const batchObjectIds = batchProductIds.map((id) => new mongoose.Types.ObjectId(id));

  // The batch products, and their children: a child's sale uses up its pack
  const products = await Product.find({
    $or: [
      { _id: { $in: batchObjectIds } },
      { isChildProduct: true, parentProduct: { $in: batchObjectIds }, packType: { $ne: "pack" } },
    ],
  })
    .select("_id name category locations isChildProduct parentProduct packType qtyPerPack unitsPerChild")
    .lean();
  const productMap = new Map(products.map((product) => [String(product._id), product]));
  const categories = await categoryNames(products);

  const describe = (productId) => {
    const product = productMap.get(productId) || {};
    const category = String(product.category || "");
    return {
      productName: product.name || "Unknown Product",
      category: categories.get(category) || category || "Top Level",
      packSize: isPackProduct(product) ? getPackSize(product) : 1,
    };
  };

  const batches = [];
  for (const line of receivedLines) {
    const productId = String(line.productId);
    const to = locationName(line.toLocationId, locationCache, "");
    batches.push({
      batchId: `${line.transRef || String(line._id)}-${productId}-${dayKey(line.expiryDate)}`,
      source: "received",
      transRef: line.transRef,
      reason: line.reason,
      productId,
      ...describe(productId),
      locationId: line.toLocationId ? String(line.toLocationId) : "",
      locationName: to || (line.reason === "Restock" ? "Vendor" : locationName(line.fromLocationId, locationCache, "Vendor")),
      expiryDate: line.expiryDate,
      dateIn: timeOf(line.dateReceived, line.dateSent, line.createdAt),
      originalQuantity: Number(line.quantity) || 0,
      costPrice: Number(line.costPrice) || 0,
    });
  }
  for (const batch of recorded) {
    const productId = String(batch.productId);
    batches.push({
      batchId: `pb-${batch._id}`,
      recordId: String(batch._id),
      source: "recorded",
      productId,
      ...describe(productId),
      locationId: batch.locationId ? String(batch.locationId) : "",
      locationName: locationName(batch.locationId, locationCache, "") || batch.locationName || "",
      expiryDate: batch.expiryDate,
      dateIn: timeOf(batch.createdAt),
      originalQuantity: Number(batch.quantity) || 0,
      recordedBy: batch.recordedBy || "",
    });
  }
  for (const dated of legacy) {
    const productId = String(dated._id);
    // A product's locations are kept as text: a location's id, or its name
    const first = String((productMap.get(productId)?.locations || [])[0] || "");
    batches.push({
      batchId: `legacy-${productId}`,
      source: "no-quantity",
      productId,
      ...describe(productId),
      locationId: "",
      locationName: locationName(first, locationCache, "") || first,
      expiryDate: dated.expiryDate,
      dateIn: null,
      originalQuantity: null,
    });
  }

  for (const batch of batches) {
    batch.remaining = batch.originalQuantity;
    batch.sold = 0;
    batch.disposed = 0;
    batch.other = 0;
  }

  // What uses the batches up, for the products whose batches have a quantity
  const tracked = batches.filter((batch) => batch.originalQuantity !== null);
  if (tracked.length > 0) {
    const trackedIds = new Set(tracked.map((batch) => batch.productId));
    const eventIds = products
      .filter((product) => trackedIds.has(String(product._id)) || (isDerivedChild(product) && trackedIds.has(String(product.parentProduct))))
      .map((product) => product._id);

    const [outgoing, sales] = await Promise.all([
      StockMovement.aggregate([
        { $match: { reason: { $in: OUTGOING_REASONS }, "products.productId": { $in: eventIds } } },
        { $unwind: "$products" },
        { $match: { "products.productId": { $in: eventIds } } },
        {
          $project: {
            reason: 1, fromLocationId: 1, dateSent: 1, createdAt: 1,
            productId: "$products.productId", quantity: "$products.quantity", batchKey: "$products.batchKey",
          },
        },
      ]),
      Transaction.aggregate([
        { $match: { status: { $in: SALE_STATUSES }, subStatus: { $ne: "void" }, "items.productId": { $in: eventIds } } },
        { $unwind: "$items" },
        { $match: { "items.productId": { $in: eventIds } } },
        { $project: { location: 1, createdAt: 1, productId: "$items.productId", quantity: { $ifNull: ["$items.qty", "$items.quantity"] } } },
      ]),
    ]);

    // A child's quantity, as packs of its parent
    const asStock = (productId, quantity) => {
      const product = productMap.get(String(productId));
      if (product && isDerivedChild(product)) {
        const parent = productMap.get(String(product.parentProduct));
        return { productId: String(product.parentProduct), quantity: childQtyToParentQty(quantity, product, parent) };
      }
      return { productId: String(productId), quantity };
    };

    const events = [];
    for (const line of outgoing) {
      const quantity = Number(line.quantity) || 0;
      if (quantity <= 0) continue;
      events.push({
        at: timeOf(line.dateSent, line.createdAt) ?? 0,
        kind: line.batchKey ? "dispose" : "out",
        batchKey: line.batchKey || "",
        location: locationName(line.fromLocationId, locationCache, ""),
        ...asStock(line.productId, quantity),
      });
    }
    for (const line of sales) {
      const quantity = Number(line.quantity) || 0;
      if (quantity <= 0) continue;
      events.push({ at: timeOf(line.createdAt) ?? 0, kind: "sale", location: String(line.location || ""), ...asStock(line.productId, quantity) });
    }
    events.sort((left, right) => left.at - right.at);

    const byKey = new Map(tracked.map((batch) => [batch.batchId, batch]));
    const byShelf = new Map();
    for (const batch of tracked) {
      const key = `${batch.productId}|${normalize(batch.locationName)}`;
      if (!byShelf.has(key)) byShelf.set(key, []);
      byShelf.get(key).push(batch);
    }
    for (const list of byShelf.values()) list.sort(expiryOrder);

    for (const event of events) {
      let left = event.quantity;
      // A disposal comes off the batch it names
      const named = event.batchKey ? byKey.get(event.batchKey) : null;
      if (named) {
        const take = Math.min(named.remaining, left);
        named.remaining -= take;
        named.disposed += take;
        left -= take;
      }
      if (left <= EPSILON) continue;
      // Everything else uses up the batches on that shelf that were there by then, first to expire first
      for (const batch of byShelf.get(`${event.productId}|${normalize(event.location)}`) || []) {
        if (left <= EPSILON) break;
        if (batch.remaining <= EPSILON || (batch.dateIn !== null && batch.dateIn > event.at)) continue;
        const take = Math.min(batch.remaining, left);
        batch.remaining -= take;
        if (event.kind === "sale") batch.sold += take;
        else if (event.kind === "dispose") batch.disposed += take;
        else batch.other += take;
        left -= take;
      }
    }
  }

  return batches
    .map(({ remaining, sold, disposed, other, ...batch }) => {
      const known = batch.originalQuantity !== null;
      const remainingQuantity = known ? Math.max(0, round(remaining)) : null;
      const finished = known && remainingQuantity <= 0;
      const disposedQuantity = round(disposed);
      return {
        ...batch,
        dateReceived: batch.dateIn ? new Date(batch.dateIn) : null,
        remainingQuantity,
        quantity: remainingQuantity,
        soldQuantity: round(sold),
        disposedQuantity,
        otherQuantity: round(other),
        needsQuantity: !known,
        finished,
        finishedBy: finished ? (disposedQuantity > 0 ? "disposed" : "sold-out") : null,
        // Kept for the screens that read it: a finished batch has nothing left to expire
        soldOut: finished,
      };
    })
    .sort((left, right) => (timeOf(left.expiryDate) ?? 0) - (timeOf(right.expiryDate) ?? 0));
}
