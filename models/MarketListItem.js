import mongoose, { Schema, models } from "mongoose";

/**
 * One thing to buy at the market.
 *
 * While `open`, it is on the next market list, which anyone can add to; generating a list moves the
 * open items into a MarketList (`list`) and they are no longer open. Items are their own documents,
 * not lines inside one list, so several staff adding at the same time never overwrite each other.
 *
 * - A product with a market vendor sits under that vendor (and so its market and section).
 * - A product in the system with no market vendor yet waits under "No market vendor yet".
 * - Anything not in the system is an "other" item: free text, made into a product after purchase.
 */
const MarketListItemSchema = new Schema(
  {
    open: { type: Boolean, default: true },
    list: { type: Schema.Types.ObjectId, ref: "MarketList", default: null, index: true },

    product: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    name: { type: String, required: true, trim: true },
    market: { type: Schema.Types.ObjectId, ref: "Market", default: null },
    vendor: { type: Schema.Types.ObjectId, ref: "MarketVendor", default: null },

    quantity: { type: Number, default: 1, min: 0 },
    unit: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },

    // "staff": added by a person; "low-stock": added because the product fell to its minimum
    source: { type: String, enum: ["staff", "low-stock"], default: "staff" },
    // Removed from the next list by a person: a low-stock item is not put back while this list is open
    dismissed: { type: Boolean, default: false },
    addedBy: { type: String, default: "" },

    // On a generated list, at the market
    status: { type: String, enum: ["pending", "bought", "unavailable"], default: "pending" },
  },
  { timestamps: true }
);

// One open line per product: adding it again raises the quantity
MarketListItemSchema.index(
  { product: 1 },
  { unique: true, partialFilterExpression: { open: true, product: { $type: "objectId" } } }
);
MarketListItemSchema.index({ open: 1, market: 1 });

export default models.MarketListItem || mongoose.model("MarketListItem", MarketListItemSchema);
