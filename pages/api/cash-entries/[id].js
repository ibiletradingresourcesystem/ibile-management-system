/**
 * API: /api/cash-entries/[id]
 *
 * DELETE — remove an entry raised in error. The books are worked out from the records, so it is
 * out of them as soon as it is gone.
 *
 * An expense paid by memo is found here too, so its memo can be raised and a mistaken one removed
 * from the tracker.
 */
import { mongooseConnect } from "@/lib/mongodb";
import { isValidObjectId } from "mongoose";
import CashEntry from "@/models/CashEntry";
import Expense from "@/models/Expense";
import { authMiddleware, isAdmin, isStaff } from "@/lib/auth-middleware";
import { expenseAsEntry, MEMO_EXPENSE_SOURCES } from "@/lib/cashEntries";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  const { id } = req.query;
  if (!isValidObjectId(id)) return res.status(400).json({ error: "Invalid entry id" });

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const entry = await CashEntry.findById(id).lean();
      if (entry) return res.status(200).json({ success: true, entry });
      const expense = await Expense.findOne({ _id: id, sourceType: { $in: MEMO_EXPENSE_SOURCES } }).lean();
      if (!expense) return res.status(404).json({ error: "Entry not found" });
      return res.status(200).json({ success: true, entry: expenseAsEntry(expense) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    // Deleting money out of the books is an administrator's call.
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });

    try {
      const entry = await CashEntry.findByIdAndDelete(id);
      if (entry) return res.status(200).json({ success: true });

      const expense = await Expense.findOneAndDelete({ _id: id, sourceType: { $in: MEMO_EXPENSE_SOURCES } });
      if (!expense) return res.status(404).json({ error: "Entry not found" });
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
