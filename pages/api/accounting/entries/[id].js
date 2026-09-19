import { mongooseConnect } from "@/lib/mongodb";
import JournalEntry from "@/models/JournalEntry";
import { authMiddleware, isStaff, isAdmin } from "@/lib/auth-middleware";
import { resolveAndValidateLines } from "@/lib/journalValidation";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();
  const { id } = req.query;

  try {
    if (req.method === "GET") {
      const entry = await JournalEntry.findById(id).lean();
      if (!entry) return res.status(404).json({ success: false, message: "Entry not found" });
      return res.status(200).json({ success: true, entry });
    }

    if (req.method === "PUT") {
      const entry = await JournalEntry.findById(id);
      if (!entry) return res.status(404).json({ success: false, message: "Entry not found" });

      const { action } = req.body;

      // Post a draft entry
      if (action === "post") {
        if (entry.status !== "DRAFT") {
          return res.status(400).json({ success: false, message: "Only draft entries can be posted" });
        }
        // Re-check at the moment of posting: an account can be deactivated, or
        // the draft written before this validation existed.
        const validation = await resolveAndValidateLines(entry.lines);
        if (!validation.ok) {
          return res.status(400).json({
            success: false,
            message: `This entry cannot be posted: ${validation.message}`,
          });
        }
        entry.lines = validation.lines;
        entry.status = "POSTED";
        entry.postedAt = new Date();
        await entry.save();
        return res.status(200).json({ success: true, entry, message: "Entry posted" });
      }

      // Void a posted entry
      if (action === "void") {
        if (!isAdmin(req)) return res.status(403).json({ error: "Only admins can void entries" });
        if (entry.status !== "POSTED") {
          return res.status(400).json({ success: false, message: "Only posted entries can be voided" });
        }
        entry.status = "VOIDED";
        entry.voidedAt = new Date();
        entry.voidReason = req.body.voidReason || "";
        await entry.save();
        return res.status(200).json({ success: true, entry, message: "Entry voided" });
      }

      // Update draft entry
      if (entry.status !== "DRAFT") {
        return res.status(400).json({ success: false, message: "Only draft entries can be edited" });
      }

      const { date, description, lines, reference, location } = req.body;

      // Lines were assigned straight through here, so an edit could leave a
      // draft unbalanced and it would post without complaint.
      if (lines !== undefined) {
        const validation = await resolveAndValidateLines(lines);
        if (!validation.ok) {
          return res.status(400).json({ success: false, message: validation.message });
        }
        entry.lines = validation.lines;
      }

      if (date) entry.date = new Date(date);
      if (description) entry.description = description;
      if (reference !== undefined) entry.reference = reference;
      if (location !== undefined) entry.location = location;

      await entry.save();
      return res.status(200).json({ success: true, entry });
    }

    if (req.method === "DELETE") {
      const entry = await JournalEntry.findById(id);
      if (!entry) return res.status(404).json({ success: false, message: "Entry not found" });
      if (entry.status === "POSTED") {
        return res.status(400).json({ success: false, message: "Cannot delete posted entries. Void them instead." });
      }
      await JournalEntry.findByIdAndDelete(id);
      return res.status(200).json({ success: true, message: "Entry deleted" });
    }

    res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error("Journal Entry API error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
}
