/**
 * API: /api/credits
 * 
 * GET - Returns credit sales summary for navbar notification badge
 */
import { mongooseConnect } from "@/lib/mongodb";
import { Transaction } from "@/models/Transactions";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();

  try {
    const [result] = await Transaction.aggregate([
      {
        $match: {
          status: "credit",
          creditStatus: { $in: ["open", "partly_paid", "overdue"] },
        },
      },
      {
        $group: {
          _id: null,
          activeCredits: { $sum: 1 },
          outstandingBalance: { $sum: { $ifNull: ["$creditBalance", 0] } },
          overdueCount: { $sum: { $cond: [{ $eq: ["$creditStatus", "overdue"] }, 1, 0] } },
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      summary: {
        activeCredits: result?.activeCredits || 0,
        outstandingBalance: result?.outstandingBalance || 0,
        overdueCount: result?.overdueCount || 0,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
