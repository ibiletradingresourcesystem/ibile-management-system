import { mongooseConnect, withRetry } from "@/lib/mongodb";
import Product from "@/models/Product";
import StockMovement from "@/models/StockMovement";
import Transaction from "@/models/Transactions";
import { buildLocationCache } from "@/lib/serverLocationHelper";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

function normalizeLocationValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getProductId(product) {
  return String(product?._id || product?.id || "");
}

function isDerivedChild(product) {
  return Boolean(product?.isChildProduct && product?.packType !== "pack");
}

function getMovementLocationLabel(locationId, locationCache) {
  const key = String(locationId || "").trim();
  if (!key) return "";
  return String(locationCache[key] || key).trim();
}

function getTransactionLocationLabel(transaction) {
  return String(transaction?.location || "online").trim() || "online";
}

function getItemQuantity(item) {
  const quantity = Number(item?.qty ?? item?.quantity ?? 0);
  return Number.isFinite(quantity) ? quantity : 0;
}

function ensureLocationMap(stockByProduct, productId) {
  if (!stockByProduct.has(productId)) {
    stockByProduct.set(productId, new Map());
  }

  return stockByProduct.get(productId);
}

function addLocationQuantity(stockByProduct, productId, locationLabel, quantity) {
  const normalizedLocation = normalizeLocationValue(locationLabel);
  if (!productId || !normalizedLocation || !Number.isFinite(quantity) || quantity === 0) return;

  const locationMap = ensureLocationMap(stockByProduct, productId);
  const existing = locationMap.get(normalizedLocation) || {
    locationName: String(locationLabel || "").trim(),
    quantity: 0,
  };

  existing.quantity += quantity;
  locationMap.set(normalizedLocation, existing);
}

function resolveStockProductDelta(productMap, productId, quantity) {
  const product = productMap.get(String(productId || ""));
  if (!product) return null;

  if (isDerivedChild(product)) {
    const parentId = String(product.parentProduct || "");
    const parent = productMap.get(parentId);
    const unitsPerPack = Number(parent?.qtyPerPack || product.qtyPerPack || 1) || 1;
    return { productId: parentId, quantity: quantity / unitsPerPack };
  }

  return { productId: String(product._id), quantity };
}

function locationStocksFromMap(locationMap) {
  return Array.from((locationMap || new Map()).values())
    .filter((entry) => Math.abs(Number(entry.quantity || 0)) > 0.0001)
    .map((entry) => ({
      locationName: entry.locationName,
      quantity: Math.round(Number(entry.quantity || 0) * 10000) / 10000,
    }))
    .sort((left, right) => left.locationName.localeCompare(right.locationName));
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    const products = await Product.find({
      isArchived: { $ne: true },
      isStockManaged: true,
      productType: { $ne: "room" },
    })
      .select("name quantity minStock maxStock category barcode costPrice salePriceIncTax isStockManaged isChildProduct parentProduct packType qtyPerPack childSalePrice productType roomStatus currentBooking locations")
      .sort({ name: 1 })
      .lean();

    const productMap = new Map(products.map((product) => [getProductId(product), product]));

    const [locationCache, movements, transactions] = await withRetry(async () => Promise.all([
      buildLocationCache(),
      StockMovement.find({ status: "Received" })
        .select("fromLocationId toLocationId reason products dateReceived dateSent")
        .lean(),
      Transaction.find({ status: { $in: ["completed", "refunded", "credit"] } })
        .select("location status subStatus items createdAt")
        .lean(),
    ]));

    const stockByProduct = new Map();

    movements.forEach((movement) => {
      const fromLocationName = getMovementLocationLabel(movement.fromLocationId, locationCache);
      const toLocationName = getMovementLocationLabel(movement.toLocationId, locationCache);

      (Array.isArray(movement.products) ? movement.products : []).forEach((item) => {
        const quantity = Number(item?.quantity || 0);
        if (!Number.isFinite(quantity) || quantity <= 0) return;

        const resolved = resolveStockProductDelta(productMap, item.productId, quantity);
        if (!resolved?.productId) return;

        if (movement.reason === "Restock") {
          addLocationQuantity(stockByProduct, resolved.productId, toLocationName, resolved.quantity);
        } else if (movement.reason === "Transfer") {
          addLocationQuantity(stockByProduct, resolved.productId, fromLocationName, -resolved.quantity);
          addLocationQuantity(stockByProduct, resolved.productId, toLocationName, resolved.quantity);
        } else if (["Return", "Adjustment", "Operational Loss"].includes(movement.reason)) {
          addLocationQuantity(stockByProduct, resolved.productId, fromLocationName, -resolved.quantity);
        }
      });
    });

    transactions.forEach((transaction) => {
      if (transaction.subStatus === "void") return;

      const locationName = getTransactionLocationLabel(transaction);
      const sign = transaction.status === "refunded" ? 1 : -1;

      (Array.isArray(transaction.items) ? transaction.items : []).forEach((item) => {
        const quantity = getItemQuantity(item);
        if (quantity <= 0) return;

        const resolved = resolveStockProductDelta(productMap, item.productId, quantity);
        if (!resolved?.productId) return;

        addLocationQuantity(stockByProduct, resolved.productId, locationName, sign * resolved.quantity);
      });
    });

    products.forEach((product) => {
      if (!isDerivedChild(product)) return;

      const parentId = String(product.parentProduct || "");
      const parent = productMap.get(parentId);
      const parentLocationMap = stockByProduct.get(parentId);
      if (!parent || !parentLocationMap) return;

      const unitsPerPack = Number(parent.qtyPerPack || product.qtyPerPack || 1) || 1;
      const childLocationMap = ensureLocationMap(stockByProduct, getProductId(product));
      parentLocationMap.forEach((entry, locationKey) => {
        childLocationMap.set(locationKey, {
          locationName: entry.locationName,
          quantity: entry.quantity * unitsPerPack,
        });
      });
    });

    const enrichedProducts = products.map((product) => ({
      ...product,
      locationStocks: locationStocksFromMap(stockByProduct.get(getProductId(product))),
    }));

    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    return res.status(200).json({ success: true, data: enrichedProducts });
  } catch (error) {
    console.error("Stock location summary failed:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load location stock",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}
