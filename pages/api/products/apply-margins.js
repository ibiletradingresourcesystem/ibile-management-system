/**
 * API: POST /api/products/apply-margins
 *
 * Works out the margin of every product that has a cost price and a sale price but no margin,
 * or a margin that no longer matches them. Saving a product from its form sets the margin, but
 * products imported, seeded or changed elsewhere can arrive with the two prices and no margin,
 * so the list showed a blank.
 *
 * Body: { dryRun }
 *   dryRun (default true)  reports what would change without saving
 *
 * Only the margin is written: prices are left exactly as they are. A product without both a cost
 * and a sale price is left alone, because there is nothing to work a margin out from.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { authMiddleware } from "@/lib/auth-middleware";
import { canManageProducts } from "@/lib/permission-utils";
import { calculateMarginPercent, roundMoney } from "@/lib/pricing";

const MAX_SAMPLES = 50;
const BULK_CHUNK = 500;

/** The margin a product should carry, or null when it lacks a cost or a sale price. */
export function expectedMargin(product) {
  const cost = Number(product?.costPrice) || 0;
  const sale = Number(product?.salePriceIncTax) || 0;
  if (cost <= 0 || sale <= 0) return null;
  return roundMoney(calculateMarginPercent(cost, sale));
}

/** No margin stored: blank, or the 0 a new product starts with. */
const isBlankMargin = (margin) => margin === null || margin === undefined || margin === "" || Number(margin) === 0;

/** True when the stored margin is missing or differs from the prices (by a cent or more). */
export function marginNeedsFixing(product) {
  const expected = expectedMargin(product);
  if (expected === null) return false;
  const stored = product?.margin;
  if (stored === null || stored === undefined || stored === "") return true;
  const value = Number(stored);
  return !Number.isFinite(value) || Math.abs(value - expected) >= 0.01;
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!canManageProducts(req.user)) {
    return res.status(403).json({ error: "You do not have permission to change products" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  try {
    const dryRun = req.body?.dryRun !== false;
    const products = await Product.find({ costPrice: { $gt: 0 }, salePriceIncTax: { $gt: 0 } })
      .select("name costPrice salePriceIncTax margin isArchived")
      .lean();

    const toFix = products.filter(marginNeedsFixing);
    const missing = toFix.filter((product) => isBlankMargin(product.margin)).length;
    const samples = toFix.slice(0, MAX_SAMPLES).map((product) => ({
      name: product.name,
      costPrice: Number(product.costPrice) || 0,
      salePrice: Number(product.salePriceIncTax) || 0,
      from: isBlankMargin(product.margin) ? null : Number(product.margin),
      to: expectedMargin(product),
    }));

    if (!dryRun && toFix.length > 0) {
      const ops = toFix.map((product) => ({
        updateOne: { filter: { _id: product._id }, update: { $set: { margin: expectedMargin(product) } } },
      }));
      for (let i = 0; i < ops.length; i += BULK_CHUNK) {
        await Product.bulkWrite(ops.slice(i, i + BULK_CHUNK), { ordered: false });
      }
    }

    return res.status(200).json({
      success: true,
      dryRun,
      summary: {
        scanned: products.length,
        [dryRun ? "toChange" : "changed"]: toFix.length,
        missing,
        outdated: toFix.length - missing,
      },
      samples,
    });
  } catch (err) {
    console.error("Apply margins error:", err.message);
    return res.status(500).json({ error: err.message || "Working out the margins failed" });
  }
}

export const config = { maxDuration: 60 };
