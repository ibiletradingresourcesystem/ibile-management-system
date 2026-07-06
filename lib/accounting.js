/**
 * Double-Entry Accounting Auto-Posting Utility
 * Auto-creates journal entries from sales, expenses, PO payments, and refunds.
 */

import { mongooseConnect } from "@/lib/mongodb";
import Account from "@/models/Account";
import JournalEntry, { createJournalEntry } from "@/models/JournalEntry";
import Expense from "@/models/Expense";
import Product from "@/models/Product";
import PurchaseOrder from "@/models/PurchaseOrder";
import Transaction from "@/models/Transactions";

const SYS = {
  CASH: "1000", BANK: "1010", AR: "1100", INVENTORY: "1200",
  AP: "2000", TAX: "2100", REVENUE: "4000", COGS: "5000",
  SALARY: "6000", EXPENSE: "6100", REFUND: "6200",
};

const DEFAULT_SYNC_INTERVAL_MS = Math.max(0, Number(process.env.ACCOUNTING_SYNC_INTERVAL_MS) || 5 * 60 * 1000);

const accountCache = new Map();
const productCostCache = new Map();
const syncState = {
  inFlight: null,
  lastCompletedAt: null,
  lastDurationMs: null,
  lastSummary: null,
  lastError: null,
};
const EXPENSE_ACCOUNT_RULES = [
  { code: SYS.SALARY, fallback: SYS.EXPENSE, keywords: ["salary", "payroll", "wage", "staff"] },
  { code: "6300", fallback: SYS.EXPENSE, keywords: ["rent", "lease"] },
  { code: "6400", fallback: SYS.EXPENSE, keywords: ["utility", "utilities", "electric", "electricity", "water", "internet", "airtime"] },
  { code: "6500", fallback: SYS.EXPENSE, keywords: ["transport", "travel", "fuel", "delivery", "logistics"] },
  { code: "6700", fallback: SYS.EXPENSE, keywords: ["insurance"] },
  { code: "6800", fallback: SYS.EXPENSE, keywords: ["marketing", "advert", "advertising", "branding", "promotion", "social media"] },
  { code: "6900", fallback: SYS.EXPENSE, keywords: ["misc", "miscellaneous", "repair", "maintenance", "consumable", "office"] },
];

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundCurrency(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function normalizeId(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value.toString === "function") {
    const normalized = value.toString().trim();
    return normalized || null;
  }
  return null;
}

function normalizeSearchText(...values) {
  return values
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase())
    .join(" ");
}

function isBankTender(tenderType, tenderName) {
  const normalized = normalizeSearchText(tenderType, tenderName);
  return ["card", "transfer", "bank", "pos", "visa", "mastercard", "mobile money", "wallet"].some((token) => normalized.includes(token));
}

function getSettlementAccountCode(tenderType, tenderName) {
  return isBankTender(tenderType, tenderName) ? SYS.BANK : SYS.CASH;
}

function buildSettlementLines({ total, tenderType, tenderPayments, direction, description }) {
  const rawPayments = Array.isArray(tenderPayments)
    ? tenderPayments
        .map((payment) => ({
          tenderType: payment?.tenderType || tenderType,
          tenderName: payment?.tenderName || payment?.tenderType || tenderType,
          amount: roundCurrency(payment?.amount),
        }))
        .filter((payment) => payment.amount > 0)
    : [];

  const targetTotal = roundCurrency(total || rawPayments.reduce((sum, payment) => sum + payment.amount, 0));
  const normalizedPayments = rawPayments.length > 0
    ? rawPayments
    : targetTotal > 0
      ? [{ tenderType, tenderName: tenderType, amount: targetTotal }]
      : [];

  if (normalizedPayments.length === 0) return [];

  const normalizedTotal = roundCurrency(normalizedPayments.reduce((sum, payment) => sum + payment.amount, 0));
  const difference = roundCurrency(targetTotal - normalizedTotal);
  if (Math.abs(difference) >= 0.01) {
    const lastIndex = normalizedPayments.length - 1;
    normalizedPayments[lastIndex] = {
      ...normalizedPayments[lastIndex],
      amount: roundCurrency(normalizedPayments[lastIndex].amount + difference),
    };
  }

  return normalizedPayments
    .filter((payment) => payment.amount > 0)
    .map((payment) => {
      const amount = roundCurrency(payment.amount);
      const lineDescription = normalizedPayments.length > 1
        ? `${description} (${payment.tenderName || payment.tenderType || "payment"})`
        : description;

      return {
        code: getSettlementAccountCode(payment.tenderType, payment.tenderName),
        fallback: SYS.CASH,
        debit: direction === "debit" ? amount : 0,
        credit: direction === "credit" ? amount : 0,
        description: lineDescription,
      };
    });
}

function getExpenseAccountRule(expense) {
  const normalized = normalizeSearchText(expense?.categoryName, expense?.title, expense?.description);
  return EXPENSE_ACCOUNT_RULES.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword))) || null;
}

async function ensureProductCosts(productIds = []) {
  const missingIds = Array.from(new Set(productIds.filter(Boolean))).filter((productId) => !productCostCache.has(productId));
  if (missingIds.length === 0) return;

  const products = await Product.find({ _id: { $in: missingIds } }).select("_id costPrice").lean();
  const foundIds = new Set();

  for (const product of products) {
    const productId = normalizeId(product?._id);
    if (!productId) continue;
    productCostCache.set(productId, roundCurrency(product.costPrice));
    foundIds.add(productId);
  }

  for (const productId of missingIds) {
    if (!foundIds.has(productId)) {
      productCostCache.set(productId, 0);
    }
  }
}

async function calculateTransactionCost(tx) {
  const items = Array.isArray(tx?.items) ? tx.items : [];
  const productIds = items.map((item) => normalizeId(item?.productId)).filter(Boolean);
  await ensureProductCosts(productIds);

  return roundCurrency(items.reduce((sum, item) => {
    const quantity = toNumber(item?.qty ?? item?.quantity);
    if (quantity <= 0) return sum;

    const directCost = toNumber(item?.costPrice ?? item?.unitCost ?? item?.purchasePrice);
    if (directCost > 0) {
      return sum + (quantity * directCost);
    }

    const productId = normalizeId(item?.productId);
    const fallbackCost = productId ? toNumber(productCostCache.get(productId)) : 0;
    return sum + (quantity * fallbackCost);
  }, 0));
}

async function getAccount(code) {
  if (!code) return null;
  if (accountCache.has(code)) {
    return accountCache.get(code);
  }

  const account = await Account.findOne({ code, isActive: true }).lean();
  accountCache.set(code, account || null);
  return account || null;
}

/** Shared helper — resolves account codes and creates a posted journal entry */
async function createAutoEntry({ date, description, lines, referenceType, referenceId, reference, location }) {
  await mongooseConnect();

  const resolvedLines = [];
  for (const line of lines) {
    let account = await getAccount(line.code);
    if (!account && line.fallback) account = await getAccount(line.fallback);
    if (!account) return null;
    resolvedLines.push({
      account: account._id,
      accountCode: account.code,
      accountName: account.name,
      debit: roundCurrency(line.debit),
      credit: roundCurrency(line.credit),
      description: line.description || "",
    });
  }

  if (resolvedLines.length < 2) return null;

  const totalDebit = roundCurrency(resolvedLines.reduce((sum, line) => sum + line.debit, 0));
  const totalCredit = roundCurrency(resolvedLines.reduce((sum, line) => sum + line.credit, 0));
  if (Math.abs(totalDebit - totalCredit) >= 0.01) return null;

  const existingEntries = referenceType && referenceId
    ? await JournalEntry.find({ referenceType, referenceId }).sort({ createdAt: 1 })
    : [];
  const activeEntries = existingEntries.filter((entry) => entry.status !== "VOIDED");
  const existingEntry = activeEntries[0] || existingEntries[0] || null;

  if (existingEntries.length > 1 && activeEntries.length > 1) {
    await Promise.all(
      activeEntries.slice(1).map((entry) => {
        entry.status = "VOIDED";
        entry.voidedAt = new Date();
        entry.voidReason = "Superseded by synchronized system entry";
        return entry.save();
      })
    );
  }

  if (existingEntry?.status === "VOIDED") {
    return existingEntry;
  }

  const entryPayload = {
    date: date || new Date(),
    description,
    lines: resolvedLines,
    reference: reference || "",
    referenceType,
    referenceId,
    status: "POSTED",
    postedAt: existingEntry?.postedAt || new Date(),
    location: location || "",
  };

  if (existingEntry) {
    existingEntry.set(entryPayload);
    return existingEntry.save();
  }

  return createJournalEntry(entryPayload);
}

/** POS Sale → Debit Cash/Bank, Debit COGS, Credit Revenue + Tax + Inventory */
export async function postSaleEntry(tx) {
  const total = roundCurrency(tx?.total);
  if (total <= 0) return null;

  const tax = roundCurrency(tx?.tax);
  const salesValue = roundCurrency(Math.max(total - tax, 0));
  const costOfGoodsSold = await calculateTransactionCost(tx);
  const lines = [
    ...buildSettlementLines({
      total,
      tenderType: tx?.tenderType,
      tenderPayments: tx?.tenderPayments,
      direction: "debit",
      description: "Payment received",
    }),
    { code: SYS.REVENUE, credit: salesValue, description: `Sale - ${tx.items?.length || 0} items` },
  ];
  if (tax > 0) {
    lines.push({ code: SYS.TAX, credit: tax, description: "Tax collected" });
  }
  if (costOfGoodsSold > 0) {
    lines.push({ code: SYS.COGS, debit: costOfGoodsSold, description: "Cost of goods sold" });
    lines.push({ code: SYS.INVENTORY, credit: costOfGoodsSold, description: "Inventory issued for sale" });
  }

  return createAutoEntry({
    date: tx.createdAt, description: `POS Sale - ${tx.staffName || "Staff"} at ${tx.location || ""}`,
    lines, referenceType: "SALE", referenceId: tx._id, reference: tx._id?.toString(), location: tx.location,
  });
}

function getCreditPaymentTotal(tx) {
  const payments = Array.isArray(tx?.creditPayments) ? tx.creditPayments : [];
  if (payments.length > 0) {
    return roundCurrency(payments.reduce((sum, payment) => sum + roundCurrency(payment?.amount), 0));
  }
  return roundCurrency(tx?.creditPaidAmount);
}

function normalizeCreditPayments(tx) {
  const payments = Array.isArray(tx?.creditPayments) ? tx.creditPayments : [];
  if (payments.length > 0) {
    return payments
      .map((payment) => ({
        tenderType: payment?.tenderType || payment?.tenderName || "CASH",
        tenderName: payment?.tenderName || payment?.tenderType || "Cash",
        amount: roundCurrency(payment?.amount),
      }))
      .filter((payment) => payment.amount > 0);
  }

  const amount = roundCurrency(tx?.creditPaidAmount);
  return amount > 0
    ? [{ tenderType: tx?.tenderType || "CASH", tenderName: tx?.tenderType || "Cash", amount }]
    : [];
}

/** Credit Sale → Debit Accounts Receivable, Debit COGS, Credit Revenue + Tax + Inventory */
export async function postCreditSaleEntry(tx) {
  const total = roundCurrency(tx?.creditOriginalTotal || tx?.total);
  if (total <= 0) return null;

  const tax = roundCurrency(tx?.tax);
  const salesValue = roundCurrency(Math.max(total - tax, 0));
  const costOfGoodsSold = await calculateTransactionCost(tx);
  const customerName = tx?.creditCustomerName || tx?.customerName || "Credit customer";
  const lines = [
    { code: SYS.AR, debit: total, description: `Credit receivable - ${customerName}` },
    { code: SYS.REVENUE, credit: salesValue, description: `Credit sale - ${tx?.items?.length || 0} items` },
  ];

  if (tax > 0) {
    lines.push({ code: SYS.TAX, credit: tax, description: "Tax on credit sale" });
  }
  if (costOfGoodsSold > 0) {
    lines.push({ code: SYS.COGS, debit: costOfGoodsSold, description: "Cost of goods sold on credit" });
    lines.push({ code: SYS.INVENTORY, credit: costOfGoodsSold, description: "Inventory issued for credit sale" });
  }

  return createAutoEntry({
    date: tx?.createdAt,
    description: `Credit Sale - ${customerName}`,
    lines,
    referenceType: "CREDIT_SALE",
    referenceId: tx?._id,
    reference: tx?._id?.toString(),
    location: tx?.location,
  });
}

/** Credit Recovery → Debit Cash/Bank, Credit Accounts Receivable */
export async function postCreditRecoveryEntry(tx) {
  const totalPaid = getCreditPaymentTotal(tx);
  if (totalPaid <= 0) return null;

  const payments = normalizeCreditPayments(tx);
  const latestPayment = payments.length > 0
    ? (Array.isArray(tx?.creditPayments) ? tx.creditPayments[tx.creditPayments.length - 1] : null)
    : null;
  const customerName = tx?.creditCustomerName || tx?.customerName || "Credit customer";
  const lines = [
    ...buildSettlementLines({
      total: totalPaid,
      tenderType: latestPayment?.tenderType || tx?.tenderType || "CASH",
      tenderPayments: payments,
      direction: "debit",
      description: "Credit payment received",
    }),
    { code: SYS.AR, credit: totalPaid, description: `Reduce receivable - ${customerName}` },
  ];

  return createAutoEntry({
    date: latestPayment?.paidAt || tx?.creditPaidAt || tx?.updatedAt || new Date(),
    description: `Credit Recovery - ${customerName}`,
    lines,
    referenceType: "CREDIT_PAYMENT",
    referenceId: tx?._id,
    reference: tx?._id?.toString(),
    location: tx?.location,
  });
}

/** Expense → Debit Expense, Credit Cash */
export async function postExpenseEntry(exp) {
  const accountRule = getExpenseAccountRule(exp);
  const accountCode = accountRule?.code || SYS.EXPENSE;
  const fallbackCode = accountRule?.fallback || SYS.EXPENSE;

  return createAutoEntry({
    date: exp.expenseDate || exp.createdAt,
    description: `Expense: ${exp.title} - ${exp.categoryName || "General"}`,
    lines: [
      { code: accountCode, fallback: fallbackCode, debit: exp.amount, description: exp.title },
      { code: SYS.CASH, credit: exp.amount, description: `Payment for: ${exp.title}` },
    ],
    referenceType: "EXPENSE", referenceId: exp._id, reference: exp._id?.toString(), location: exp.locationName,
  });
}

/** PO Payment → Debit Inventory, Credit Cash */
export async function postPurchaseOrderPayment(po, amount) {
  const paymentAmount = roundCurrency(amount ?? po?.paymentMade);
  if (paymentAmount <= 0) return null;

  return createAutoEntry({
    date: po?.paymentDate ? new Date(po.paymentDate) : po?.updatedAt || new Date(),
    description: `PO Payment: ${po.orderRef} - ${po.vendorName}`,
    lines: [
      { code: SYS.INVENTORY, debit: paymentAmount, description: `Stock purchase from ${po.vendorName}` },
      { code: SYS.CASH, credit: paymentAmount, description: `Payment for PO ${po.orderRef}` },
    ],
    referenceType: "PURCHASE_ORDER", referenceId: po._id, reference: po.orderRef, location: po.location,
  });
}

/** Refund → Debit Refund Expense + Inventory, Credit Cash + COGS */
export async function postRefundEntry(tx) {
  const total = roundCurrency(tx?.total);
  if (total <= 0) return null;

  const restockValue = await calculateTransactionCost(tx);
  const lines = [
    { code: SYS.REFUND, debit: total, description: "Refund for transaction" },
    ...buildSettlementLines({
      total,
      tenderType: tx?.tenderType,
      tenderPayments: tx?.tenderPayments,
      direction: "credit",
      description: "Refund paid",
    }),
  ];

  if (restockValue > 0) {
    lines.push({ code: SYS.INVENTORY, debit: restockValue, description: "Inventory returned from refund" });
    lines.push({ code: SYS.COGS, credit: restockValue, description: "Reverse cost of goods sold" });
  }

  return createAutoEntry({
    date: tx.refundedAt,
    description: `Refund - ${tx.refundReason || "Customer refund"}`,
    lines,
    referenceType: "REFUND", referenceId: tx._id, reference: tx._id?.toString(), location: tx.location,
  });
}

export async function syncSystemAccountingEntries() {
  await mongooseConnect();
  await seedDefaultAccounts();

  const [transactions, expenses, purchaseOrders] = await Promise.all([
    Transaction.find({ status: { $in: ["completed", "refunded", "credit"] } })
      .select("_id createdAt updatedAt refundedAt refundReason status total tax tenderType tenderPayments location staffName customerName creditCustomerName creditOriginalTotal creditPaidAmount creditPaidAt creditPayments items")
      .lean(),
    Expense.find({ amount: { $gt: 0 } })
      .select("_id createdAt expenseDate title amount categoryName description locationName")
      .lean(),
    PurchaseOrder.find({ paymentMade: { $gt: 0 } })
      .select("_id orderRef vendorName location paymentMade paymentDate updatedAt")
      .lean(),
  ]);

  const salesTransactions = transactions.filter((transaction) => transaction.status !== "credit");
  const creditTransactions = transactions.filter((transaction) => transaction.status === "credit");
  const creditRecoveryTransactions = creditTransactions.filter((transaction) => getCreditPaymentTotal(transaction) > 0);

  const operations = [
    ...salesTransactions.map((transaction) => postSaleEntry(transaction)),
    ...creditTransactions.map((transaction) => postCreditSaleEntry(transaction)),
    ...creditRecoveryTransactions.map((transaction) => postCreditRecoveryEntry(transaction)),
    ...transactions
      .filter((transaction) => transaction.status === "refunded" && transaction.refundedAt)
      .map((transaction) => postRefundEntry(transaction)),
    ...expenses.map((expense) => postExpenseEntry(expense)),
    ...purchaseOrders.map((purchaseOrder) => postPurchaseOrderPayment(purchaseOrder, purchaseOrder.paymentMade)),
  ];

  const results = await Promise.allSettled(operations);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw failures[0].reason;
  }

  return {
    salesSynced: salesTransactions.length,
    creditSalesSynced: creditTransactions.length,
    creditRecoveriesSynced: creditRecoveryTransactions.length,
    refundsSynced: transactions.filter((transaction) => transaction.status === "refunded" && transaction.refundedAt).length,
    expensesSynced: expenses.length,
    purchaseOrdersSynced: purchaseOrders.length,
  };
}

export function getAccountingSyncStatus() {
  return {
    isSyncing: Boolean(syncState.inFlight),
    lastSyncAt: syncState.lastCompletedAt ? syncState.lastCompletedAt.toISOString() : null,
    lastDurationMs: syncState.lastDurationMs,
    lastSummary: syncState.lastSummary,
    lastError: syncState.lastError,
    minIntervalMs: DEFAULT_SYNC_INTERVAL_MS,
  };
}

export async function ensureAccountingEntriesSynced(options = {}) {
  const { force = false, minIntervalMs = DEFAULT_SYNC_INTERVAL_MS } = options;

  if (syncState.inFlight) {
    return syncState.inFlight;
  }

  const lastCompletedAtMs = syncState.lastCompletedAt ? syncState.lastCompletedAt.getTime() : 0;
  const isFresh = !force && lastCompletedAtMs > 0 && (Date.now() - lastCompletedAtMs) < minIntervalMs;

  if (isFresh) {
    return {
      skipped: true,
      syncedAt: syncState.lastCompletedAt.toISOString(),
      durationMs: syncState.lastDurationMs,
      ...syncState.lastSummary,
    };
  }

  const startedAt = Date.now();
  syncState.lastError = null;
  syncState.inFlight = syncSystemAccountingEntries()
    .then((summary) => {
      syncState.lastCompletedAt = new Date();
      syncState.lastDurationMs = Date.now() - startedAt;
      syncState.lastSummary = summary;

      return {
        skipped: false,
        syncedAt: syncState.lastCompletedAt.toISOString(),
        durationMs: syncState.lastDurationMs,
        ...summary,
      };
    })
    .catch((error) => {
      syncState.lastError = error?.message || "Accounting sync failed";
      throw error;
    })
    .finally(() => {
      syncState.inFlight = null;
    });

  return syncState.inFlight;
}

/**
 * Seed default chart of accounts if empty
 */
export async function seedDefaultAccounts() {
  await mongooseConnect();
  const count = await Account.countDocuments();
  if (count > 0) return false;

  const defaults = [
    // Assets
    { code: "1000", name: "Cash", type: "ASSET", subType: "Current Asset", normalBalance: "DEBIT", isSystem: true },
    { code: "1010", name: "Bank", type: "ASSET", subType: "Current Asset", normalBalance: "DEBIT", isSystem: true },
    { code: "1100", name: "Accounts Receivable", type: "ASSET", subType: "Current Asset", normalBalance: "DEBIT", isSystem: true },
    { code: "1200", name: "Inventory", type: "ASSET", subType: "Current Asset", normalBalance: "DEBIT", isSystem: true },
    { code: "1300", name: "Prepaid Expenses", type: "ASSET", subType: "Current Asset", normalBalance: "DEBIT" },
    { code: "1500", name: "Equipment", type: "ASSET", subType: "Fixed Asset", normalBalance: "DEBIT" },
    { code: "1510", name: "Furniture & Fixtures", type: "ASSET", subType: "Fixed Asset", normalBalance: "DEBIT" },
    { code: "1600", name: "Accumulated Depreciation", type: "ASSET", subType: "Contra Asset", normalBalance: "CREDIT" },

    // Liabilities
    { code: "2000", name: "Accounts Payable", type: "LIABILITY", subType: "Current Liability", normalBalance: "CREDIT", isSystem: true },
    { code: "2100", name: "Tax Payable", type: "LIABILITY", subType: "Current Liability", normalBalance: "CREDIT", isSystem: true },
    { code: "2200", name: "Salaries Payable", type: "LIABILITY", subType: "Current Liability", normalBalance: "CREDIT" },
    { code: "2300", name: "Loan Payable", type: "LIABILITY", subType: "Long-term Liability", normalBalance: "CREDIT" },

    // Equity
    { code: "3000", name: "Owner's Equity", type: "EQUITY", subType: "Owner's Equity", normalBalance: "CREDIT", isSystem: true },
    { code: "3100", name: "Retained Earnings", type: "EQUITY", subType: "Retained Earnings", normalBalance: "CREDIT", isSystem: true },
    { code: "3200", name: "Owner's Drawings", type: "EQUITY", subType: "Drawings", normalBalance: "DEBIT" },

    // Revenue
    { code: "4000", name: "Sales Revenue", type: "REVENUE", subType: "Operating Revenue", normalBalance: "CREDIT", isSystem: true },
    { code: "4100", name: "Service Revenue", type: "REVENUE", subType: "Operating Revenue", normalBalance: "CREDIT" },
    { code: "4200", name: "Other Income", type: "REVENUE", subType: "Non-Operating Revenue", normalBalance: "CREDIT" },

    // Expenses
    { code: "5000", name: "Cost of Goods Sold", type: "EXPENSE", subType: "Cost of Sales", normalBalance: "DEBIT", isSystem: true },
    { code: "6000", name: "Salary Expense", type: "EXPENSE", subType: "Operating Expense", normalBalance: "DEBIT", isSystem: true },
    { code: "6100", name: "General Expense", type: "EXPENSE", subType: "Operating Expense", normalBalance: "DEBIT", isSystem: true },
    { code: "6200", name: "Refund Expense", type: "EXPENSE", subType: "Operating Expense", normalBalance: "DEBIT", isSystem: true },
    { code: "6300", name: "Rent Expense", type: "EXPENSE", subType: "Operating Expense", normalBalance: "DEBIT" },
    { code: "6400", name: "Utilities Expense", type: "EXPENSE", subType: "Operating Expense", normalBalance: "DEBIT" },
    { code: "6500", name: "Transport Expense", type: "EXPENSE", subType: "Operating Expense", normalBalance: "DEBIT" },
    { code: "6600", name: "Depreciation Expense", type: "EXPENSE", subType: "Operating Expense", normalBalance: "DEBIT" },
    { code: "6700", name: "Insurance Expense", type: "EXPENSE", subType: "Operating Expense", normalBalance: "DEBIT" },
    { code: "6800", name: "Marketing Expense", type: "EXPENSE", subType: "Operating Expense", normalBalance: "DEBIT" },
    { code: "6900", name: "Miscellaneous Expense", type: "EXPENSE", subType: "Operating Expense", normalBalance: "DEBIT" },
  ];

  await Account.insertMany(defaults);
  return true;
}
