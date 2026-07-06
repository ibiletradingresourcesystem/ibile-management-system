// models/Store.js
import mongoose from "mongoose";

const LocationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },        
    address: { type: String },                    
    phone: { type: String },                       
    email: { type: String },                       
    code: { type: String },                        
    isActive: { type: Boolean, default: true },
    // Per-location QR code for receipts
    qrUrl: { type: String, default: "" },
    qrDataUrl: { type: String, default: "" },
    // Tenders and Categories specific to this location
    tenders: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tender" }],
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
  },
  { _id: true } 
);

const StoreSchema = new mongoose.Schema(
  {
    companyName: String,
    email: String,
    logo: { type: String, default: "" }, // Company logo URL for receipts
    currency: String,
    timezone: String,

    devices: [String],
    orderFooter: String,

    openingHours: [{ day: String, open: String, close: String }],
    tenderTypes: [String],
    taxRates: [{ name: String, percentage: Number }],
    pettyCashReasons: [String],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    storeName: { type: String, required: true },
    storePhone: { type: String, required: true },
    country: { type: String, required: true },

    // 🔥 UPGRADED LOCATIONS
    locations: [LocationSchema],

    // 📋 Receipt Settings
    companyDisplayName: { type: String, default: "St's Michael Hub" },
    taxNumber: { type: String, default: "" },
    website: { type: String, default: "" },
    refundDays: { type: Number, default: 0 },
    receiptMessage: { type: String, default: "Thank you for shopping with us!" },
    fontSize: { type: String, default: "8.0" },
    fontFamily: { type: String, default: "Arial" },
    barcodeType: { type: String, default: "Default - Code 39" },
    qrUrl: { type: String, default: "" },
    qrDescription: { type: String, default: "Please scan and leave us a review" },
    qrDataUrl: { type: String, default: "" },
    paymentStatus: { type: String, default: "paid" },
    shippingBaseCost: { type: Number, default: 2000 },
    shippingRatePerKm: { type: Number, default: 100 },
    shippingFallbackCost: { type: Number, default: 2000 },
  },
  { timestamps: true }
);

export default mongoose.models.Store ||
  mongoose.model("Store", StoreSchema);
