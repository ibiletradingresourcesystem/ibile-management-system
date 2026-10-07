/**
 * API: /api/products/promotions
 *
 *   GET     every product with a promotion (?productId= for one, to edit it)
 *   PUT     { productIds | category, name, type, buyQty, promoPrice, percent,
 *             start, end, days, customerTypes }                set a promotion on them
 *   DELETE  { productIds }                                      end their promotions
 *
 * A promotion (lib/promotionRules.js) is a name for the receipt, a deal — a promo price each, "buy
 * X for ₦", or "buy X, save %" — when it runs (date and time), on which days, and for which
 * customer types. The till reads it off the product and takes it off the line at the sale.
 *
 * Only the promotion fields are ever written here: the pages used to send the whole product back,
 * which could put back a stock count that had moved, and once renamed products after the promotion.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { isDerivedChild } from "@/lib/packUnits";
import { promotionStatus, promotionWindow } from "@/lib/promotions";
import {
  PROMOTION_CUSTOMER_TYPES,
  PROMOTION_DAYS,
  PROMOTION_TYPES,
  describePromotion,
  promotionOf,
  promotionProblem,
} from "@/lib/promotionRules";

const LIST_FIELDS =
  "name barcode category salePriceIncTax costPrice isPromotion promoName promoType promoBuyQty promoPrice promoPercent " +
  "promoStart promoEnd promoDays promoCustomerTypes isChildProduct parentProduct packType";
/** How many products one request may change. */
const MAX_PRODUCTS = 500;

const withSummary = (product, now) => {
  const promo = promotionOf(product);
  return { ...product, status: promotionStatus(product, now), deal: describePromotion(promo) };
};

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ success: false, message: "Insufficient permissions" });

  await mongooseConnect();
  const now = new Date();

  if (req.method === "GET") {
    if (req.query.productId) {
      const product = await Product.findOne({ _id: String(req.query.productId), isArchived: { $ne: true } })
        .select(LIST_FIELDS)
        .lean()
        .catch(() => null);
      if (!product) return res.status(404).json({ success: false, message: "Product not found" });
      return res.status(200).json({ success: true, product: withSummary(product, now) });
    }

    const products = await Product.find({ isArchived: { $ne: true }, isPromotion: true })
      .select(LIST_FIELDS)
      .sort({ promoStart: -1, name: 1 })
      .lean();
    return res.status(200).json({ success: true, promotions: products.map((product) => withSummary(product, now)) });
  }

  if (req.method === "PUT") {
    const body = req.body || {};
    const type = PROMOTION_TYPES.includes(body.type) ? body.type : "price";
    const name = String(body.name || "").trim().slice(0, 60);
    const buyQty = Math.floor(Number(body.buyQty) || 0);
    const days = Array.isArray(body.days) ? [...new Set(body.days.filter((day) => PROMOTION_DAYS.includes(day)))] : [];
    const customerTypes = Array.isArray(body.customerTypes)
      ? [...new Set(body.customerTypes.map((t) => String(t).toUpperCase()).filter((t) => PROMOTION_CUSTOMER_TYPES.includes(t)))]
      : [];

    if (!name) return res.status(400).json({ success: false, message: "Give the promotion a name: it is printed on the receipt." });
    if (type === "multibuy" && buyQty < 2) {
      return res.status(400).json({ success: false, message: "Buy at least 2 for a \"buy X for ₦\" deal." });
    }
    if (type === "percent" && buyQty < 1) {
      return res.status(400).json({ success: false, message: "Enter how many must be bought to get the discount (1 or more)." });
    }

    const window = promotionWindow(body.start, body.end);
    if (!window.start || !window.end) {
      return res.status(400).json({ success: false, message: "Pick when the promotion starts and ends." });
    }
    if (window.end <= window.start) {
      return res.status(400).json({ success: false, message: "The promotion must end after it starts." });
    }
    if (window.end < now) {
      return res.status(400).json({ success: false, message: "That end has already passed." });
    }
    // Every day ticked is the same as none: it runs every day
    const storedDays = days.length === PROMOTION_DAYS.length ? [] : days;

    const fields = {
      isPromotion: true,
      promoName: name,
      promoType: type,
      promoBuyQty: type === "price" ? 1 : buyQty,
      promoPrice: type === "percent" ? null : Math.round((Number(body.promoPrice) || 0) * 100) / 100,
      promoPercent: type === "percent" ? Number(body.percent) || 0 : null,
      promoStart: window.start,
      promoEnd: window.end,
      promoDays: storedDays,
      promoCustomerTypes: customerTypes,
    };

    // The products: those picked, plus every product in a category when one was picked
    const ids = Array.isArray(body.productIds) ? body.productIds.filter(Boolean).map(String) : [];
    const or = [];
    if (ids.length) or.push({ _id: { $in: ids } });
    // A product stores its category's id (or, on older records, its name)
    if (body.category) {
      or.push({ category: { $in: [String(body.category), ...(body.categoryName ? [String(body.categoryName)] : [])] } });
    }
    if (or.length === 0) return res.status(400).json({ success: false, message: "Pick at least one product." });

    const products = await Product.find({ isArchived: { $ne: true }, $or: or })
      .select("name salePriceIncTax isChildProduct parentProduct packType")
      .limit(MAX_PRODUCTS + 1)
      .lean();
    if (products.length > MAX_PRODUCTS) {
      return res.status(400).json({ success: false, message: `That is more than ${MAX_PRODUCTS} products at once. Pick fewer.` });
    }

    const updated = [];
    const skipped = [];
    const operations = [];
    const promo = promotionOf(fields);
    for (const product of products) {
      const problem = promotionProblem(promo, product.salePriceIncTax);
      if (problem) {
        skipped.push({ _id: product._id, name: product.name, reason: problem });
        continue;
      }
      operations.push({ updateOne: { filter: { _id: product._id }, update: { $set: fields } } });
      updated.push({ _id: product._id, name: product.name, linkedToPack: isDerivedChild(product) });
    }

    if (operations.length) await Product.bulkWrite(operations, { ordered: false });

    return res.status(200).json({
      success: updated.length > 0,
      message: updated.length
        ? `"${name}" is set on ${updated.length} product${updated.length === 1 ? "" : "s"}${skipped.length ? `; ${skipped.length} skipped` : ""}.`
        : "No product could take that promotion.",
      deal: describePromotion(promo),
      updated,
      skipped,
      start: window.start,
      end: window.end,
    });
  }

  if (req.method === "DELETE") {
    const ids = Array.isArray(req.body?.productIds) ? req.body.productIds.filter(Boolean).map(String) : [];
    if (ids.length === 0) return res.status(400).json({ success: false, message: "Pick the promotions to end." });
    const result = await Product.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          isPromotion: false,
          promoPrice: null,
          promoStart: null,
          promoEnd: null,
          promoName: "",
          promoType: "price",
          promoBuyQty: 1,
          promoPercent: null,
          promoDays: [],
          promoCustomerTypes: [],
        },
      }
    );
    return res.status(200).json({ success: true, ended: result.modifiedCount });
  }

  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  return res.status(405).json({ success: false, message: "Method not allowed" });
}
