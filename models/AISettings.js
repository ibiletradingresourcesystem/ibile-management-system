import mongoose, { Schema, models } from "mongoose";

/**
 * Which AI provider the business wants to use.
 *
 * API keys deliberately stay in environment variables and are never stored
 * here — this document only records the choice between the providers whose
 * keys are present.
 */
const AISettingsSchema = new Schema(
  {
    key: { type: String, default: "ai-settings", unique: true },

    // "gemini" | "openai" | "auto" (first provider with a working key)
    provider: {
      type: String,
      enum: ["auto", "gemini", "openai"],
      default: "auto",
    },

    geminiModel: { type: String, default: "gemini-2.0-flash" },
    openaiModel: { type: String, default: "gpt-4o-mini" },

    enabled: { type: Boolean, default: true },

    // Result of the last connectivity check, so the UI can explain a failure
    // instead of silently falling back.
    lastCheckedAt: { type: Date, default: null },
    lastCheckProvider: { type: String, default: "" },
    lastCheckOk: { type: Boolean, default: null },
    lastCheckError: { type: String, default: "" },
  },
  { timestamps: true }
);

export default models.AISettings || mongoose.model("AISettings", AISettingsSchema);
