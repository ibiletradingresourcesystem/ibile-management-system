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
 *
 * An expense paid by memo is kept with the other expenses, so every expense report counts it;
 * this route records it there and lists it with the entries.
 */
import { isValidObjectId } from "mongoose";
import { mongooseConnect } from "@/lib/mongodb";
import CashEntry from "@/models/CashEntry";
import Expense from "@/models/Expense";
import ExpenseCategory from "@/models/ExpenseCategory";
import Store from "@/models/Store";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { expenseAsEntry, findPurpose, MEMO_EXPENSE_SOURCE, purposeDirection } from "@/lib/cashEntries";
import { postCashEntry, postExpenseEntry } from "@/lib/accounting";
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
      const [cashEntries, memoExpenses] = await Promise.all([
        CashEntry.find({}).sort({ date: -1, createdAt: -1 }).limit(limit).lean(),
        Expense.find({ sourceType: MEMO_EXPENSE_SOURCE }).sort({ expenseDate: -1, createdAt: -1 }).limit(limit).lean(),
      ]);
      const entries = [...cashEntries, ...memoExpenses.map(expenseAsEntry)]
        .sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt))
        .slice(0, limit);
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

      if (rule.recordsExpense) {
        const { title, categoryId } = req.body || {};
        const category = isValidObjectId(categoryId) ? await ExpenseCategory.findById(categoryId).lean() : null;
        if (!category) return res.status(400).json({ error: "Pick the expense category." });
        const what = sanitizePlainText(title || "");
        if (!what) return res.status(400).json({ error: "Say what the expense was for." });

        // Paid by memo is paid from the bank, whatever the form sent
        const expense = await Expense.create({
          title: what,
          amount: Math.round(value * 100) / 100,
          categoryId: category._id,
          categoryName: category.name,
          description: sanitizeMultilineText(notes || ""),
          locationName: sanitizePlainText(location || "") || (await defaultBusinessLocation()),
          expenseDate: date ? new Date(date) : new Date(),
          staffName: req.user?.name || "",
          createdBy: req.user?.id || null,
          sourceType: MEMO_EXPENSE_SOURCE,
          paidFrom: "bank",
          paidTo: sanitizePlainText(party || ""),
          accountName: sanitizePlainText(accountName || ""),
          accountNumber: sanitizePlainText(accountNumber || ""),
          bankName: sanitizePlainText(bankName || ""),
        });

        let posted = true;
        try {
          await postExpenseEntry(expense.toObject());
        } catch (postErr) {
          posted = false;
          console.error("Memo expense posting failed:", expense._id, postErr.message);
        }

        return res.status(201).json({ success: true, entry: expenseAsEntry(expense.toObject()), expense, posted });
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
