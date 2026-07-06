import mongoose from "mongoose";

const TenderAssignmentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    deviceTenders: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

export default
  mongoose.models.TenderAssignment ||
  mongoose.model("TenderAssignment", TenderAssignmentSchema);
