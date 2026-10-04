import mongoose, { Schema, models } from "mongoose";

/**
 * When the books were last brought up to date from the sales, expenses and orders, and whether a
 * sync is running now. Kept in the database rather than in memory: each server instance has its own
 * memory, so "synced a minute ago" there meant nothing to the next request, and two instances could
 * sync at once and post the same sale twice.
 */
const AccountingSyncStateSchema = new Schema(
  {
    _id: { type: String, required: true },
    lastSyncAt: { type: Date, default: null },
    lastDurationMs: { type: Number, default: null },
    lastSummary: { type: Schema.Types.Mixed, default: null },
    lastError: { type: String, default: null },
    // Set while a sync runs; a sync that died leaves it to run out
    lockedUntil: { type: Date, default: null },
  },
  { versionKey: false, timestamps: false }
);

export default models.AccountingSyncState || mongoose.model("AccountingSyncState", AccountingSyncStateSchema);
