import mongoose, { Schema, models } from "mongoose";

/**
 * Stock already on the shelf that expires on a date, recorded on the product page: "12 of these
 * expire on 3 March". Recording it does not change the stock figure; it says which part of it
 * expires when. Stock received with an expiry date is a batch of its own on its stock movement
 * line, so it is not recorded here. See lib/expiryBatches.js for how what is left is worked out.
 */
const ExpiryBatchSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    expiryDate: { type: Date, required: true },
    // In the product's stock unit: packs for a pack product (2 cartons and 5 cans of 24 is 2.2083)
    quantity: { type: Number, required: true, min: 0 },
    locationId: { type: Schema.Types.ObjectId, default: null },
    locationName: { type: String, default: "" },
    recordedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export default models.ExpiryBatch || mongoose.model("ExpiryBatch", ExpiryBatchSchema);
