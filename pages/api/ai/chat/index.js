/**
 * API: /api/ai/chat
 * 
 * POST - Send a message to the AI Business Assistant
 * Body: { message, history (optional array of {role, content}) }
 * 
 * Hybrid flow: Knowledge base → Cached recommendations → Gemini
 */
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { helpAnswerFor, processAIChatMessage, SUGGESTED_QUESTIONS } from "@/lib/ai/chatService";

export default async function handler(req, res) {
  if (req.method === "GET") {
    // Return suggested questions
    return res.status(200).json({ success: true, suggestions: SUGGESTED_QUESTIONS });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  const { message, history, provider } = req.body || {};
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "Message is required" });
  }

  await mongooseConnect();

  // Step 1: a how-to question about the app gets the help text straight away. Only a how-to:
  // matching keywords anywhere sent "What products should I restock?" — a suggested question —
  // the instructions for Stock Movement instead of an answer.
  const kbMatch = helpAnswerFor(message);
  if (kbMatch) {
    return res.status(200).json({
      success: true,
      response: kbMatch.response,
      source: "knowledge-base",
      meta: { executionTimeMs: 0 },
    });
  }

  // Step 2: Process through AI with business context
  try {
    const result = await processAIChatMessage(
      message.trim(),
      Array.isArray(history) ? history : [],
      provider || null
    );
    return res.status(200).json({
      success: result.success,
      response: result.response,
      // "error" tells the UI to show this as a problem to fix rather than as
      // an answer from the assistant.
      source: result.success ? "ai" : "error",
      error: result.error || undefined,
      context: result.context,
      meta: result.meta,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
