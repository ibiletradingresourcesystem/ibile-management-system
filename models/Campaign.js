import mongoose, { Schema, models } from "mongoose";

const CampaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    discount: { type: Number, default: 0 },
    targetCustomers: { type: String, default: "all" },
    targetCategories: { type: String, default: "all" },
    targetProducts: { type: String, default: "all" },
    targetLocations: { type: String, default: "all" },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

CampaignSchema.index({ active: 1, startDate: 1, endDate: 1 });
CampaignSchema.index({ targetCustomers: 1, targetLocations: 1 });

const Campaign = models.Campaign || mongoose.model("Campaign", CampaignSchema);

export default Campaign;