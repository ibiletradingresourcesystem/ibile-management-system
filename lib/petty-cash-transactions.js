import Expense from "@/models/Expense";
import ExpenseCategory from "@/models/ExpenseCategory";

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
