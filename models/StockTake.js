// models/StockTake.js
import mongoose, { Schema, models } from "mongoose";

const StockTakeItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  productName: { type: String, required: true },
  barcode: { type: String, default: "" },
  category: { type: String, default: "" },
  systemQty: { type: Number, required: true, default: 0 },
  countedQty: { type: Number, default: null },
  variance: { type: Number, default: 0 },
  varianceValue: { type: Number, default: 0 },
  costPrice: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ["pending", "counted", "verified"],
    default: "pending",
  },
  reason: { type: String, default: "" },
  notes: { type: String, default: "" },
  countedAt: { type: Date, default: null },
  countedBy: { type: String, default: "" },
  countType: { type: String, enum: ["standard", "loose-units"], default: "standard" },
  qtyPerPack: { type: Number, default: 0 },
});

const StockTakeSchema = new Schema(
  {
    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    locationId: { type: Schema.Types.ObjectId, ref: "Store.locations" },
    locationName: { type: String, required: true },
    status: {
      type: String,
      enum: ["draft", "in-progress", "completed", "cancelled", "approved"],
      default: "draft",
      index: true,
    },
    type: {
      type: String,
      enum: ["full", "partial", "cycle", "spot-check"],
      default: "full",
    },
    category: { type: String, default: "" },
    items: [StockTakeItemSchema],

    // Summary stats (computed on finalize)
    totalItems: { type: Number, default: 0 },
    countedItems: { type: Number, default: 0 },
    totalSystemQty: { type: Number, default: 0 },
    totalCountedQty: { type: Number, default: 0 },
    totalVariance: { type: Number, default: 0 },
    totalVarianceValue: { type: Number, default: 0 },
    positiveVariance: { type: Number, default: 0 },
    negativeVariance: { type: Number, default: 0 },
    accuracyRate: { type: Number, default: 0 },

    // Workflow
    createdBy: { type: String, default: "" },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    adjustmentApplied: { type: Boolean, default: false },
    adjustedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Indexes
StockTakeSchema.index({ createdAt: -1 });
StockTakeSchema.index({ status: 1, createdAt: -1 });
StockTakeSchema.index({ locationName: 1 });

export default models.StockTake || mongoose.model("StockTake", StockTakeSchema);
