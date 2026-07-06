import mongoose, { Schema, models } from "mongoose";

const SocialLinkSchema = new Schema(
  {
    platform: { type: String, required: true },
    label: { type: String },
    handle: { type: String },
    url: { type: String },
    scope: { type: String, enum: ["warehouse", "hotel", "both"], default: "warehouse" },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const HeroSchema = new Schema(
  {
    title: { type: String, required: true },
    subtitle: { type: String },
    image:  [
      {
        full: { type: String, required: true },
        thumb: { type: String, required: true },
      },
    ],
    bgImage: [
      {
        full: { type: String, required: true },
        thumb: { type: String, required: true },
      },
    ],
    ctaText: { type: String },
    ctaLink: { type: String },
    targetSystem: {
      type: String,
      enum: ["ecommerce", "web", "both"],
      default: "ecommerce",
    },
    bannerType: {
      type: String,
      enum: ["standard", "promotion", "campaign"],
      default: "standard",
    },
    linkedPromotion: { type: Schema.Types.ObjectId, ref: "Promotion", default: null },
    linkedCampaign: { type: Schema.Types.ObjectId, ref: "Campaign", default: null },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    socialLinks: { type: [SocialLinkSchema], default: [] },
    order: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

HeroSchema.index({ targetSystem: 1, status: 1, order: 1 });
HeroSchema.index({ bannerType: 1, linkedPromotion: 1, linkedCampaign: 1 });
HeroSchema.index({ "socialLinks.scope": 1, "socialLinks.active": 1 });

const Hero = models.Hero || mongoose.model("Hero", HeroSchema);

export default Hero;
