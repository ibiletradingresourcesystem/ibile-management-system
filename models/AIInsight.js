/**
 * AIInsight Model
 * 
 * Stores cached AI-generated business insights with hash-based deduplication.
 * Prevents redundant Gemini API calls when metrics haven't changed.
 */
import mongoose, { Schema, models } from "mongoose";

const AIInsightSchema = new Schema(
  {
    /** Type of report this insight belongs to */
    reportType: {
      type: String,
      required: true,
      enum: ["daily", "weekly", "monthly", "yearly", "custom"],
      index: true,
    },

    /** Human-readable period label (e.g., "July 2026") */
    reportPeriod: {
      type: String,
      required: true,
    },

    /** Location/branch this insight covers */
    location: {
      type: String,
      default: "All Locations",
      index: true,
    },

    /** The raw metrics object used to generate this insight */
    metrics: {
      type: Schema.Types.Mixed,
      required: true,
    },

    /** SHA-256 hash of the metrics object for change detection */
    hash: {
      type: String,
      required: true,
      index: true,
    },

    /** AI-generated executive summary */
    summary: {
      type: String,
      default: "",
    },

    /** AI-generated highlights array */
    highlights: {
      type: [String],
      default: [],
    },

    /** AI-generated growth analysis */
    growthAnalysis: {
      type: String,
      default: "",
    },

    /** AI-generated risk analysis */
    riskAnalysis: {
      type: String,
      default: "",
    },

    /** AI-generated opportunities */
    opportunities: {
      type: [String],
      default: [],
    },

    /** AI-generated recommendations */
    recommendations: {
      type: [String],
      default: [],
    },

    /** AI-generated business health score (0-100) */
    healthScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    /** AI provider metadata */
    provider: {
      type: String,
      default: "google",
    },

    /** AI model used */
    model: {
      type: String,
      default: "gemini-2.0-flash",
    },

    /** When the insight was generated */
    generatedAt: {
      type: Date,
      default: Date.now,
    },

    /** Processing status */
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "stale"],
      default: "completed",
    },

    /** Execution time for AI generation (ms) */
    executionTimeMs: {
      type: Number,
      default: 0,
    },

    /** Whether this was served from cache */
    cacheHit: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Compound index for efficient lookups
AIInsightSchema.index({ reportType: 1, location: 1, hash: 1 });
AIInsightSchema.index({ generatedAt: -1 });

export default models.AIInsight || mongoose.model("AIInsight", AIInsightSchema);
