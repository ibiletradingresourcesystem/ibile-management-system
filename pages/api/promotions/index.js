import { mongooseConnect } from "@/lib/mongodb";
import Promotion from "@/models/Promotion";
import "@/models/Category";
import "@/models/Product";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method === "GET") {
    // Get all promotions
    try {
      await mongooseConnect();
      const promotions = await Promotion.find({})
        .populate("products", "name")
        .populate("categories", "name")
        .sort({ createdAt: -1 })
        .lean();
      return res.status(200).json({ success: true, promotions });
    } catch (error) {
      console.error("Error fetching promotions:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch promotions" });
    }
  } else if (req.method === "POST") {
    // Create new promotion
    try {
      await mongooseConnect();

      const {
        name,
        description,
        targetCustomerTypes,
        valueType,
        discountType,
        discountValue,
        applicationType,
        products,
        categories,
        startDate,
        endDate,
        indefinite,
        active,
        maxUses,
        displayAbovePrice,
        priority,
      } = req.body;

      // Validation: name and customer types required, startDate only required if not indefinite
      if (!name || !targetCustomerTypes || targetCustomerTypes.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields (name, targetCustomerTypes)",
        });
      }

      // If not indefinite, startDate is required
      if (!indefinite && !startDate) {
        return res.status(400).json({
          success: false,
          message: "startDate is required (or mark as indefinite)",
        });
      }

      const promotion = await Promotion.create({
        name,
        description,
        targetCustomerTypes,
        valueType: valueType || "DISCOUNT",
        discountType,
        discountValue,
        fixedAmountApplyMode: req.body.fixedAmountApplyMode || "PER_ITEM",
        applicationType,
        products: applicationType === "ONE_PRODUCT" ? products : [],
        categories: applicationType === "CATEGORY" ? categories : [],
        startDate: startDate instanceof Date ? startDate : (startDate ? new Date(startDate) : undefined),
        endDate: endDate instanceof Date ? endDate : (endDate ? new Date(endDate) : null),
        indefinite: indefinite === true,
        active,
        maxUses: maxUses ? parseInt(maxUses) : undefined,
        displayAbovePrice: displayAbovePrice !== false,
        priority: priority || 0,
      });

      return res.status(201).json({
        success: true,
        message: "Promotion created successfully",
        promotion,
      });
    } catch (error) {
      console.error("Error creating promotion:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to create promotion",
      });
    }
  } else {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }
}
