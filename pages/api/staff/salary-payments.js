/**
 * API: /api/staff/salary-payments
 *
 * POST — the salary memo was downloaded: record what it pays as a payment. It becomes an expense in
 * the Salary category, sent from the bank, so it reaches Salary Expense in the accounts and shows
 * in the payment tracker beside the other memo payments. The amount is worked out here from the
 * staff records (salary less penalties), the same figure the memo prints, never taken from the
 * page. Downloading the same memo again in the same month updates the payment; nothing is
 * recorded twice.
 *
 * Body: { ids: [staff id, ...], part, of }
 */
import { isValidObjectId } from "mongoose";
import { mongooseConnect } from "@/lib/mongodb";
import Staff from "@/models/Staff";
import Expense from "@/models/Expense";
import ExpenseCategory from "@/models/ExpenseCategory";
import Store from "@/models/Store";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { payrollRows, payrollTotal } from "@/lib/payroll";
import { parseSalaryMemoSourceId, salaryMemoSourceId, SALARY_MEMO_SOURCE } from "@/lib/cashEntries";
import { dayKeyOf } from "@/lib/tradingDay";

const SALARY_CATEGORY = "Salary";

async function salaryCategory() {
  const existing = await ExpenseCategory.findOne({ name: { $regex: `^${SALARY_CATEGORY}$`, $options: "i" } }).lean();
  if (existing) return existing;
  try {
    return (await ExpenseCategory.create({ name: SALARY_CATEGORY, treatment: "EXPENSE" })).toObject();
  } catch (error) {
    // Another request made it at the same moment
    if (error?.code === 11000) return ExpenseCategory.findOne({ name: SALARY_CATEGORY }).lean();
    throw error;
  }
}

async function defaultBusinessLocation() {
  const store = await Store.findOne({}, { locations: 1 }).lean();
  const locations = store?.locations || [];
  return (locations.find((location) => location.isActive !== false) || locations[0])?.name || "";
}

const naira = (value) => `₦${Math.round(value).toLocaleString("en-NG")}`;

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { ids, part, of } = req.body || {};
  const staffIds = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
  if (staffIds.length === 0 || staffIds.length > 50 || !staffIds.every((id) => isValidObjectId(id))) {
    return res.status(400).json({ error: "This memo has no valid staff on it." });
  }
  const memoPart = Math.max(1, Number(part) || 1);
  const memoOf = Math.max(memoPart, Number(of) || 1);

  try {
    await mongooseConnect();
    const staff = await Staff.find({ _id: { $in: staffIds } }, { name: 1, salary: 1, penalty: 1 }).lean();
    const rows = payrollRows(staff);
    const amount = Math.round(payrollTotal(rows) * 100) / 100;
    if (amount <= 0) return res.status(400).json({ error: "Nobody on this memo is due any pay." });

    const today = dayKeyOf(new Date());
    const month = today.slice(0, 7);
    const monthLabel = new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    const sourceId = salaryMemoSourceId(month, memoPart, memoOf, staffIds);

    // Anyone on this memo already paid on a different memo this month: said, not refused, since
    // the memo may have been regrouped
    const sameMonth = await Expense.find({ sourceType: SALARY_MEMO_SOURCE, sourceId: { $regex: `^${month}\\|` } }, { sourceId: 1 }).lean();
    const onOtherMemos = new Set(
      sameMonth.filter((expense) => expense.sourceId !== sourceId).flatMap((expense) => parseSalaryMemoSourceId(expense.sourceId).staffIds)
    );
    const alreadyPaid = rows.filter((row) => onOtherMemos.has(String(row._id))).map((row) => row.name);

    const category = await salaryCategory();
    const fields = {
      title: `Salaries ${monthLabel} (memo ${memoPart} of ${memoOf})`,
      amount,
      categoryId: category._id,
      categoryName: category.name,
      description: rows.map((row) => `${row.name}: ${naira(row.netPay)}`).join("\n"),
      paidFrom: "bank",
      paidTo: "Staff salaries",
      staffName: req.user?.name || "",
      createdBy: req.user?.id || null,
    };

    const existing = await Expense.findOne({ sourceType: SALARY_MEMO_SOURCE, sourceId });
    const expense = existing
      ? await Expense.findByIdAndUpdate(existing._id, { $set: fields }, { new: true })
      : await Expense.create({
          ...fields,
          expenseDate: new Date(`${today}T12:00:00Z`),
          locationName: await defaultBusinessLocation(),
          sourceType: SALARY_MEMO_SOURCE,
          sourceId,
        });

    return res.status(existing ? 200 : 201).json({ success: true, updated: Boolean(existing), amount, month, alreadyPaid, expenseId: expense._id });
  } catch (error) {
    console.error("Salary payment failed:", error);
    return res.status(500).json({ error: "Could not record the salary payment." });
  }
}
