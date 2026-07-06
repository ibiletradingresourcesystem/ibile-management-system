import mongoose, { Schema, models } from "mongoose";

const MaintenanceRecordSchema = new Schema({
  date: { type: Date, required: true },
  description: { type: String, required: true },
  cost: { type: Number, default: 0 },
  performedBy: { type: String },
  nextMaintenanceDate: { type: Date },
});

const AssetSchema = new Schema(
  {
    assetTag: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "Furniture",
        "Electronics",
        "Vehicles",
        "Machinery",
        "IT Equipment",
        "Office Equipment",
        "Kitchen Equipment",
        "Security Equipment",
        "Tools",
        "Other",
      ],
    },
    serialNumber: {
      type: String,
      trim: true,
    },
    manufacturer: {
      type: String,
      trim: true,
    },
    model: {
      type: String,
      trim: true,
    },

    // Financial
    purchaseDate: {
      type: Date,
    },
    purchasePrice: {
      type: Number,
      default: 0,
    },
    currentValue: {
      type: Number,
      default: 0,
    },
    depreciationMethod: {
      type: String,
      enum: ["Straight-Line", "Declining Balance", "None"],
      default: "Straight-Line",
    },
    usefulLifeYears: {
      type: Number,
      default: 5,
    },
    salvageValue: {
      type: Number,
      default: 0,
    },

    // Assignment
    assignedTo: {
      type: String,
      trim: true,
    },
    assignedStaffId: {
      type: Schema.Types.ObjectId,
      ref: "Staff",
    },
    location: {
      type: String,
      trim: true,
    },
    locationId: {
      type: Schema.Types.ObjectId,
    },

    // Status
    status: {
      type: String,
      enum: ["Active", "In Maintenance", "Retired", "Disposed", "Lost", "In Storage"],
      default: "Active",
    },
    condition: {
      type: String,
      enum: ["New", "Good", "Fair", "Poor", "Damaged"],
      default: "New",
    },

    // Vendor / Warranty
    vendor: {
      type: String,
      trim: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
    },
    warrantyExpiry: {
      type: Date,
    },
    insuranceExpiry: {
      type: Date,
    },

    // Images
    image: { type: String, default: "" },
    images: [{ type: String }],

    // Maintenance history
    maintenanceHistory: [MaintenanceRecordSchema],

    notes: {
      type: String,
    },

    // Custom properties (dynamic key-value pairs)
    customProperties: [
      {
        key: { type: String, required: true, trim: true },
        value: { type: String, trim: true },
      },
    ],

    // Disposal
    disposalDate: {
      type: Date,
    },
    disposalReason: {
      type: String,
    },
    disposalValue: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

AssetSchema.index({ category: 1 });
AssetSchema.index({ status: 1 });
AssetSchema.index({ location: 1 });
AssetSchema.index({ assignedTo: 1 });

export default models.Asset || mongoose.model("Asset", AssetSchema);
