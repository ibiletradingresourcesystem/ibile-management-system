import mongoose, { Schema, models } from "mongoose";

const ExpenseCategorySchema = new Schema({
  name: { type: String, required: true, unique: true },

  /**
   * EXPENSE  a running cost: it hits the profit and loss statement when paid.
   * INVENTORY  stock bought for resale: it sits on the balance sheet and only
   *            reaches profit as cost of goods sold once the stock sells.
   *
   * Left unset it stays null rather than defaulting, so the reports can fall
   * back to reading the category name (STOCK_PURCHASE_KEYWORDS in
   * lib/financial-basis.js) instead of a default nobody chose.
   */
  treatment: {
    type: String,
    enum: ["EXPENSE", "INVENTORY", null],
    default: null,
  },
}, { timestamps: true });

export default models.ExpenseCategory || mongoose.model("ExpenseCategory", ExpenseCategorySchema);
