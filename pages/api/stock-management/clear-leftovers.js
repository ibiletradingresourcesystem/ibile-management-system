/**
 * Sets leftover fractions to 0: stored stock that is not 0 but is less than a thousandth of a
 * single unit, left behind by adding up fractions of a pack (a stock take that added back
 * 1.291667 cartons to −1.2916666…). The stock page already counts them as 0; the till and the web
 * shop read the stored figure, so a carton at 0.0000003 could still look available there.
 *
 * POST → { cleared, message }. Admin only (lib/apiAccess.js).
 */
import { mongooseConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { authMiddleware, isAdmin } from "@/lib/auth-middleware";
import { isDerivedChild, isLeftoverFraction, isPackProduct } from "@/lib/packUnits";
import { deriveChildrenForParent } from "@/lib/syncPackQty";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isAdmin(req)) return res.status(403).json({ success: false, message: "Admin access required" });
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    // Every leftover is within a thousandth of 0, whatever the pack size
    const candidates = await Product.find({ quantity: { $gt: -0.001, $lt: 0.001, $ne: 0 } })
      .select("_id quantity packType qtyPerPack isChildProduct parentProduct")
      .lean();
    // A child's figure comes from its parent, which is put right below
    const leftovers = candidates.filter((product) => !isDerivedChild(product) && isLeftoverFraction(product));
    if (leftovers.length === 0) {
      return res.status(200).json({ success: true, cleared: 0, message: "There are no leftover fractions to clear" });
    }

    // Each only while it still holds the figure read, so a sale at that moment is not overwritten
    const result = await Product.bulkWrite(
      leftovers.map((product) => ({
        updateOne: { filter: { _id: product._id, quantity: product.quantity }, update: { $set: { quantity: 0 } } },
      }))
    );
    for (const product of leftovers) {
      if (isPackProduct(product)) await deriveChildrenForParent(product._id);
    }

    const cleared = result.modifiedCount || 0;
    return res.status(200).json({
      success: true,
      cleared,
      message: `${cleared} product${cleared === 1 ? "" : "s"} set to exactly 0`,
    });
  } catch (error) {
    console.error("Clear leftovers error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
}
