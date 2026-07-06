import Product from "@/models/Product";
import Category from "@/models/Category";
import StockMovement from "@/models/StockMovement";
import Transaction from "@/models/Transactions";
import { mongooseConnect, withRetry } from "@/lib/mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { buildLocationCache, getAllLocations } from "@/lib/serverLocationHelper";
import { getDateTimeParts, parseDateKey } from "@/lib/dateFilter";

const VALID_PERIODS = new Set(["monthly", "daily", "hourly", "half-hourly"]);

function normalizeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getProductId(product) {
  return String(product?._id || product?.id || "");
}

function isDerivedChild(product) {
  return Boolean(product?.isChildProduct && product?.packType !== "pack");
}

function toDateFromKey(value, endOfDay = false) {
  const parsed = parseDateKey(value);
  if (!parsed) return null;
  return new Date(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0
  );
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDefaultRange() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return {
    startDate: formatDateKey(monthStart),
    endDate: formatDateKey(today),
  };
}

function getBucketInfo(value, period) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = getDateTimeParts(date);
  if (!parts) return null;

  const hour = String(parts.hour).padStart(2, "0");
  const minute = Number(parts.minute || 0) < 30 ? "00" : "30";
  const monthKey = `${parts.year}-${parts.month}`;

  if (period === "monthly") {
    return {
      key: monthKey,
      label: new Date(Number(parts.year), Number(parts.month) - 1, 1).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      }),
      sort: `${monthKey}-01T00:00:00.000Z`,
    };
  }

  if (period === "daily") {
    return {
      key: parts.dateKey,
      label: parts.dateKey,
      sort: `${parts.dateKey}T00:00:00.000Z`,
    };
  }

  if (period === "hourly") {
    return {
      key: `${parts.dateKey} ${hour}:00`,
      label: `${parts.dateKey} ${hour}:00`,
      sort: `${parts.dateKey}T${hour}:00:00.000Z`,
    };
  }

  return {
    key: `${parts.dateKey} ${hour}:${minute}`,
    label: `${parts.dateKey} ${hour}:${minute}`,
    sort: `${parts.dateKey}T${hour}:${minute}:00.000Z`,
  };
}

function getMovementDate(movement) {
  return movement?.dateReceived || movement?.dateSent || movement?.createdAt || new Date();
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

function roundQty(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function addMapQuantity(map, key, quantity) {
  map.set(key, roundQty((map.get(key) || 0) + Number(quantity || 0)));
}

function normalizeCategoryValue(value) {
  const text = String(value || "").trim();
  return text || "Uncategorized";
}

function buildCategoryMaps(categories = []) {
  const byId = new Map();
  const byName = new Map();

  categories.forEach((category) => {
    const id = String(category?._id || "").trim();
    const name = String(category?.name || "").trim();
    if (!name) return;
    if (id) byId.set(id, name);
    byName.set(normalizeValue(name), name);
  });

  return { byId, byName };
}

function getCategoryLabel(value, categoryMaps) {
  const categoryValue = normalizeCategoryValue(value);
  const byId = categoryMaps.byId.get(categoryValue);
  if (byId) return byId;
  const byName = categoryMaps.byName.get(normalizeValue(categoryValue));
  return byName || categoryValue;
}

function buildCategoryOptions(products, categoryMaps) {
  const options = new Map();

  products
    .filter((product) => !isDerivedChild(product))
    .forEach((product) => {
      const value = normalizeCategoryValue(product.category);
      if (!options.has(value)) {
        options.set(value, {
          value,
          label: getCategoryLabel(value, categoryMaps),
        });
      }
    });

  return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label));
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

    const defaults = getDefaultRange();
    const period = VALID_PERIODS.has(req.query.period) ? req.query.period : "daily";
    const startDateKey = parseDateKey(req.query.startDate)?.key || defaults.startDate;
    const endDateKey = parseDateKey(req.query.endDate)?.key || defaults.endDate;
    const startDate = toDateFromKey(startDateKey);
    const endDate = toDateFromKey(endDateKey, true);

    if (!startDate || !endDate || startDate > endDate) {
      return res.status(400).json({ success: false, message: "Invalid date range" });
    }

    const locationFilter = normalizeValue(req.query.location);
    const categoryFilter = normalizeValue(req.query.category);
    const productIdFilter = String(req.query.productId || "").trim();
    const searchFilter = normalizeValue(req.query.search);

    const [locationCache, storeLocations, categories, products, movements, transactions] = await withRetry(async () => Promise.all([
      buildLocationCache(),
      getAllLocations(),
      Category.find({}).select("_id name").lean(),
      Product.find({
        isArchived: { $ne: true },
        isStockManaged: true,
        productType: { $ne: "room" },
      })
        .select("name barcode category costPrice salePriceIncTax isChildProduct parentProduct packType qtyPerPack")
        .sort({ name: 1 })
        .lean(),
      StockMovement.find({
        status: "Received",
        $or: [
          { dateReceived: { $lte: endDate } },
          { dateReceived: null, dateSent: { $lte: endDate } },
          { dateReceived: { $exists: false }, dateSent: { $lte: endDate } },
          { createdAt: { $lte: endDate } },
        ],
      })
        .select("fromLocationId toLocationId reason products dateReceived dateSent createdAt")
        .lean(),
      Transaction.find({
        createdAt: { $lte: endDate },
        status: { $in: ["completed", "refunded", "credit"] },
      })
        .select("location status subStatus items createdAt")
        .lean(),
    ]));

    const categoryMaps = buildCategoryMaps(categories);
    const productMap = new Map(products.map((product) => [getProductId(product), product]));
    const filteredProductIds = new Set(
      products
        .filter((product) => {
          if (isDerivedChild(product)) return false;
          const id = getProductId(product);
          if (productIdFilter && id !== productIdFilter) return false;
          if (categoryFilter) {
            const productCategoryValue = normalizeValue(product.category);
            const productCategoryLabel = normalizeValue(getCategoryLabel(product.category, categoryMaps));
            if (productCategoryValue !== categoryFilter && productCategoryLabel !== categoryFilter) return false;
          }
          if (searchFilter) {
            const haystack = `${product.name || ""} ${product.barcode || ""}`.toLowerCase();
            if (!haystack.includes(searchFilter)) return false;
          }
          return true;
        })
        .map(getProductId)
    );

    const events = [];
    const locationNames = new Set(
      (Array.isArray(storeLocations) ? storeLocations : [])
        .map((location) => String(location?.name || "").trim())
        .filter(Boolean)
    );

    const pushEvent = ({ productId, quantity, date, locationName, sourceType, movementType }) => {
      if (!productId || !filteredProductIds.has(productId)) return;
      const normalizedLocation = normalizeValue(locationName);
      if (locationFilter && normalizedLocation !== locationFilter) return;
      const eventDate = date instanceof Date ? date : new Date(date);
      if (Number.isNaN(eventDate.getTime()) || eventDate > endDate) return;
      events.push({
        productId,
        quantity: Number(quantity || 0),
        date: eventDate,
        locationName: String(locationName || "Unassigned"),
        sourceType,
        movementType,
      });
    };

    movements.forEach((movement) => {
      const fromLocationName = getMovementLocationLabel(movement.fromLocationId, locationCache);
      const toLocationName = getMovementLocationLabel(movement.toLocationId, locationCache);
      const date = getMovementDate(movement);

      (Array.isArray(movement.products) ? movement.products : []).forEach((item) => {
        const rawQuantity = Number(item?.quantity || 0);
        if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) return;
        const resolved = resolveStockProductDelta(productMap, item.productId, rawQuantity);
        if (!resolved?.productId) return;

        if (movement.reason === "Restock") {
          pushEvent({ productId: resolved.productId, quantity: resolved.quantity, date, locationName: toLocationName, sourceType: "movement", movementType: "restock" });
        } else if (movement.reason === "Transfer") {
          pushEvent({ productId: resolved.productId, quantity: -resolved.quantity, date, locationName: fromLocationName, sourceType: "movement", movementType: "transfer_out" });
          pushEvent({ productId: resolved.productId, quantity: resolved.quantity, date, locationName: toLocationName, sourceType: "movement", movementType: "transfer_in" });
        } else if (["Return", "Adjustment", "Operational Loss"].includes(movement.reason)) {
          pushEvent({ productId: resolved.productId, quantity: -resolved.quantity, date, locationName: fromLocationName, sourceType: "movement", movementType: normalizeValue(movement.reason).replace(/\s+/g, "_") });
        }
      });
    });

    transactions.forEach((transaction) => {
      if (transaction.subStatus === "void") return;
      const locationName = getTransactionLocationLabel(transaction);
      const sign = transaction.status === "refunded" ? 1 : -1;
      const movementType = transaction.status === "refunded" ? "refund" : transaction.status === "credit" ? "credit_sale" : "sale";

      (Array.isArray(transaction.items) ? transaction.items : []).forEach((item) => {
        const quantity = getItemQuantity(item);
        if (quantity <= 0) return;
        const resolved = resolveStockProductDelta(productMap, item.productId, quantity);
        if (!resolved?.productId) return;
        pushEvent({
          productId: resolved.productId,
          quantity: sign * resolved.quantity,
          date: transaction.createdAt,
          locationName,
          sourceType: "transaction",
          movementType,
        });
      });
    });

    const openingState = new Map();
    const inRangeEvents = [];

    events.forEach((event) => {
      if (event.date < startDate) {
        addMapQuantity(openingState, event.productId, event.quantity);
      } else {
        inRangeEvents.push(event);
      }
    });

    inRangeEvents.sort((left, right) => left.date - right.date);
    const runningState = new Map(openingState);
    const rowsByKey = new Map();

    inRangeEvents.forEach((event) => {
      const bucket = getBucketInfo(event.date, period);
      if (!bucket) return;
      const product = productMap.get(event.productId) || {};
      const rowKey = `${bucket.key}::${event.productId}`;
      const current = Number(runningState.get(event.productId) || 0);

      if (!rowsByKey.has(rowKey)) {
        rowsByKey.set(rowKey, {
          key: rowKey,
          period: bucket.key,
          periodLabel: bucket.label,
          sort: bucket.sort,
          productId: event.productId,
          productName: product.name || "Unknown product",
          barcode: product.barcode || "",
          category: getCategoryLabel(product.category, categoryMaps),
          location: locationFilter ? event.locationName : "All locations",
          openingStock: roundQty(current),
          stockIn: 0,
          stockOut: 0,
          transferIn: 0,
          transferOut: 0,
          paidUnitsSold: 0,
          creditUnitsSold: 0,
          refundedUnits: 0,
          adjustments: 0,
          closingStock: roundQty(current),
          costPrice: Number(product.costPrice || 0),
          salePrice: Number(product.salePriceIncTax || 0),
        });
      }

      const row = rowsByKey.get(rowKey);
      const delta = Number(event.quantity || 0);

      if (delta > 0) {
        row.stockIn = roundQty(row.stockIn + delta);
      } else if (delta < 0) {
        row.stockOut = roundQty(row.stockOut + Math.abs(delta));
      }

      if (event.movementType === "transfer_in") row.transferIn = roundQty(row.transferIn + Math.max(delta, 0));
      if (event.movementType === "transfer_out") row.transferOut = roundQty(row.transferOut + Math.abs(Math.min(delta, 0)));
      if (event.movementType === "sale") row.paidUnitsSold = roundQty(row.paidUnitsSold + Math.abs(delta));
      if (event.movementType === "credit_sale") row.creditUnitsSold = roundQty(row.creditUnitsSold + Math.abs(delta));
      if (event.movementType === "refund") row.refundedUnits = roundQty(row.refundedUnits + Math.max(delta, 0));
      if (["adjustment", "operational_loss", "return"].includes(event.movementType)) {
        row.adjustments = roundQty(row.adjustments + Math.abs(delta));
      }

      const next = roundQty(current + delta);
      runningState.set(event.productId, next);
      row.closingStock = next;
    });

    const rows = Array.from(rowsByKey.values())
      .map((row) => ({
        ...row,
        openingCostValue: roundMoney(row.openingStock * row.costPrice),
        closingCostValue: roundMoney(row.closingStock * row.costPrice),
        openingSaleValue: roundMoney(row.openingStock * row.salePrice),
        closingSaleValue: roundMoney(row.closingStock * row.salePrice),
      }))
      .sort((left, right) => {
        const sortDate = String(right.sort).localeCompare(String(left.sort));
        if (sortDate !== 0) return sortDate;
        return left.productName.localeCompare(right.productName);
      });

    const targetProductIds = Array.from(filteredProductIds);
    const totalOpeningStock = targetProductIds.reduce((sum, id) => sum + Number(openingState.get(id) || 0), 0);
    const totalClosingStock = targetProductIds.reduce((sum, id) => sum + Number(runningState.get(id) || openingState.get(id) || 0), 0);

    // Compute closing values from final runningState per product (not by summing per-bucket rows,
    // which would double-count when a product appears in multiple daily/hourly buckets).
    let totalClosingCostValue = 0;
    let totalClosingSaleValue = 0;
    let totalOpeningCostValue = 0;
    let totalOpeningSaleValue = 0;
    targetProductIds.forEach((id) => {
      const product = productMap.get(id) || {};
      const costPrice = Number(product.costPrice || 0);
      const salePrice = Number(product.salePriceIncTax || 0);
      const closingQty = Number(runningState.get(id) || openingState.get(id) || 0);
      const openingQty = Number(openingState.get(id) || 0);
      totalClosingCostValue += closingQty * costPrice;
      totalClosingSaleValue += closingQty * salePrice;
      totalOpeningCostValue += openingQty * costPrice;
      totalOpeningSaleValue += openingQty * salePrice;
    });

    const summary = rows.reduce(
      (acc, row) => {
        acc.stockIn += Number(row.stockIn || 0);
        acc.stockOut += Number(row.stockOut || 0);
        acc.paidUnitsSold += Number(row.paidUnitsSold || 0);
        acc.creditUnitsSold += Number(row.creditUnitsSold || 0);
        acc.refundedUnits += Number(row.refundedUnits || 0);
        acc.adjustments += Number(row.adjustments || 0);
        return acc;
      },
      {
        productCount: targetProductIds.length,
        rowCount: rows.length,
        openingStock: roundQty(totalOpeningStock),
        closingStock: roundQty(totalClosingStock),
        stockIn: 0,
        stockOut: 0,
        paidUnitsSold: 0,
        creditUnitsSold: 0,
        refundedUnits: 0,
        adjustments: 0,
        openingCostValue: roundMoney(totalOpeningCostValue),
        openingSaleValue: roundMoney(totalOpeningSaleValue),
        closingCostValue: roundMoney(totalClosingCostValue),
        closingSaleValue: roundMoney(totalClosingSaleValue),
      }
    );

    Object.keys(summary).forEach((key) => {
      if (typeof summary[key] === "number") {
        summary[key] = key.toLowerCase().includes("value") ? roundMoney(summary[key]) : roundQty(summary[key]);
      }
    });

    return res.status(200).json({
      success: true,
      filters: {
        period,
        startDate: startDateKey,
        endDate: endDateKey,
        location: req.query.location || "",
        category: req.query.category || "",
        productId: productIdFilter,
        search: req.query.search || "",
      },
      summary,
      rows,
      totalRows: rows.length,
      products: products
        .filter((product) => !isDerivedChild(product))
        .map((product) => ({
          _id: getProductId(product),
          name: product.name,
          category: getCategoryLabel(product.category, categoryMaps),
          categoryValue: normalizeCategoryValue(product.category),
          barcode: product.barcode || "",
        })),
      categories: buildCategoryOptions(products, categoryMaps),
      locations: Array.from(locationNames).sort((left, right) => left.localeCompare(right)),
    });
  } catch (error) {
    console.error("Stock history levels report failed:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load stock history levels report",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}