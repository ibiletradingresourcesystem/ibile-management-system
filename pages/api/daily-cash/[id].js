import { mongooseConnect } from "@/lib/mongoose";
import { authMiddleware } from "@/lib/auth-middleware";
import DailyCash from "@/models/DailyCash";
import { recalculateDailyCashForLocation } from "@/lib/petty-cash-transactions";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return;

  await mongooseConnect();
  const { id } = req.query;

  if (req.method === "PUT") {
    try {
      const { amount } = req.body || {};
      if (amount === undefined) {
        return res.status(400).json({ error: "Amount is required." });
      }

      const record = await DailyCash.findById(id);
      if (!record) {
        return res.status(404).json({ error: "Record not found." });
      }

      record.amount = Number(amount);
      await record.save();

      // Recalculate the chain for this location
      await recalculateDailyCashForLocation(record.location);

      const updated = await DailyCash.findById(id);
      return res.status(200).json({ success: true, record: updated });
    } catch (error) {
      console.error("Daily cash update error:", error);
      return res.status(500).json({ error: "Failed to update record" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const record = await DailyCash.findById(id);
      if (!record) {
        return res.status(404).json({ error: "Record not found." });
      }
      const { location } = record;
      await DailyCash.findByIdAndDelete(id);
      await recalculateDailyCashForLocation(location);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Daily cash delete error:", error);
      return res.status(500).json({ error: "Failed to delete record" });
    }
  }

  res.setHeader("Allow", ["PUT", "DELETE"]);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
