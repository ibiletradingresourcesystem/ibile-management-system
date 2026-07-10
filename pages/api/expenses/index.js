// pages/api/expenses/index.js
import { mongooseConnect } from "@/lib/mongodb";
import Expense from "@/models/Expense";
import ExpenseCategory from "@/models/ExpenseCategory";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { postExpenseEntry } from "@/lib/accounting";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  await mongooseConnect();

  try {
    /* ---------------- GET EXPENSES ---------------- */
    if (req.method === "GET") {
      const expenses = await Expense.find()
        .sort({ createdAt: -1 })
        .lean();

      // Backfill categoryName for old entries that have category ObjectId but no categoryName
      const needsCategoryName = expenses.filter(
        (e) => !e.categoryName && (e.category || e.categoryId)
      );
      if (needsCategoryName.length > 0) {
        const catIds = [...new Set(needsCategoryName.map((e) => String(e.category || e.categoryId)))];
        const categories = await ExpenseCategory.find({ _id: { $in: catIds } }).lean();
        const catMap = {};
        for (const c of categories) catMap[String(c._id)] = c.name;

        for (const exp of expenses) {
          if (!exp.categoryName) {
            const catId = String(exp.category || exp.categoryId || "");
            exp.categoryName = catMap[catId] || "";
          }
        }
      }

      return res.status(200).json({
        success: true,
        expenses,
      });
    }

    /* ---------------- CREATE EXPENSE ---------------- */
    if (req.method === "POST") {
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

      if (!title || !amount || !categoryName) {
        return res.status(400).json({
          success: false,
          message: "Title, amount and category name are required",
        });
      }

      const expense = await Expense.create({
        title,
        amount: Number(amount),
        categoryId: categoryId || null,
        categoryName,
        description: description || "",
        locationId: locationId || null,
        locationName: locationName || "",
        staffId: staffId || null,
        staffName: staffName || "",
        assetId: assetId || null,
        assetName: assetName || "",
      });

      // Auto-post accounting journal entry
      try {
        await postExpenseEntry(expense);
      } catch (acctErr) {
        console.error("Accounting auto-post failed for expense:", expense._id, acctErr.message);
      }

      return res.status(201).json({
        success: true,
        expense,
      });
    }

    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error("Expense API error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
}

