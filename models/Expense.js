import mongoose, { Schema, models } from "mongoose";

const ExpenseSchema = new Schema(
  {
    title: { type: String, required: true },
    amount: { type: Number, required: true },

    categoryId: {
      type: Schema.Types.ObjectId,
      index: true,
    },

    // Legacy field — old entries stored category as ObjectId here
    category: {
      type: Schema.Types.ObjectId,
      ref: "ExpenseCategory",
      index: true,
    },

    categoryName: {
      type: String,
      trim: true,
    },

    locationId: Schema.Types.ObjectId,
    locationName: String,

    staffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
    },
    staffName: String,

    // Asset maintenance link (optional)
    assetId: {
      type: Schema.Types.ObjectId,
      ref: "Asset",
    },
    assetName: String,

    expenseDate: { type: Date, default: Date.now },

    description: String,

    // Source linkage (e.g. petty-cash-transaction)
    sourceType: { type: String, default: "" },
    sourceId: { type: String, default: "" },

    // Vendor reference (for petty cash expenses)
    vendor: {
      _id: { type: Schema.Types.ObjectId, ref: "Vendor" },
      companyName: String,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

export default models.Expense ||
  mongoose.model("Expense", ExpenseSchema);
