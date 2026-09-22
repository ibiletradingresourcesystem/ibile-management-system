/**
 * API Endpoint: GET /api/products/price-changed
 * 
 * Returns products whose salePriceIncTax was updated within the given date range.
 * Uses the updatedAt timestamp as a proxy for recent price edits.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

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
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Find products updated within the date range that have a sale price set.
    // No cap: the old limit of 200 silently dropped the rest after a big price update.
    const products = await Product.find({
      updatedAt: { $gte: since },
      salePriceIncTax: { $gt: 0 },
      isChildProduct: { $ne: true },
      isArchived: { $ne: true },
    })
      .select("_id name salePriceIncTax costPrice barcode category quantity qtyPerPack packType updatedAt")
      .sort({ updatedAt: -1 })
      .lean();

    return res.status(200).json({ products });
  } catch (err) {
    console.error("Price-changed products fetch error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
