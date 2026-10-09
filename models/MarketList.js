import mongoose, { Schema, models } from "mongoose";

/**
 * A generated market list: what was taken to the market on one trip. Its lines are MarketListItem
 * documents pointing at it. Only the latest few are kept (lib/market.js, KEEP_LISTS) — the list is
 * a working paper, not an accounting record.
 */
const MarketListSchema = new Schema(
  {
    number: { type: Number, required: true },
    // null: every market; otherwise the one market it was generated for
    market: { type: Schema.Types.ObjectId, ref: "Market", default: null },
    marketName: { type: String, default: "" },
    generatedBy: { type: String, default: "" },
    itemCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

MarketListSchema.index({ createdAt: -1 });

export default models.MarketList || mongoose.model("MarketList", MarketListSchema);
