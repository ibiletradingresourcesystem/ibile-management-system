import mongoose, { Schema, models } from "mongoose";

const ExpenseCategorySchema = new Schema({
  name: { type: String, required: true, unique: true }
}, { timestamps: true });

export default models.ExpenseCategory || mongoose.model("ExpenseCategory", ExpenseCategorySchema);
