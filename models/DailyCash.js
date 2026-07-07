import mongoose, { Schema, models } from "mongoose";

const DailyCashSchema = new Schema(
  {
    date: { type: Date, required: true },
    amount: { type: Number, required: true, default: 0 },
    location: { type: String, required: true },
    staffId: { type: Schema.Types.ObjectId, ref: "Staff" },
    staffName: { type: String, default: "" },
    source: { type: String, enum: ["manual", "pos"], default: "manual" },
    posSessionId: { type: String, default: "" },
    cashBroughtForward: { type: Number, default: 0 },
    totalPayments: { type: Number, default: 0 },
    totalCashAvailable: { type: Number, default: 0 },
    cashAtHand: { type: Number, default: 0 },
  },
  { timestamps: true }
);

DailyCashSchema.index({ date: 1, location: 1 });

export default models.DailyCash || mongoose.model("DailyCash", DailyCashSchema);
