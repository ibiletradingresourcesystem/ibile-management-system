// pages/api/expenses/[id].js
import { mongooseConnect } from "@/lib/mongodb";
import Expense from "@/models/Expense";

export default async function handler(req, res) {
  await mongooseConnect();

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Expense ID is required",
    });
  }

  try {
    /* ---------------- GET SINGLE EXPENSE ---------------- */
    if (req.method === "GET") {
      const expense = await Expense.findById(id).lean();

      if (!expense) {
        return res.status(404).json({
          success: false,
          message: "Expense not found",
        });
      }

      return res.status(200).json({
        success: true,
        expense,
      });
    }

    /* ---------------- UPDATE EXPENSE ---------------- */
    if (req.method === "PUT") {
      const {
        title,
        amount,
        categoryId,
        categoryName,
        description,
        locationId,
        locationName,
        staffId,
        staffName,
        assetId,
        assetName,
      } = req.body;

      const expense = await Expense.findById(id);

      if (!expense) {
        return res.status(404).json({
          success: false,
          message: "Expense not found",
        });
      }

      // Update fields
      if (title !== undefined) expense.title = title;
      if (amount !== undefined) expense.amount = Number(amount);
      if (categoryId !== undefined) expense.categoryId = categoryId || null;
      if (categoryName !== undefined) expense.categoryName = categoryName;
      if (description !== undefined) expense.description = description || "";
      if (locationId !== undefined) expense.locationId = locationId || null;
      if (locationName !== undefined) expense.locationName = locationName || "";
      if (staffId !== undefined) expense.staffId = staffId || null;
      if (staffName !== undefined) expense.staffName = staffName || "";
      if (assetId !== undefined) expense.assetId = assetId || null;
      if (assetName !== undefined) expense.assetName = assetName || "";

      await expense.save();

      return res.status(200).json({
        success: true,
        expense,
      });
    }

    /* ---------------- DELETE EXPENSE ---------------- */
    if (req.method === "DELETE") {
      const expense = await Expense.findByIdAndDelete(id);

      if (!expense) {
        return res.status(404).json({
          success: false,
          message: "Expense not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Expense deleted successfully",
      });
    }

    res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error("Expense API error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}
