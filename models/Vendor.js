import mongoose, { Schema, models } from "mongoose";

const VendorSchema = new Schema(
  {
    companyName: {
      type: String,
      required: true,
      trim: true,
    },
    vendorRep: {
      type: String,
      trim: true,
    },
    repPhone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    mainProduct: {
      type: String,
      trim: true,
    },
    bankName: {
      type: String,
      trim: true,
    },
    accountName: {
      type: String,
      trim: true,
    },
    accountNumber: {
      type: String,
      trim: true,
    },
    vendorType: {
      type: String,
      enum: ["stock", "petty-cash"],
      default: "stock",
    },
    businessCategory: {
      type: String,
      trim: true,
    },
    products: [
      {
        product: { type: Schema.Types.ObjectId, ref: "Product" },
        productName: { type: String },
        price: { type: Number, default: 0 },
        packType: { type: String, enum: ["unit", "pack"], default: "unit" },
        qtyPerPack: { type: Number, default: 1 },
      },
    ],
    onboardingToken: {
      type: String,
      unique: true,
      sparse: true,
    },
    onboardingComplete: {
      type: Boolean,
      default: false,
    },
    termsAccepted: {
      type: Boolean,
      default: false,
    },
    termsAcceptedAt: Date,
    termsVersion: String,
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

VendorSchema.index({ companyName: 1 });

export default models.Vendor || mongoose.model("Vendor", VendorSchema);
