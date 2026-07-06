// models/Staff.js
import mongoose, { Schema, models } from "mongoose";
import { getDefaultPosPermissions } from "@/lib/pos-permissions";

const StaffSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    username: {
      type: String,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      select: false,
    },

    role: {
      type: String,
      default: "staff",
    },

    posPermissions: {
      type: Object,
      default: function defaultPosPermissions() {
        return getDefaultPosPermissions(this.role);
      },
    },

    location: {
      type: String,
      default: "",
    },

    accountName: {
      type: String,
      default: "",
    },

    accountNumber: {
      type: String,
      default: "",
    },

    bankName: {
      type: String,
      default: "",
    },

    salary: {
      type: Number,
      default: 0,
    },

    penalty: [
      {
        reason: String,
        amount: Number,
        date: { type: Date, default: Date.now },
      },
    ],

    locationId: { type: Schema.Types.ObjectId },
    locationName: String,

    photo: {
      type: String,
      default: "",
    },

    onboardingToken: {
      type: String,
      unique: true,
      sparse: true,
    },

    onboardingComplete: {
      type: Boolean,
      default: false,
    },

    onboardingData: {
      fullName: { type: String, trim: true },
      email: { type: String, trim: true },
      phone: { type: String, trim: true },
      address: { type: String, trim: true },
      dateOfBirth: { type: String, trim: true },
      stateOfOrigin: { type: String, trim: true },
      nextOfKin: { type: String, trim: true },
      nextOfKinPhone: { type: String, trim: true },
      photo: { type: String },
    },

    guarantor: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
      email: { type: String, trim: true },
      address: { type: String, trim: true },
      relationship: { type: String, trim: true },
      occupation: { type: String, trim: true },
      photo: { type: String },
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    showOnPos: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

StaffSchema.index({ username: 1 }, { unique: true, sparse: true });

export default models.Staff || mongoose.model("Staff", StaffSchema);

export const Staff =
  models.Staff || mongoose.model("Staff", StaffSchema);
