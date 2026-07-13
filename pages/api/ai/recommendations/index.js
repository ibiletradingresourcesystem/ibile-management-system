/**
 * API: /api/ai/recommendations
 * 
 * GET - List recommendations with filters
 * PUT - Approve/reject/implement a recommendation
 */
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff, isAdmin } from "@/lib/auth-middleware";
import { getRecommendations, approveRecommendation, rejectRecommendation, markImplemented } from "@/lib/ai/orchestrator";
import AIRecommendation from "@/models/AIRecommendation";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const { type, status, priority, entityId, limit } = req.query;
      const filters = {};
      if (type) filters.recommendationType = type;
      if (status) filters.status = status;
      if (priority) filters.priority = priority;
      if (entityId) filters.entityId = entityId;
      if (limit) filters.limit = Number(limit);

      const recommendations = await getRecommendations(filters);
      return res.status(200).json({ success: true, recommendations });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "PUT") {
    if (!isAdmin(req)) return res.status(403).json({ error: "Only managers/admins can approve recommendations" });

    try {
      const { id, action, reason, notes } = req.body;
      if (!id || !action) return res.status(400).json({ error: "id and action are required" });

      let result;
      const userId = req.user?.id;
      const userName = req.user?.name || "";

      switch (action) {
        case "approve":
          result = await approveRecommendation(id, userId, userName, notes);
          break;
        case "reject":
          result = await rejectRecommendation(id, userId, userName, reason);
          break;
        case "implement":
          result = await markImplemented(id);
          break;
        default:
          return res.status(400).json({ error: "Invalid action. Use: approve, reject, implement" });
      }

      if (!result) return res.status(404).json({ error: "Recommendation not found" });
      return res.status(200).json({ success: true, recommendation: result });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
