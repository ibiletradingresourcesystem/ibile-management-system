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

    // Source linkage (e.g. petty-cash-transaction; payment-tracker for an expense paid by memo)
    sourceType: { type: String, default: "" },
    sourceId: { type: String, default: "" },

    // Expenses are paid in cash, except those sent from the bank on a payment memo, entered on
    // the payment tracker's Quick Entry. Decides which account the books take it from.
    paidFrom: { type: String, enum: ["cash", "bank"], default: "cash" },
    /** Who a memo payment went to, and where, for the transfer memo. */
    paidTo: { type: String, trim: true, default: "" },
    accountName: { type: String, trim: true, default: "" },
    accountNumber: { type: String, trim: true, default: "" },
    bankName: { type: String, trim: true, default: "" },

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

// The payment tracker lists the expenses it recorded
ExpenseSchema.index({ sourceType: 1, expenseDate: -1 });

export default models.Expense ||
  mongoose.model("Expense", ExpenseSchema);
