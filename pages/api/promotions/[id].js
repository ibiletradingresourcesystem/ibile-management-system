import { mongooseConnect } from "@/lib/mongodb";
import Promotion from "@/models/Promotion";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  const { id } = req.query;

  if (req.method === "PUT") {
    // Update promotion
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

      const promotion = await Promotion.findByIdAndUpdate(
        id,
        {
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
          updatedAt: new Date(),
        },
        { new: true }
      );

      if (!promotion) {
        return res.status(404).json({
          success: false,
          message: "Promotion not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Promotion updated successfully",
        promotion,
      });
    } catch (error) {
      console.error("Error updating promotion:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to update promotion",
      });
    }
  } else if (req.method === "DELETE") {
    // Delete promotion
    try {
      await mongooseConnect();

      const promotion = await Promotion.findByIdAndDelete(id);

      if (!promotion) {
        return res.status(404).json({
          success: false,
          message: "Promotion not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Promotion deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting promotion:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to delete promotion",
      });
    }
  } else {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }
}
