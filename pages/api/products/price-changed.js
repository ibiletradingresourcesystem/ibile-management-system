/**
 * API Endpoint: GET /api/products/price-changed?days=7
 *
 * Products whose selling price changed in the last `days` days (or that were added with a price),
 * newest first, each with the price before (`previousSalePrice`, empty for a new product).
 *
 * This used to use `updatedAt`, which every sale, stock move and sync also changes, so nearly the
 * whole catalogue showed as "price changed". `priceChangedAt` is set only when the price itself
 * changes (models/Product.js).
 */
import { mongooseConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { deriveChildQuantity, isDerivedChild } from "@/lib/packUnits";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  try {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Unit products made from a pack are included, as on "All Products": their price changes too
    const products = await Product.find({
      priceChangedAt: { $gte: since },
      salePriceIncTax: { $gt: 0 },
      isArchived: { $ne: true },
    })
      .select("_id name salePriceIncTax previousSalePrice priceChangedAt costPrice barcode category quantity isStockManaged isChildProduct parentProduct qtyPerPack unitsPerChild packType")
      .sort({ priceChangedAt: -1 })
      .lean();

    // Children hold no stock of their own: the count their parent's stock makes
    const children = products.filter(isDerivedChild);
    if (children.length) {
      const parents = await Product.find({ _id: { $in: [...new Set(children.map((p) => String(p.parentProduct)))] } })
        .select("_id quantity qtyPerPack")
        .lean();
      const parentById = new Map(parents.map((p) => [String(p._id), p]));
      for (const child of children) {
        const parent = parentById.get(String(child.parentProduct));
        if (parent) child.quantity = deriveChildQuantity(parent.quantity, parent, child);
      }
    }

    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({ products });
  } catch (err) {
    console.error("Price-changed products fetch error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
