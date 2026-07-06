import { mongooseConnect } from "@/lib/mongodb";
import Staff from "@/models/Staff";
import { authMiddleware } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  await mongooseConnect();

  const { params } = req.query;
  if (!params || params.length < 2) {
    return res.status(400).json({ error: "staffId and penalty index are required" });
  }
  const [staffId, indexStr] = params;
  const index = parseInt(indexStr, 10);

  const staff = await Staff.findById(staffId);
  if (!staff) return res.status(404).json({ error: "Staff not found" });

  if (isNaN(index) || index < 0 || index >= staff.penalty.length) {
    return res.status(400).json({ error: "Invalid penalty index" });
  }

  if (req.method === "PUT") {
    try {
      const { amount, reason, date } = req.body;
      if (amount !== undefined) staff.penalty[index].amount = Number(amount);
      if (reason !== undefined) staff.penalty[index].reason = reason;
      if (date) staff.penalty[index].date = new Date(date);
      await staff.save();
      return res.status(200).json({ success: true, penalty: staff.penalty });
    } catch (err) {
      console.error("Penalty update error:", err);
      return res.status(500).json({ error: "Failed to update penalty" });
    }
  }

  if (req.method === "DELETE") {
    try {
      staff.penalty.splice(index, 1);
      await staff.save();
      return res.status(200).json({ success: true, penalty: staff.penalty });
    } catch (err) {
      console.error("Penalty delete error:", err);
      return res.status(500).json({ error: "Failed to delete penalty" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
