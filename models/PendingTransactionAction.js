import mongoose from "mongoose";

const PendingTransactionActionSchema = new mongoose.Schema({
  transactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Transaction",
    required: true,
  },
  actionType: {
    type: String,
    enum: ["edit", "refund"],
    required: true,
  },
  // For edit actions, store the updated fields
  editPayload: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  reason: {
    type: String,
    default: "",
  },
  requestedBy: {
    type: String,
    required: true,
  },
  requestedByStaffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Staff",
    default: null,
  },
  confirmationToken: {
    type: String,
    required: true,
    unique: true,
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "expired"],
    default: "pending",
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  processedAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

PendingTransactionActionSchema.index({ transactionId: 1, status: 1 });
PendingTransactionActionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const PendingTransactionAction =
  mongoose.models.PendingTransactionAction ||
  mongoose.model("PendingTransactionAction", PendingTransactionActionSchema);

export default PendingTransactionAction;
