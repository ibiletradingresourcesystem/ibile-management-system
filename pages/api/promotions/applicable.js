import { mongooseConnect } from "@/lib/mongodb";
import Promotion from "@/models/Promotion";
import "@/models/Category";
import "@/models/Product";

/**
 * GET /api/promotions/applicable?customerType=VIP&productId=xxx&categoryId=xxx
 * Get applicable promotions for a customer at the POS
 */
export default async function handler(req, res) {
  const { customerType, productId, categoryId } = req.query;

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    const now = new Date();

    // Find active promotions that:
    // 1. Target this customer type
    // 2. Are within date range
    // 3. Haven't exceeded max uses (if limit exists)
    const query = {
      active: true,
      targetCustomerTypes: customerType,
      startDate: { $lte: now },
      endDate: { $gte: now },
      $or: [
        { maxUses: null },
        { maxUses: { $exists: false } },
        { $expr: { $lt: ["$timesUsed", "$maxUses"] } },
      ],
    };

    let promotions = await Promotion.find(query)
      .populate("products", "name")
      .populate("categories", "name")
      .lean();

    // Filter by product or category scope
    if (productId || categoryId) {
      promotions = promotions.filter((promo) => {
        if (promo.applicationType === "ALL_PRODUCTS") {
          return true;
        }
        if (promo.applicationType === "ONE_PRODUCT" && productId) {
          return promo.products?.some((p) => p._id.toString() === productId);
        }
        if (promo.applicationType === "CATEGORY" && categoryId) {
          return promo.categories?.some((c) => c._id.toString() === categoryId);
        }
        return false;
      });
    }

    console.log(
      `Found ${promotions.length} applicable promotions for ${customerType}${productId ? ` on product ${productId}` : ""}${categoryId ? ` in category ${categoryId}` : ""}`
    );

    return res.status(200).json({
      success: true,
      promotions,
      count: promotions.length,
    });
  } catch (error) {
    console.error("Error fetching applicable promotions:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch promotions",
    });
  }
}
