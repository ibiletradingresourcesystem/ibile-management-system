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
      enum: ["stock", "wholesale", "petty-cash"],
      default: "stock",
    },
    paymentTermDays: {
      type: Number,
      default: 14,
    },
    businessCategory: {
      type: String,
      trim: true,
    },
    products: [
      {
        product: { type: Schema.Types.ObjectId, ref: "Product" },
        productName: { type: String },
        // With a supply pack, this is the price of one pack; otherwise of one unit.
        price: { type: Number, default: 0 },
        // Mirrors the catalogue product's own pack settings, for reference.
        packType: { type: String, enum: ["unit", "pack"], default: "unit" },
        qtyPerPack: { type: Number, default: 1 },
        /*
         * How this vendor supplies a product the catalogue keeps in single units:
         * one ordered pack is this many units (a carton of 30 biscuits). Orders to
         * this vendor are then placed in packs and received as units. It changes
         * nothing about the product itself, and is ignored for a product that is
         * already a pack in the catalogue.
         */
        supplyPackSize: { type: Number, default: 1 },
        supplyPackLabel: { type: String, trim: true },
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
