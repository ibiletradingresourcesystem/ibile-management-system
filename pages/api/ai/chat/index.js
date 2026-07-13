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
import { processAIChatMessage, SUGGESTED_QUESTIONS } from "@/lib/ai/chatService";

// Hard-coded knowledge base responses for common support questions
const KNOWLEDGE_RESPONSES = [
  { keywords: ["add product", "new product", "create product"], response: "To add a new product: Go to **Manage → Product List → Add Product**. Enter name, category, cost price, and sale price. Enable stock management if needed. Save." },
  { keywords: ["stock movement", "restock", "transfer stock"], response: "Go to **Stock → Stock Movement** to create restocks, transfers, or returns. Each movement auto-updates stock levels at relevant locations." },
  { keywords: ["end of day", "eod", "close till"], response: "Go to **Reporting → EOD Reports**. Select location and date, then reconcile your till against expected values. The system calculates variance automatically." },
  { keywords: ["expense", "add expense"], response: "Go to **Expenses → Expense Management**. Enter title, amount, category, and location. Cash entries can be added for daily operations." },
  { keywords: ["credit", "credit sale"], response: "Credit sales are tracked per customer. Go to the customer's profile to see outstanding credit. Mark payments as they come in." },
  { keywords: ["purchase order", "vendor payment"], response: "Go to **Manage → Vendor Payment Tracker** to manage purchase orders. Use Quick Entry for fast recording, or Sync Stock Orders to import from inventory." },
];

export default async function handler(req, res) {
  if (req.method === "GET") {
    // Return suggested questions
    return res.status(200).json({ success: true, suggestions: SUGGESTED_QUESTIONS });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  const { message, history } = req.body || {};
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "Message is required" });
  }

  await mongooseConnect();

  const userMessage = message.trim().toLowerCase();

  // Step 1: Check knowledge base first
  const kbMatch = KNOWLEDGE_RESPONSES.find(kb =>
    kb.keywords.some(kw => userMessage.includes(kw))
  );
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
    const result = await processAIChatMessage(message.trim(), Array.isArray(history) ? history : []);
    return res.status(200).json({
      success: result.success,
      response: result.response,
      source: result.success ? "ai" : "fallback",
      context: result.context,
      meta: result.meta,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
