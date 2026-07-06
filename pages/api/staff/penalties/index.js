import { mongooseConnect } from "@/lib/mongodb";
import Staff from "@/models/Staff";
import { authMiddleware } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  await mongooseConnect();

  if (req.method === "POST") {
    try {
      const { staffId, amount, reason, date } = req.body;
      if (!staffId || !reason || !amount) {
        return res.status(400).json({ error: "staffId, reason, and amount are required" });
      }
      const staff = await Staff.findById(staffId);
      if (!staff) return res.status(404).json({ error: "Staff not found" });

      staff.penalty.push({
        reason,
        amount: Number(amount),
        date: date ? new Date(date) : new Date(),
      });
      await staff.save();
      return res.status(201).json({ success: true, penalty: staff.penalty });
    } catch (err) {
      console.error("Penalty create error:", err);
      return res.status(500).json({ error: "Failed to add penalty" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
