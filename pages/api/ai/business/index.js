/**
 * API: /api/ai/business
 * GET - Generate business strategy recommendations
 */
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { generateBusinessRecommendations } from "@/lib/ai/businessAdvisor";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  const { regenerate, period, location } = req.query;
  await mongooseConnect();

  try {
    const result = await generateBusinessRecommendations({
      period: period || "month",
      location: location || undefined,
      forceRegenerate: regenerate === "true",
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
