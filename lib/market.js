/**
 * Market buying: what the store buys in person at a market, from market vendors grouped by the
 * section of the market they trade in.
 *
 * There is always one open "next market list". Anyone adds to it: a product with a market vendor
 * lands under that vendor, one without waits for a vendor to be picked, and anything not in the
 * system goes on as an "other" item to be made a product once bought. Products from market vendors
 * that fall to their minimum stock are added by themselves — unless a supplier vendor already has
 * them on order — and taken off again when that stops being true. Generating the list closes it
 * (for one market, or all) and the next one starts empty; only the latest KEEP_LISTS are kept.
 */
import mongoose from "mongoose";
import Market from "@/models/Market";
import MarketVendor from "@/models/MarketVendor";
import MarketList from "@/models/MarketList";
import MarketListItem from "@/models/MarketListItem";
import Product from "@/models/Product";
import StockOrder from "@/models/StockOrder";
import PurchaseOrder from "@/models/PurchaseOrder";

/** Generated lists kept; older ones are deleted with their items. */
export const KEEP_LISTS = 4;
/** A product on a list generated this recently is not put back for being low on stock. */
export const RECENT_LIST_DAYS = 7;
/** A purchase order this old and still not received no longer counts as "on order". */
const PURCHASE_ORDER_DAYS = 30;

const idOf = (value) => (value ? String(value._id || value) : "");
const isId = (value) => mongoose.isValidObjectId(value);
const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));

export class MarketError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/* -------------------------------------------------------------- vendors */

/**
 * The market vendor for each product: the one marked favourite for it, otherwise the first by name.
 * Returns Map(productId -> { vendor, line }).
 */
export function vendorsByProduct(vendors = []) {
  const map = new Map();
  for (const vendor of [...vendors].filter((v) => v.isActive !== false).sort(byName)) {
    for (const line of vendor.products || []) {
      const key = idOf(line.product);
      if (!key) continue;
      const current = map.get(key);
      if (!current || (line.favourite && !current.line.favourite)) map.set(key, { vendor, line });
    }
  }
  return map;
}

async function activeVendors() {
  return MarketVendor.find({ isActive: { $ne: false } }).lean();
}

/**
 * Puts a product on a vendor's list (if it is not there yet) and, when asked, makes that vendor
 * its favourite: the one it goes to on the next list.
 */
export async function linkProductToVendor({ vendorId, productId, productName = "", unit = "", favourite = false }) {
  if (!isId(vendorId) || !isId(productId)) return;
  const vendor = await MarketVendor.findById(vendorId);
  if (!vendor) throw new MarketError("That market vendor was not found", 404);
  const line = vendor.products.find((entry) => idOf(entry.product) === String(productId));
  if (line) {
    if (favourite) line.favourite = true;
  } else {
    vendor.products.push({ product: productId, productName, unit, unitSize: 1, favourite });
  }
  await vendor.save();
  if (favourite) {
    await MarketVendor.updateMany(
      { _id: { $ne: vendor._id }, "products.product": productId },
      { $set: { "products.$[line].favourite": false } },
      { arrayFilters: [{ "line.product": new mongoose.Types.ObjectId(String(productId)) }] }
    );
  }
}

/* -------------------------------------------------------------- supplier orders */

/**
 * Products a supplier vendor already has on order: stock orders not yet received, and purchase
 * orders being received. Map(productId -> supplier name).
 */
export async function productsOnSupplierOrder() {
  const since = new Date(Date.now() - PURCHASE_ORDER_DAYS * 24 * 60 * 60 * 1000);
  const [orders, purchaseOrders] = await Promise.all([
    StockOrder.find({
      $or: [{ stage: "Submitted" }, { stage: { $exists: false }, reason: { $not: /^\s*stock received\s*$/i } }],
    })
      .select("supplier products.productId")
      .lean(),
    PurchaseOrder.find({ receivedStatus: { $ne: "Received" }, createdAt: { $gte: since } })
      .select("vendorName products.productId")
      .lean(),
  ]);
  const map = new Map();
  for (const order of orders) {
    for (const line of order.products || []) if (line.productId) map.set(String(line.productId), order.supplier || "a supplier");
  }
  for (const order of purchaseOrders) {
    for (const line of order.products || []) if (line.productId) map.set(String(line.productId), order.vendorName || "a supplier");
  }
  return map;
}

/* -------------------------------------------------------------- adding */

const cleanQuantity = (value, fallback = 1) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : fallback;
};

/**
 * Adds to the next market list. A product already on it gets the quantity added; a product removed
 * from it earlier comes back with this quantity.
 */
export async function addItem({ productId, name, quantity, unit, note, marketId, vendorId, addedBy = "" }) {
  const qty = cleanQuantity(quantity);
  const markets = await Market.find({}).select("_id").lean();
  const onlyMarket = markets.length === 1 ? markets[0]._id : null;

  if (!productId) {
    const text = String(name || "").trim();
    if (!text) throw new MarketError("Type what to buy");
    let vendor = null;
    if (isId(vendorId)) vendor = await MarketVendor.findById(vendorId).select("market").lean();
    return MarketListItem.create({
      name: text.slice(0, 120),
      quantity: qty,
      unit: String(unit || "").trim().slice(0, 30),
      note: String(note || "").trim().slice(0, 200),
      vendor: vendor?._id || null,
      market: vendor?.market || (isId(marketId) ? marketId : onlyMarket),
      addedBy,
    });
  }

  if (!isId(productId)) throw new MarketError("That product was not found", 404);
  const product = await Product.findById(productId).select("name").lean();
  if (!product) throw new MarketError("That product was not found", 404);

  let placement = null;
  if (isId(vendorId)) {
    const vendor = await MarketVendor.findById(vendorId).lean();
    if (vendor) placement = { vendor, line: (vendor.products || []).find((l) => idOf(l.product) === String(productId)) || null };
  }
  if (!placement) placement = vendorsByProduct(await activeVendors()).get(String(productId)) || null;

  // A person asked for it: it is theirs now, not the low-stock check's to take off again
  const touch = {
    source: "staff",
    ...(note ? { note: String(note).trim().slice(0, 200) } : {}),
    ...(addedBy ? { addedBy } : {}),
  };
  // Removed from this list earlier: back with this quantity
  const revived = await MarketListItem.findOneAndUpdate(
    { open: true, product: productId, dismissed: true },
    { $set: { ...touch, dismissed: false, quantity: qty } },
    { new: true }
  );
  if (revived) return revived;
  // Already on it: one line, the quantities added in the database itself, so two people adding
  // at the same moment both count
  const raised = await MarketListItem.findOneAndUpdate(
    { open: true, product: productId },
    { $inc: { quantity: qty }, $set: touch },
    { new: true }
  );
  if (raised) return raised;

  try {
    return await MarketListItem.create({
      product: product._id,
      name: product.name,
      quantity: qty,
      unit: String(unit || placement?.line?.unit || "").trim().slice(0, 30),
      note: String(note || "").trim().slice(0, 200),
      vendor: placement?.vendor?._id || null,
      market: placement?.vendor?.market || (isId(marketId) ? marketId : onlyMarket),
      addedBy,
    });
  } catch (error) {
    // Someone added the same product a moment ago: add to theirs
    if (error?.code !== 11000) throw error;
    return MarketListItem.findOneAndUpdate({ open: true, product: productId }, { $inc: { quantity: qty }, $set: touch }, { new: true });
  }
}

/* -------------------------------------------------------------- low stock */

/** How much to buy, in the vendor's unit: enough to bring stock back to twice its minimum. */
export function suggestedQuantity(product, line) {
  const needed = Math.max(Number(product.minStock || 0) * 2 - Number(product.quantity || 0), 1);
  const size = Number(line?.unitSize) > 0 ? Number(line.unitSize) : 1;
  return Math.max(1, Math.ceil(needed / size));
}

/**
 * Brings the next list's low-stock items up to date: products from market vendors at or below
 * their minimum stock are added, and ones added this way that are no longer low, or that a supplier
 * vendor now has on order, are taken off again. Items a person added or changed are never touched,
 * and an item a person removed is not put back while this list is open.
 *
 * `marketId` limits it to one market; `force` adds even where a market has it turned off.
 */
export async function refreshLowStock({ marketId = null, force = false } = {}) {
  const markets = await Market.find(marketId ? { _id: marketId } : {}).lean();
  const eligible = new Set(markets.filter((m) => force || m.autoAddLowStock !== false).map((m) => String(m._id)));
  // Every product's market vendor; turning a market's automatic adding off stops new items only,
  // so whether an item already added is still wanted does not depend on it
  const allPlacements = vendorsByProduct(await activeVendors());
  const placements = new Map([...allPlacements].filter(([, placement]) => eligible.has(idOf(placement.vendor.market))));

  const lowStockItems = await MarketListItem.find({ open: true, source: "low-stock", dismissed: false }).lean();
  if (placements.size === 0 && lowStockItems.length === 0) return { added: 0, removed: 0 };

  const productIds = [...new Set([...placements.keys(), ...lowStockItems.map((item) => idOf(item.product))])].filter(isId);
  const recentLists = await MarketList.find({ createdAt: { $gte: new Date(Date.now() - RECENT_LIST_DAYS * 86400000) } }).select("_id").lean();
  const [products, onOrder, openItems, recentItems] = await Promise.all([
    Product.find({ _id: { $in: productIds } }).select("name quantity minStock isArchived isStockManaged").lean(),
    productsOnSupplierOrder(),
    MarketListItem.find({ open: true, product: { $in: productIds } }).select("product").lean(),
    recentLists.length
      ? MarketListItem.find({ list: { $in: recentLists.map((l) => l._id) }, product: { $in: productIds }, status: { $ne: "unavailable" } })
          .select("product")
          .lean()
      : [],
  ]);

  const isLow = (product) =>
    product &&
    !product.isArchived &&
    product.isStockManaged !== false &&
    Number(product.minStock) > 0 &&
    Number(product.quantity || 0) <= Number(product.minStock);
  const productById = new Map(products.map((p) => [String(p._id), p]));
  const onList = new Set(openItems.map((item) => idOf(item.product)));
  const recentlyListed = new Set(recentItems.map((item) => idOf(item.product)));

  let removed = 0;
  for (const item of lowStockItems) {
    const key = idOf(item.product);
    const stillWanted = isLow(productById.get(key)) && !onOrder.has(key) && allPlacements.has(key);
    if (!stillWanted) {
      await MarketListItem.deleteOne({ _id: item._id, source: "low-stock" });
      removed += 1;
    }
  }

  let added = 0;
  for (const [productId, placement] of placements) {
    const product = productById.get(productId);
    if (!isLow(product) || onList.has(productId) || onOrder.has(productId) || recentlyListed.has(productId)) continue;
    try {
      await MarketListItem.create({
        product: product._id,
        name: product.name,
        quantity: suggestedQuantity(product, placement.line),
        unit: placement.line?.unit || "",
        vendor: placement.vendor._id,
        market: placement.vendor.market,
        source: "low-stock",
        addedBy: "Low stock",
      });
      added += 1;
    } catch (error) {
      if (error?.code !== 11000) throw error; // added by someone else meanwhile
    }
  }
  return { added, removed };
}

/* -------------------------------------------------------------- generating */

/** Closes the next list for one market (and the items not tied to any market), or for all. */
export async function generateList({ marketId = null, generatedBy = "" } = {}) {
  let market = null;
  if (marketId) {
    if (!isId(marketId)) throw new MarketError("That market was not found", 404);
    market = await Market.findById(marketId).lean();
    if (!market) throw new MarketError("That market was not found", 404);
  }
  const scope = market ? { $or: [{ market: market._id }, { market: null }] } : {};
  const filter = { open: true, dismissed: false, ...scope };
  if ((await MarketListItem.countDocuments(filter)) === 0) {
    throw new MarketError(market ? `Nothing on the list for ${market.name} yet` : "Nothing on the list yet");
  }

  const latest = await MarketList.findOne({}).sort({ number: -1 }).select("number").lean();
  const list = await MarketList.create({
    number: (latest?.number || 0) + 1,
    market: market?._id || null,
    marketName: market?.name || "",
    generatedBy,
  });
  await MarketListItem.updateMany(filter, { $set: { open: false, list: list._id, status: "pending" } });
  list.itemCount = await MarketListItem.countDocuments({ list: list._id });
  await list.save();

  // Removed items only mattered to the list that just closed
  await MarketListItem.deleteMany({ open: true, dismissed: true, ...scope });
  await pruneLists();
  return list;
}

/** Keeps the latest KEEP_LISTS generated lists; older ones go, with their items. */
export async function pruneLists() {
  const old = await MarketList.find({}).sort({ createdAt: -1, number: -1 }).skip(KEEP_LISTS).select("_id").lean();
  if (!old.length) return 0;
  const ids = old.map((list) => list._id);
  await MarketListItem.deleteMany({ list: { $in: ids } });
  await MarketList.deleteMany({ _id: { $in: ids } });
  return ids.length;
}

/** Puts what was not bought on a generated list back on the next one. */
export async function carryOver({ listId, addedBy = "" }) {
  if (!isId(listId)) throw new MarketError("That market list was not found", 404);
  const items = await MarketListItem.find({ list: listId, status: { $ne: "bought" } }).lean();
  for (const item of items) {
    await addItem({
      productId: item.product ? String(item.product) : null,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      note: item.note,
      marketId: item.market ? String(item.market) : null,
      vendorId: item.vendor ? String(item.vendor) : null,
      addedBy,
    });
  }
  return items.length;
}

/* -------------------------------------------------------------- reading */

/**
 * Items with what the page shows beside them: vendor, section and market names, and the supplier
 * that already has the product on order.
 */
export async function describeItems(items, { onOrder = null } = {}) {
  const [markets, vendors] = await Promise.all([Market.find({}).lean(), MarketVendor.find({}).lean()]);
  const marketById = new Map(markets.map((m) => [String(m._id), m]));
  const vendorById = new Map(vendors.map((v) => [String(v._id), v]));
  return items.map((item) => {
    const vendor = vendorById.get(idOf(item.vendor)) || null;
    const market = marketById.get(idOf(item.market)) || marketById.get(idOf(vendor?.market)) || null;
    const section = (market?.sections || []).find((s) => idOf(s._id) === idOf(vendor?.section)) || null;
    const line = vendor ? (vendor.products || []).find((l) => idOf(l.product) === idOf(item.product)) : null;
    return {
      ...item,
      _id: idOf(item._id),
      product: item.product ? idOf(item.product) : null,
      vendor: vendor ? idOf(vendor._id) : null,
      vendorName: vendor?.name || "",
      market: market ? idOf(market._id) : null,
      marketName: market?.name || "",
      section: section ? idOf(section._id) : null,
      sectionName: section?.name || "",
      sectionOrder: section ? Number(section.order || 0) : 9999,
      lastPrice: Number(line?.lastPrice || 0),
      onSupplierOrder: onOrder && item.product ? onOrder.get(idOf(item.product)) || "" : "",
    };
  });
}
