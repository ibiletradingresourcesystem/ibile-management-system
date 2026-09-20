/**
 * API: POST /api/products/apply-vat
 *
 * Puts every product in the system on the one VAT rate. Products seeded through the import get
 * VAT automatically, but anything created before that, or added by hand with the VAT box left
 * unticked, sits at 0% — so the same shelf can hold two products taxed differently.
 *
 * Body: { dryRun, includeArchived }
 *   dryRun (default true)          reports what would change without saving
 *   includeArchived (default true) archived products are covered too, so restoring one does not
 *                                  quietly reintroduce a 0% product
 *
 * VAT here is inclusive: it is the share of the sale price that is tax, not an amount added on
 * top. Turning it on therefore leaves the shelf price alone and reduces the profit left after
 * tax. Margin is measured against the sale price and does not move, so it is not recalculated.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { authMiddleware } from "@/lib/auth-middleware";
import { canManageProducts } from "@/lib/permission-utils";
import { VAT_RATE, getPriceBreakdown } from "@/lib/pricing";

const MAX_SAMPLES = 50;
const BULK_CHUNK = 500;

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!canManageProducts(req.user)) {
    return res.status(403).json({ error: "You do not have permission to change product tax rates" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  try {
    const dryRun = req.body?.dryRun !== false;
    const includeArchived = req.body?.includeArchived !== false;

    const filter = includeArchived ? {} : { isArchived: { $ne: true } };
    const products = await Product.find(filter)
      .select("name barcode taxRate costPrice salePriceIncTax isArchived")
      .lean();

    const needsVat = products.filter((product) => Number(product.taxRate) !== VAT_RATE);

    // Split the report so the operator can see the difference between switching VAT on and
    // simply correcting a product still carrying the retired 4.5% rate.
    let turnedOn = 0;
    let corrected = 0;
    let vatDue = 0;
    const samples = [];

    for (const product of needsVat) {
      const current = Number(product.taxRate) || 0;
      if (current > 0) corrected += 1;
      else turnedOn += 1;

      const after = getPriceBreakdown(product.costPrice, product.salePriceIncTax, VAT_RATE);
      vatDue += after.vatAmount;

      if (samples.length < MAX_SAMPLES) {
        samples.push({
          name: product.name,
          from: current,
          to: VAT_RATE,
          salePrice: Number(product.salePriceIncTax) || 0,
          vatAmount: Math.round(after.vatAmount * 100) / 100,
          profitAfterVat: Math.round(after.profitAfterVat * 100) / 100,
          archived: Boolean(product.isArchived),
        });
      }
    }

    if (!dryRun && needsVat.length > 0) {
      const ops = needsVat.map((product) => ({
        updateOne: { filter: { _id: product._id }, update: { $set: { taxRate: VAT_RATE } } },
      }));
      for (let i = 0; i < ops.length; i += BULK_CHUNK) {
        await Product.bulkWrite(ops.slice(i, i + BULK_CHUNK), { ordered: false });
      }
    }

    return res.status(200).json({
      success: true,
      dryRun,
      vatRate: VAT_RATE,
      summary: {
        scanned: products.length,
        alreadyOnVat: products.length - needsVat.length,
        [dryRun ? "toChange" : "changed"]: needsVat.length,
        turnedOn,
        corrected,
        archivedIncluded: includeArchived,
        vatPerSale: Math.round(vatDue * 100) / 100,
      },
      samples,
    });
  } catch (err) {
    console.error("Apply VAT error:", err.message);
    return res.status(500).json({ error: err.message || "Applying VAT failed" });
  }
}

export const config = { maxDuration: 60 };
