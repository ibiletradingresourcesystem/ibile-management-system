import mongoose, { Schema, models } from "mongoose";

/**
 * Someone the store buys from at a market, often known only as "Vendor 1" or by first name.
 *
 * Kept apart from Vendor on purpose: market buying is paid and booked in by hand, and the Vendor
 * collection feeds stock orders, purchase orders, the payment tracker, each product's vendor list
 * and the expense app — none of which should start offering market stalls.
 */
const MarketVendorProductSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    productName: { type: String, trim: true },
    // What the stall sells it by ("basket", "bag", "tuber") and how many of the product's own
    // units that is; quantities on the market list are in this unit
    unit: { type: String, trim: true, default: "" },
    unitSize: { type: Number, default: 1, min: 0 },
    lastPrice: { type: Number, default: 0 },
    // The vendor a product goes to when several market vendors sell it
    favourite: { type: Boolean, default: false },
  },
  { _id: false }
);

const MarketVendorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },
    market: { type: Schema.Types.ObjectId, ref: "Market", required: true, index: true },
    section: { type: Schema.Types.ObjectId, default: null },
    products: { type: [MarketVendorProductSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

MarketVendorSchema.index({ "products.product": 1 });

export default models.MarketVendor || mongoose.model("MarketVendor", MarketVendorSchema);
