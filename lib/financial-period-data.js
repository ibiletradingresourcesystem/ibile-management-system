/**
 * The one query behind every money report.
 *
 * The tax dashboard, the tax PDF and the reconciliation used to each write their
 * own Mongo filter, which is how they ended up on different data: one asked only
 * for completed sales, another counted voided ones, and expenses were picked up
 * by the date the row was created rather than the date of the spend. They all
 * load a period through here now, so a change to the rules reaches all of them.
 *
 * See lib/financial-basis.js for what the rules are.
 */
import { mongooseConnect } from "@/lib/mongodb";
import CashEntry from "@/models/CashEntry";
import Expense from "@/models/Expense";
import ExpenseCategory from "@/models/ExpenseCategory";
import Product from "@/models/Product";
import Transaction from "@/models/Transactions";
import { SALE_STATUSES } from "@/lib/financial-basis";

/** Everything the basis needs off a transaction, and nothing else. */
export const TRANSACTION_BASIS_FIELDS =
  "_id createdAt updatedAt status subStatus total tax subtotal refundedAt refundReason " +
  "creditOriginalTotal creditPaidAmount location staffName items";

/**
 * A refund is marked "void" as well as "refunded" by the till; only a void that is not a refund
 * is a sale that never happened. (See isVoided in the basis.)
 */
const NOT_VOIDED = { $or: [{ subStatus: { $ne: "void" } }, { status: "refunded" }] };

/** Sales made inside the period, voided ones left out. A sale refunded since still happened. */
export function salesQuery(start, end) {
  return {
    createdAt: { $gte: start, $lte: end },
    status: { $in: SALE_STATUSES },
    ...NOT_VOIDED,
  };
}

/**
 * Refunds given inside the period, whatever period the sale belonged to. A sale
 * from March refunded in April belongs to April as a reversal, which is how the
 * books post it, so the tax side reads it the same way.
 */
export function refundsQuery(start, end) {
  return {
    status: "refunded",
    refundedAt: { $gte: start, $lte: end },
  };
}

/** Voided sales in the period — counted, never totalled, so a report can say how many. */
export function voidedQuery(start, end) {
  return { createdAt: { $gte: start, $lte: end }, subStatus: "void", status: { $ne: "refunded" } };
}

/**
 * "Other payment out" cash entries are running costs too: the books charge them to General
 * Expense, so they are counted here with the expenses, or the two would disagree on profit.
 */
export function otherPaymentsQuery(start, end) {
  return { purpose: "other-payment", date: { $gte: start, $lte: end } };
}

/** A cash entry in the shape the basis reads an expense in. */
export function cashEntryAsExpense(entry = {}) {
  return {
    _id: entry._id,
    amount: Number(entry.amount) || 0,
    expenseDate: entry.date || entry.createdAt,
    // Named so the stock-buying keywords never match it: the books post it as an expense
    categoryName: "Cash entry: other payment",
    locationName: entry.location || "",
    source: "cash-entry",
  };
}

/** Expenses by the date they were incurred, falling back to when they were recorded. */
export function expensesQuery(start, end) {
  return {
    $or: [
      { expenseDate: { $gte: start, $lte: end } },
      { expenseDate: null, createdAt: { $gte: start, $lte: end } },
      { expenseDate: { $exists: false }, createdAt: { $gte: start, $lte: end } },
    ],
  };
}

/** Cost and VAT rate for every product, keyed by id, for the lines that carry neither. */
export async function loadProductBasisMap() {
  const products = await Product.find({}, { _id: 1, costPrice: 1, taxRate: 1 }).lean().exec();
  const productMap = {};
  for (const product of products) {
    productMap[String(product._id)] = {
      costPrice: product.costPrice || 0,
      taxRate: product.taxRate || 0,
    };
  }
  return productMap;
}

/**
 * How each expense category is treated, keyed by id and by lower-cased name, so
 * stock buying can be told apart from running costs.
 */
export async function loadCategoryTreatments() {
  const categories = await ExpenseCategory.find({}, { _id: 1, name: 1, treatment: 1 }).lean().exec();
  const treatments = {};
  for (const category of categories) {
    // An unset treatment is left out on purpose: the basis then reads the
    // category name rather than a default that was never chosen.
    if (category.treatment !== "EXPENSE" && category.treatment !== "INVENTORY") continue;
    treatments[String(category._id)] = category.treatment;
    if (category.name) treatments[String(category.name).trim().toLowerCase()] = category.treatment;
  }
  return treatments;
}

/**
 * Sales, refunds, expenses and product costs for one period, ready to hand to
 * summarizePeriod().
 */
export async function loadFinancialPeriod({ start, end }) {
  await mongooseConnect();

  const [sales, refunds, expenses, otherPayments, voidedCount, productMap, categoryTreatments] = await Promise.all([
    Transaction.find(salesQuery(start, end)).select(TRANSACTION_BASIS_FIELDS).lean().exec(),
    Transaction.find(refundsQuery(start, end)).select(TRANSACTION_BASIS_FIELDS).lean().exec(),
    Expense.find(expensesQuery(start, end)).lean().exec(),
    CashEntry.find(otherPaymentsQuery(start, end)).lean().exec(),
    Transaction.countDocuments(voidedQuery(start, end)),
    loadProductBasisMap(),
    loadCategoryTreatments(),
  ]);

  return {
    sales,
    refunds,
    expenses: [...expenses, ...otherPayments.map(cashEntryAsExpense)],
    voidedCount,
    productMap,
    categoryTreatments,
  };
}
