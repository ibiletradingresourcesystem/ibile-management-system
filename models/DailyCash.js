import mongoose from "mongoose";

const DailyCashSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    amount: { type: Number, required: true },
    cashBroughtForward: { type: Number, default: 0 },
    totalPayments: { type: Number, default: 0 },
    totalCashAvailable: { type: Number, default: 0 },
    cashAtHand: { type: Number, default: 0 },
    location: { type: String, required: true },
    locationId: { type: mongoose.Schema.Types.ObjectId },
    staff: {
      _id: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
      name: String,
      role: String,
    },
  },
  { timestamps: true }
);

DailyCashSchema.index({ location: 1, date: -1 });

export default mongoose.models.DailyCash ||
  mongoose.model("DailyCash", DailyCashSchema);
