import mongoose, { Schema, models } from "mongoose";

const AccountSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"],
    },
    subType: { type: String, trim: true }, // e.g. "Current Asset", "Fixed Asset", "Cost of Goods Sold"
    normalBalance: {
      type: String,
      enum: ["DEBIT", "CREDIT"],
      required: true,
    },
    parent: { type: Schema.Types.ObjectId, ref: "Account", default: null },
    description: { type: String, default: "" },
    isSystem: { type: Boolean, default: false }, // System accounts can't be deleted
    isActive: { type: Boolean, default: true },
    openingBalance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

AccountSchema.index({ type: 1, code: 1 });
AccountSchema.index({ parent: 1 });
AccountSchema.index({ isActive: 1 });

export default models.Account || mongoose.model("Account", AccountSchema);
