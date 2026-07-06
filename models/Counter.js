import mongoose, { Schema, models } from "mongoose";

const CounterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  {
    versionKey: false,
    timestamps: false,
  }
);

export default models.Counter || mongoose.model("Counter", CounterSchema);