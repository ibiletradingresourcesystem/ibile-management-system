/**
 * API: /api/cash-entries
 *
 * Money in or out that is neither a sale nor a vendor order — a refund to a
 * customer who paid too much, cash the owner takes out, money the owner puts in.
 * The Quick Entry on the payment tracker writes here for everything that is not a
 * vendor payment.
 *
 * GET  — the most recent entries, newest first.
 * POST — record one, and post it to the books.
 */
import { mongooseConnect } from "@/lib/mongodb";
import CashEntry from "@/models/CashEntry";
import Store from "@/models/Store";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { findPurpose, purposeDirection } from "@/lib/cashEntries";
import { postCashEntry } from "@/lib/accounting";
import { sanitizeMultilineText, sanitizePlainText } from "@/lib/textSanitizers";

/** The location the money moved at, when the entry does not name one. */
async function defaultBusinessLocation() {
  const store = await Store.findOne({}, { locations: 1 }).lean();
  const locations = store?.locations || [];
  const active = locations.find((location) => location.isActive !== false) || locations[0];
  return active?.name || "";
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const limit = Math.min(Number(req.query.limit) || 25, 200);
      const entries = await CashEntry.find({}).sort({ date: -1, createdAt: -1 }).limit(limit).lean();
      return res.status(200).json({ success: true, entries, total: entries.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { purpose, party, amount, date, reference, notes, location, accountName, accountNumber, bankName } = req.body || {};

      const rule = findPurpose(purpose);
      if (!rule || rule.needsVendor) {
        return res.status(400).json({ error: "Pick what the money was for. A vendor payment is recorded as an order, not here." });
      }

      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({ error: "An amount is required." });
      }

      const entry = await CashEntry.create({
        direction: purposeDirection(purpose),
        purpose,
        party: sanitizePlainText(party || rule.defaultParty || ""),
        accountName: sanitizePlainText(accountName || ""),
        accountNumber: sanitizePlainText(accountNumber || ""),
        bankName: sanitizePlainText(bankName || ""),
        amount: Math.round(value * 100) / 100,
        date: date ? new Date(date) : new Date(),
        reference: sanitizePlainText(reference || ""),
        notes: sanitizeMultilineText(notes || ""),
        location: sanitizePlainText(location || "") || (await defaultBusinessLocation()),
        staff: req.user?.id || null,
        staffName: req.user?.name || "",
      });

      // The books should never be the reason an entry cannot be recorded.
      let posted = true;
      try {
        await postCashEntry(entry.toObject());
      } catch (postErr) {
        posted = false;
        console.error("Cash entry posting failed:", entry._id, postErr.message);
      }

      return res.status(201).json({ success: true, entry, posted });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
