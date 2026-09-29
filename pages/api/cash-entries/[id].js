/**
 * API: /api/cash-entries/[id]
 *
 * DELETE — remove an entry raised in error, and strike off the journal entry it
 * posted so the books do not keep money that never moved.
 */
import { mongooseConnect } from "@/lib/mongodb";
import { isValidObjectId } from "mongoose";
import CashEntry from "@/models/CashEntry";
import JournalEntry from "@/models/JournalEntry";
import { authMiddleware, isAdmin, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  const { id } = req.query;
  if (!isValidObjectId(id)) return res.status(400).json({ error: "Invalid entry id" });

  await mongooseConnect();

  if (req.method === "DELETE") {
    // Deleting money out of the books is an administrator's call.
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });

    try {
      const entry = await CashEntry.findByIdAndDelete(id);
      if (!entry) return res.status(404).json({ error: "Entry not found" });

      const posted = await JournalEntry.find({ referenceType: "OTHER", referenceId: entry._id, status: { $ne: "VOIDED" } });
      await Promise.all(
        posted.map((journal) => {
          journal.status = "VOIDED";
          journal.voidedAt = new Date();
          journal.voidReason = "Cash entry deleted";
          return journal.save();
        })
      );

      return res.status(200).json({ success: true, voidedEntries: posted.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
