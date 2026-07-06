import mongoose from 'mongoose';

const TillSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Staff',
      required: true,
    },
    staffName: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['OPEN', 'CLOSED', 'SUSPENDED'],
      default: 'OPEN',
    },
    openingBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    closingBalance: {
      type: Number,
      default: null,
    },
    openedAt: {
      type: Date,
      default: Date.now,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    device: {
      type: String,
      default: 'POS Terminal',
    },
    notes: {
      type: String,
      default: '',
    },
    floatAdjustments: [
      {
        amount: { type: Number, default: 0 },
        reason: { type: String, default: "" },
        staffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// Index for efficient querying
TillSchema.index({ staffId: 1, status: 1 });
TillSchema.index({ openedAt: -1 });
TillSchema.index(
  { storeId: 1, locationId: 1, status: 1 },
  { partialFilterExpression: { status: "OPEN" } }
);

export default mongoose.models.Till || mongoose.model('Till', TillSchema);
