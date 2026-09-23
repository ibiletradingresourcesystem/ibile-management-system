import mongoose, { Schema, models } from "mongoose";

/**
 * A stock order: what has been ordered from a vendor but not yet received.
 *
 * It sits before the purchase order. Orders are raised per vendor, can be merged
 * together (one vendor, one delivery), and are receipted here; receiving is what
 * creates the purchase order that the Vendor Payment Tracker then pays against.
 *
 * The collection is shared with the expense app's stock orders (same name), so the
 * older fields keep their meaning and the newer ones default to the old behaviour:
 * a document with no `stage` and no "Stock Received" reason is still on order.
 */
const StockOrderProductSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: "Product" },
  name: { type: String, required: true },
  // In the vendor's selling unit: packs where a supply pack size is set.
  quantity: { type: Number, default: 0 },
  price: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  supplyPackSize: { type: Number, default: 1 },
  supplyPackLabel: { type: String },
});

const StockOrderSchema = new Schema(
  {
    orderRef: { type: String, index: true },
    date: { type: Date, default: Date.now },
    supplier: String,
    contact: String,
    location: String,
    locationId: { type: Schema.Types.ObjectId },
    mainProduct: Schema.Types.Mixed,
    // The expense app writes "Stock Received" here; kept so its records still read correctly.
    reason: String,
    grandTotal: { type: Number, default: 0 },
    products: [StockOrderProductSchema],
    vendor: { type: Schema.Types.ObjectId, ref: "Vendor" },
    staff: { type: Schema.Types.ObjectId, ref: "Staff" },
    staffName: String,
    notes: String,

    // Where the order is in its life: on order, or received and handed to a purchase order.
    stage: {
      type: String,
      enum: ["Submitted", "Received"],
      default: "Submitted",
      index: true,
    },
    receivedAt: Date,
    receivedBy: { type: Schema.Types.ObjectId, ref: "Staff" },
    purchaseOrderId: { type: Schema.Types.ObjectId, ref: "PurchaseOrder" },

    // Set on an order made by merging others, listing what it was merged from.
    mergedFrom: [{ type: Schema.Types.ObjectId }],

    // Where a seeded record came from, so the same file can be imported twice safely.
    sourceApp: String,
    sourceId: { type: String, index: true },

    // Payment fields the expense app records; the purchase order carries these onward.
    paymentMade: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Not Paid", "Partly Paid", "Paid", "Credit"],
      default: "Not Paid",
    },
    paymentDate: String,
    payBeforeSupply: { type: Boolean, default: false },
  },
  { timestamps: true }
);

StockOrderSchema.index({ createdAt: -1 });
StockOrderSchema.index({ vendor: 1, stage: 1 });

/** True for an order still waiting to be received, including the expense app's own. */
export function isOnOrder(order) {
  if (!order) return false;
  if (order.stage) return order.stage === "Submitted";
  return String(order.reason || "").trim().toLowerCase() !== "stock received";
}

export default models.StockOrder || mongoose.model("StockOrder", StockOrderSchema);
