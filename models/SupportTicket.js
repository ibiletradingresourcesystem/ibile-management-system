import mongoose from "mongoose";

const SupportCommentSchema = new mongoose.Schema(
  {
    message: { type: String, required: true, trim: true },
    byUserId: { type: String, default: "" },
    byName: { type: String, default: "" },
    byEmail: { type: String, default: "" },
    byRole: { type: String, default: "" },
    internal: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const SupportTicketSchema = new mongoose.Schema(
  {
    ticketNumber: { type: String, required: true, unique: true, index: true },
    subject: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["general", "billing", "technical", "tax", "inventory", "other"],
      default: "general",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "pending_customer", "resolved", "closed"],
      default: "open",
    },
    location: { type: String, default: "" },
    tags: [{ type: String }],
    createdBy: {
      userId: { type: String, default: "" },
      name: { type: String, default: "" },
      email: { type: String, default: "" },
      role: { type: String, default: "" },
    },
    assignedTo: {
      userId: { type: String, default: "" },
      name: { type: String, default: "" },
      email: { type: String, default: "" },
    },
    lastActivityAt: { type: Date, default: Date.now, index: true },
    comments: { type: [SupportCommentSchema], default: [] },
    closedAt: { type: Date, default: null },
    closedReason: { type: String, default: "" },
  },
  { timestamps: true }
);

SupportTicketSchema.index({ status: 1, priority: 1, createdAt: -1 });

export default
  mongoose.models.SupportTicket ||
  mongoose.model("SupportTicket", SupportTicketSchema);
