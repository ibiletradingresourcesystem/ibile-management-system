/**
 * API: /api/products/promotions
 *
 *   GET     every product with a promotion, running, scheduled or just ended
 *   PUT     { productIds | category, start, end, promoPrice | percentOff }  set a promotion on them
 *   DELETE  { productIds }  end their promotions
 *
 * The promotions pages used to read /api/products — one page of 100 products, so promotions on
 * the rest never showed — and save by sending the whole product back, which could put back a stock
 * count that had moved since, and (on the add page) the promotion's name in place of the product's.
 * Only the four promotion fields are ever written here.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { isDerivedChild } from "@/lib/packUnits";
import { priceAfterPercentOff, promoPriceProblem, promotionStatus, promotionWindow } from "@/lib/promotions";

const LIST_FIELDS = "name barcode category salePriceIncTax costPrice promoPrice promoStart promoEnd isPromotion isChildProduct parentProduct packType";
/** How many products one request may change. */
const MAX_PRODUCTS = 500;

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ success: false, message: "Insufficient permissions" });

  await mongooseConnect();

  if (req.method === "GET") {
    const products = await Product.find({ isArchived: { $ne: true }, isPromotion: true })
      .select(LIST_FIELDS)
      .sort({ promoStart: -1, name: 1 })
      .lean();
    const now = new Date();
    return res.status(200).json({
      success: true,
      promotions: products.map((product) => ({ ...product, status: promotionStatus(product, now) })),
    });
  }

  if (req.method === "PUT") {
    const { productIds, category, categoryName, start, end, promoPrice, percentOff } = req.body || {};

    const window = promotionWindow(start, end);
    if (!window.start || !window.end) {
      return res.status(400).json({ success: false, message: "Pick a start date and an end date." });
    }
    if (window.end < window.start) {
      return res.status(400).json({ success: false, message: "The end date can't be before the start date." });
    }
    if (window.end < new Date()) {
      return res.status(400).json({ success: false, message: "That end date has already passed." });
    }

    const byPercent = percentOff !== undefined && percentOff !== null && percentOff !== "";
    if (byPercent && !(Number(percentOff) > 0 && Number(percentOff) < 100)) {
      return res.status(400).json({ success: false, message: "The discount must be between 1% and 99%." });
    }
    if (!byPercent && !(Number(promoPrice) > 0)) {
      return res.status(400).json({ success: false, message: "Enter a promo price, or a percentage off." });
    }

    // The products: those picked, plus every product in a category when one was picked
    const ids = Array.isArray(productIds) ? productIds.filter(Boolean).map(String) : [];
    const or = [];
    if (ids.length) or.push({ _id: { $in: ids } });
    // A product stores its category's id (or, on older records, its name)
    if (category) or.push({ category: { $in: [String(category), ...(categoryName ? [String(categoryName)] : [])] } });
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
    for (const product of products) {
      const price = byPercent ? priceAfterPercentOff(product.salePriceIncTax, percentOff) : Math.round(Number(promoPrice) * 100) / 100;
      const problem = promoPriceProblem(product, price);
      if (problem) {
        skipped.push({ _id: product._id, name: product.name, reason: problem });
        continue;
      }
      operations.push({
        updateOne: {
          filter: { _id: product._id },
          update: { $set: { isPromotion: true, promoPrice: price, promoStart: window.start, promoEnd: window.end } },
        },
      });
      updated.push({ _id: product._id, name: product.name, promoPrice: price, linkedToPack: isDerivedChild(product) });
    }

    if (operations.length) await Product.bulkWrite(operations, { ordered: false });

    return res.status(200).json({
      success: updated.length > 0,
      message: updated.length
        ? `Promotion set on ${updated.length} product${updated.length === 1 ? "" : "s"}${skipped.length ? `; ${skipped.length} skipped` : ""}.`
        : "No product could take that promotion.",
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
      { $set: { isPromotion: false, promoPrice: null, promoStart: null, promoEnd: null } }
    );
    return res.status(200).json({ success: true, ended: result.modifiedCount });
  }

  res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
  return res.status(405).json({ success: false, message: "Method not allowed" });
}
