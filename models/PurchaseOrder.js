import mongoose, { Schema, models } from "mongoose";

const PurchaseOrderProductSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: "Product" },
  name: { type: String, required: true },
  quantity: { type: Number, default: 0 },
  price: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
});

const PurchaseOrderSchema = new Schema(
  {
    orderRef: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now,
    },
    vendor: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },
    vendorName: {
      type: String,
      required: true,
    },
    contact: {
      type: String,
    },
    location: {
      type: String,
    },
    locationId: {
      type: Schema.Types.ObjectId,
    },
    reason: {
      type: String,
      default: "Restock",
    },
    products: [PurchaseOrderProductSchema],
    grandTotal: {
      type: Number,
      required: true,
      default: 0,
    },
    staff: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
    },
    staffName: {
      type: String,
    },

    // Payment tracking
    paymentMade: {
      type: Number,
      default: 0,
    },
    balance: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["Not Paid", "Partly Paid", "Paid", "Credit"],
      default: "Not Paid",
    },
    paymentDate: {
      type: String,
    },
    payBeforeSupply: {
      type: Boolean,
      default: false,
    },

    // Receiving
    receivedStatus: {
      type: String,
      enum: ["Pending", "Partially Received", "Received"],
      default: "Pending",
    },
    receivedAt: {
      type: Date,
    },
    stockMovementId: {
      type: Schema.Types.ObjectId,
      ref: "StockMovement",
    },
    notes: {
      type: String,
    },
  },
  { timestamps: true }
);

PurchaseOrderSchema.index({ createdAt: -1 });
PurchaseOrderSchema.index({ vendor: 1 });
PurchaseOrderSchema.index({ status: 1 });
PurchaseOrderSchema.index({ receivedStatus: 1 });

export default models.PurchaseOrder || mongoose.model("PurchaseOrder", PurchaseOrderSchema);
