/**
 * API: /api/ai/restock
 * GET - Generate restock recommendations
 */
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { generateRestockRecommendations } from "@/lib/ai/restockAdvisor";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  const { regenerate } = req.query;
  await mongooseConnect();

  try {
    const result = await generateRestockRecommendations({ forceRegenerate: regenerate === "true" });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
