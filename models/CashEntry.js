import mongoose, { Schema, models } from "mongoose";
import { CASH_PURPOSE_KEYS } from "@/lib/cashEntries";

/**
 * Money in or out that is neither a sale nor a vendor order: a refund to a
 * customer who paid too much, cash the owner takes for an emergency, money the
 * owner puts back in.
 *
 * Kept apart from Expense on purpose — an owner draw is not a business cost and
 * money arriving is not an expense at all — so neither the expense reports nor
 * the vendor totals are disturbed by it. See lib/cashEntries.js for what each
 * purpose means and how it posts.
 */
const CashEntrySchema = new Schema(
  {
    direction: { type: String, enum: ["in", "out"], required: true, index: true },
    purpose: { type: String, enum: CASH_PURPOSE_KEYS, required: true, index: true },

    /** Who the money went to, or came from. */
    party: { type: String, trim: true, default: "" },

    /** Where it is paid, so a transfer memo can be raised for it like any other. */
    accountName: { type: String, trim: true, default: "" },
    accountNumber: { type: String, trim: true, default: "" },
    bankName: { type: String, trim: true, default: "" },

    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now, index: true },

    reference: { type: String, trim: true, default: "" },
    notes: { type: String, default: "" },

    location: { type: String, default: "" },
    locationId: { type: Schema.Types.ObjectId, default: null },

    staff: { type: Schema.Types.ObjectId, ref: "Staff" },
    staffName: { type: String, default: "" },
  },
  { timestamps: true }
);

CashEntrySchema.index({ date: -1 });

export default models.CashEntry || mongoose.model("CashEntry", CashEntrySchema);
