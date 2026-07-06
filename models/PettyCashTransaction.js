import mongoose from "mongoose";

const staffSnapshotSchema = new mongoose.Schema(
  {
    _id: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", default: null },
    name: { type: String, trim: true, default: "" },
    role: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
  },
  { _id: false }
);

const approvalHistorySchema = new mongoose.Schema(
  {
    action: { type: String, required: true, trim: true },
    fromStatus: { type: String, trim: true, default: "" },
    toStatus: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },
    actedAt: { type: Date, default: Date.now },
    actedBy: { type: staffSnapshotSchema, default: null },
    amount: { type: Number, default: 0 },
    paymentMethod: { type: String, trim: true, default: "" },
    paymentReference: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const pettyCashTransactionSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    vendorName: { type: String, required: true, trim: true },
    purpose: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    quantity: { type: Number, required: true, min: 0.01, default: 1 },
    unitPrice: { type: Number, required: true, min: 0, default: 0 },
    amount: { type: Number, required: true, min: 0 },
    location: { type: String, required: true, trim: true },
    requestDate: { type: Date, required: true, default: Date.now },
    neededBy: { type: Date, default: null },
    status: {
      type: String,
      enum: [
        "Ordered",
        "Pending Approval",
        "Approved",
        "Rejected",
        "Paid",
        "Cancelled",
      ],
      default: "Ordered",
      index: true,
    },
    requestedBy: { type: staffSnapshotSchema, default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: staffSnapshotSchema, default: null },
    paidAt: { type: Date, default: null },
    paidBy: { type: staffSnapshotSchema, default: null },
    paymentMethod: { type: String, trim: true, default: "" },
    paymentReference: { type: String, trim: true, default: "" },
    expense: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Expense",
      default: null,
    },
    approvalHistory: { type: [approvalHistorySchema], default: [] },
  },
  { timestamps: true }
);

pettyCashTransactionSchema.index({ location: 1, requestDate: -1 });
pettyCashTransactionSchema.index({ vendor: 1, status: 1, createdAt: -1 });

export default mongoose.models.PettyCashTransaction ||
  mongoose.model("PettyCashTransaction", pettyCashTransactionSchema);
