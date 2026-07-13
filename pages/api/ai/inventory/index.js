/**
 * API: /api/ai/inventory
 * 
 * GET - Generate inventory advisor recommendations
 * Query: regenerate (optional), location (optional)
 */
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { generateInventoryAdvice } from "@/lib/ai/inventoryAdvisor";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  const { regenerate, location } = req.query;

  await mongooseConnect();

  try {
    const result = await generateInventoryAdvice({ forceRegenerate: regenerate === "true", location });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
