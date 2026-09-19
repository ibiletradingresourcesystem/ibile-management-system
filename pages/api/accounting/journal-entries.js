import { mongooseConnect } from "@/lib/mongodb";
import JournalEntry, { createJournalEntry } from "@/models/JournalEntry";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { resolveAndValidateLines } from "@/lib/journalValidation";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();

  try {
    if (req.method === "GET") {
      const { status, referenceType, from, to, limit = 100, skip = 0 } = req.query;
      const filter = {};
      if (status) filter.status = status;
      if (referenceType) filter.referenceType = referenceType;
      if (from || to) {
        filter.date = {};
        if (from) filter.date.$gte = new Date(from);
        if (to) filter.date.$lte = new Date(to);
      }

      const [entries, total] = await Promise.all([
        JournalEntry.find(filter)
          .sort({ date: -1, createdAt: -1 })
          .skip(parseInt(skip))
          .limit(parseInt(limit))
          .lean(),
        JournalEntry.countDocuments(filter),
      ]);

      res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
      return res.status(200).json({ success: true, entries, total });
    }

    if (req.method === "POST") {
      const { date, description, lines, reference, referenceType, status, location } = req.body;

      if (!description || !lines || lines.length < 2) {
        return res.status(400).json({ success: false, message: "Description and at least 2 journal lines are required" });
      }

      // Resolve accounts and confirm the entry balances
      const validation = await resolveAndValidateLines(lines);
      if (!validation.ok) {
        return res.status(400).json({ success: false, message: validation.message });
      }
      const resolvedLines = validation.lines;

      const VALID_REF_TYPES = ["SALE", "EXPENSE", "PURCHASE_ORDER", "SALARY", "REFUND", "OTHER"];
      const normalizedRefType = referenceType || "OTHER";
      if (!VALID_REF_TYPES.includes(normalizedRefType)) {
        return res.status(400).json({ success: false, message: "A valid reference type is required. All entries must be tied to a payment form." });
      }

      const entryStatus = status || "DRAFT";
      const entry = await createJournalEntry({
        date: date ? new Date(date) : new Date(),
        description,
        lines: resolvedLines,
        reference: reference || "",
        referenceType: normalizedRefType,
        status: entryStatus,
        location: location || "",
        postedAt: entryStatus === "POSTED" ? new Date() : undefined,
        createdBy: req.user?._id || req.user?.id,
        createdByName: req.user?.name || "",
      });

      return res.status(201).json({ success: true, entry });
    }

    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error("Journal Entry API error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
}
