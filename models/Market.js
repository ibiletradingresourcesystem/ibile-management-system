import mongoose, { Schema, models } from "mongoose";

/**
 * A market the store buys from in person (Mile 12, Oyingbo…), and its sections — the parts of the
 * market a buyer walks through ("Market Entrance", "Back Row"), each holding several market vendors.
 * The market list is sorted by section, then vendor, so it reads in walking order.
 */
const SectionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },
  },
  { _id: true }
);

const MarketSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    sections: { type: [SectionSchema], default: [] },
    // Products from this market's vendors that fall to their minimum stock are put on the next list
    autoAddLowStock: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default models.Market || mongoose.model("Market", MarketSchema);
