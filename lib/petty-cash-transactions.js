import Expense from "@/models/Expense";
import ExpenseCategory from "@/models/ExpenseCategory";
import DailyCash from "@/models/DailyCash";

export function buildStaffSnapshot(staff = null) {
  if (!staff) return null;
  return {
    _id: staff._id || null,
    name: staff.name || "",
    role: staff.role || "",
    email: staff.email || staff.onboardingData?.email || "",
  };
}

export function buildApprovalHistoryEntry({
  action,
  fromStatus = "",
  toStatus = "",
  note = "",
  staff = null,
  amount = 0,
  paymentMethod = "",
  paymentReference = "",
}) {
  return {
    action,
    fromStatus,
    toStatus,
    note: typeof note === "string" ? note.trim() : "",
    actedAt: new Date(),
    actedBy: buildStaffSnapshot(staff),
    amount: Number(amount) || 0,
    paymentMethod,
    paymentReference,
  };
}

export async function ensurePettyCashCategory() {
  let category = await ExpenseCategory.findOne({ name: "Petty Cash" });
  if (!category) {
    category = await ExpenseCategory.create({ name: "Petty Cash" });
  }
  return category;
}

export async function syncPettyCashExpense(transaction) {
  const sourceQuery = {
    sourceType: "petty-cash-transaction",
    sourceId: String(transaction._id),
  };

  const existingExpense = transaction.expense
    ? await Expense.findById(transaction.expense)
    : await Expense.findOne(sourceQuery);

  if (transaction.status !== "Paid") {
    if (existingExpense) {
      await Expense.findByIdAndDelete(existingExpense._id);
    }
    return null;
  }

  const category = await ensurePettyCashCategory();
  const expenseDate = transaction.paidAt || transaction.requestDate || new Date();
  const paidBy = transaction.paidBy || transaction.requestedBy || null;

  const expensePayload = {
    title: `Petty Cash - ${transaction.vendorName}: ${transaction.purpose}`,
    amount: Number(transaction.amount) || 0,
    categoryId: category._id,
    categoryName: "Petty Cash",
    description: [transaction.description, transaction.paymentReference]
      .filter(Boolean)
      .join(" | "),
    locationName: transaction.location,
    expenseDate: expenseDate,
    staffName: paidBy?.name || "",
    staffId: paidBy?._id || null,
    sourceType: "petty-cash-transaction",
    sourceId: String(transaction._id),
    vendor: {
      _id: transaction.vendor,
      companyName: transaction.vendorName,
    },
  };

  if (existingExpense) {
    await Expense.findByIdAndUpdate(existingExpense._id, expensePayload, {
      new: true,
      runValidators: true,
    });
    return existingExpense._id;
  }

  const createdExpense = await Expense.create(expensePayload);
  return createdExpense._id;
}

export async function recalculateDailyCashForLocation(location) {
  if (!location) return;

  const records = await DailyCash.find({ location }).sort({ date: 1 });
  if (records.length === 0) return;

  let lastCashAtHand = 0;

  for (const record of records) {
    const start = new Date(record.date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const expenses = await Expense.find({
      locationName: location,
      expenseDate: { $gte: start, $lt: end },
    }).lean();

    const totalPayments = expenses.reduce(
      (sum, expense) => sum + Number(expense.amount || 0),
      0
    );

    const cashToday = Number(record.amount || 0);
    const totalCashAvailable = lastCashAtHand + cashToday;
    const cashAtHand = totalCashAvailable - totalPayments;

    record.cashBroughtForward = lastCashAtHand;
    record.totalPayments = totalPayments;
    record.totalCashAvailable = totalCashAvailable;
    record.cashAtHand = cashAtHand;
    await record.save();

    lastCashAtHand = cashAtHand;
  }
}
