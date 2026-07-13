/**
 * AIRecommendation Model
 * 
 * Stores all AI-generated recommendations with approval workflow.
 * Supports: pricing, inventory, restock, product performance, business advice.
 */
import mongoose, { Schema, models } from "mongoose";

const AIRecommendationSchema = new Schema(
  {
    /** Type of recommendation */
    recommendationType: {
      type: String,
      required: true,
      enum: ["pricing", "inventory", "restock", "product-performance", "business"],
      index: true,
    },

    /** Entity type this recommendation applies to */
    entityType: {
      type: String,
      enum: ["product", "category", "vendor", "location", "global"],
      default: "global",
    },

    /** Entity ID (product ID, category ID, etc.) */
    entityId: {
      type: Schema.Types.ObjectId,
      index: true,
      sparse: true,
    },

    /** Entity name for display */
    entityName: { type: String, default: "" },

    /** Input metrics used to generate this recommendation */
    metrics: { type: Schema.Types.Mixed },

    /** SHA-256 hash of metrics for change detection */
    hash: { type: String, required: true, index: true },

    /** The AI-generated recommendation text */
    recommendation: { type: String, default: "" },

    /** Reason/explanation for the recommendation */
    reason: { type: String, default: "" },

    /** Priority: critical, high, medium, low */
    priority: {
      type: String,
      enum: ["critical", "high", "medium", "low"],
      default: "medium",
    },

    /** AI confidence score (0-100) */
    confidence: { type: Number, default: 0, min: 0, max: 100 },

    /** Estimated financial benefit (naira) */
    estimatedBenefit: { type: Number, default: 0 },

    /** Category for grouping */
    category: { type: String, default: "" },

    /** Risk level */
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "low",
    },

    /** Implementation difficulty */
    difficulty: {
      type: String,
      enum: ["easy", "moderate", "hard"],
      default: "moderate",
    },

    /** Full structured data from AI */
    data: { type: Schema.Types.Mixed, default: {} },

    /** Approval workflow status */
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "implemented", "expired"],
      default: "pending",
      index: true,
    },

    /** Who approved/rejected */
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedByName: { type: String },
    approvedAt: { type: Date },
    rejectedReason: { type: String },
    implementedAt: { type: Date },
    notes: { type: String },

    /** AI provider metadata */
    provider: { type: String, default: "google" },
    model: { type: String, default: "gemini-2.0-flash" },
    executionTimeMs: { type: Number, default: 0 },

    /** When this was generated */
    generatedAt: { type: Date, default: Date.now },

    /** Location scope */
    location: { type: String, default: "All Locations" },
  },
  { timestamps: true }
);

AIRecommendationSchema.index({ recommendationType: 1, status: 1 });
AIRecommendationSchema.index({ entityType: 1, entityId: 1, recommendationType: 1 });
AIRecommendationSchema.index({ priority: 1, status: 1 });
AIRecommendationSchema.index({ generatedAt: -1 });

export default models.AIRecommendation || mongoose.model("AIRecommendation", AIRecommendationSchema);
