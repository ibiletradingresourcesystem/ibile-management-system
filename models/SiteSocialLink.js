import mongoose, { Schema, models } from "mongoose";

const SiteSocialLinkSchema = new Schema(
  {
    platform: { type: String, required: true },
    label: { type: String, default: "" },
    handle: { type: String, default: "" },
    url: { type: String, default: "" },
    scope: { type: String, enum: ["warehouse", "hotel", "both"], default: "warehouse" },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

SiteSocialLinkSchema.index({ scope: 1, active: 1, order: 1 });

const SiteSocialLink = models.SiteSocialLink || mongoose.model("SiteSocialLink", SiteSocialLinkSchema);

export default SiteSocialLink;
