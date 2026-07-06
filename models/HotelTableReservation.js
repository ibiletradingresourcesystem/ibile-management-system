import mongoose from "mongoose";

const HotelTableReservationSchema = new mongoose.Schema(
  {
    siteKey: {
      type: String,
      default: "hotel",
    },
    guestName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    reservationDate: {
      type: Date,
      required: true,
    },
    reservationTime: {
      type: String,
      required: true,
      trim: true,
    },
    partySize: {
      type: Number,
      required: true,
      min: 1,
    },
    areaPreference: {
      type: String,
      trim: true,
      default: "",
    },
    occasion: {
      type: String,
      trim: true,
      default: "",
    },
    specialRequests: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["requested", "confirmed", "cancelled", "completed"],
      default: "requested",
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.models.HotelTableReservation || mongoose.model("HotelTableReservation", HotelTableReservationSchema);