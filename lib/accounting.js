/**
 * Double-Entry Accounting Auto-Posting Utility
 * Auto-creates journal entries from sales, expenses, PO payments, and refunds.
 */

import { mongooseConnect } from "@/lib/mongodb";
import Account from "@/models/Account";
import JournalEntry, { createJournalEntry } from "@/models/JournalEntry";
import Expense from "@/models/Expense";
import ExpenseCategory from "@/models/ExpenseCategory";
import Product from "@/models/Product";
import PurchaseOrder from "@/models/PurchaseOrder";
import Transaction from "@/models/Transactions";
import { isStockPurchase, isVoided, saleCogs, saleGross, saleVat } from "@/lib/financial-basis";
import { deriveVendorCredit } from "@/lib/orderPayments";

const SYS = {
  CASH: "1000", BANK: "1010", AR: "1100", INVENTORY: "1200", VENDOR_PREPAID: "1300",
  AP: "2000", TAX: "2100", REVENUE: "4000", COGS: "5000",
  SALARY: "6000", EXPENSE: "6100", REFUND: "6200",
};

const DEFAULT_SYNC_INTERVAL_MS = Math.max(0, Number(process.env.ACCOUNTING_SYNC_INTERVAL_MS) || 5 * 60 * 1000);

const accountCache = new Map();
/** productId -> { costPrice, taxRate }, shared by the cost and the VAT split. */
const productBasisCache = new Map();
const syncState = {
  inFlight: null,
  lastCompletedAt: null,
  lastDurationMs: null,
  lastSummary: null,
  lastError: null,
};

let _seedChecked = false;
/** Expense category treatments, refreshed at most once a minute. */
const treatmentCache = { map: null, loadedAt: 0 };
const TREATMENT_TTL_MS = 60 * 1000;
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

/**
 * Which categories the business has marked as stock buying. Read here rather
 * than passed in, because an expense is posted from several places.
 */
async function getCategoryTreatments() {
  const now = Date.now();
  if (treatmentCache.map && now - treatmentCache.loadedAt < TREATMENT_TTL_MS) {
    return treatmentCache.map;
  }

  const categories = await ExpenseCategory.find({}, { _id: 1, name: 1, treatment: 1 }).lean();
  const map = {};
  for (const category of categories) {
    // Unset stays out, so the category name still decides (see the basis module).
    if (category.treatment !== "EXPENSE" && category.treatment !== "INVENTORY") continue;
    map[String(category._id)] = category.treatment;
    if (category.name) map[String(category.name).trim().toLowerCase()] = category.treatment;
  }

  treatmentCache.map = map;
  treatmentCache.loadedAt = now;
  return map;
}

function getExpenseAccountRule(expense) {
  const normalized = normalizeSearchText(expense?.categoryName, expense?.title, expense?.description);
  return EXPENSE_ACCOUNT_RULES.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword))) || null;
}

async function ensureProductBasis(productIds = []) {
  const missingIds = Array.from(new Set(productIds.filter(Boolean))).filter((productId) => !productBasisCache.has(productId));
  if (missingIds.length === 0) return;

  const products = await Product.find({ _id: { $in: missingIds } }).select("_id costPrice taxRate").lean();
  const foundIds = new Set();

  for (const product of products) {
    const productId = normalizeId(product?._id);
    if (!productId) continue;
    productBasisCache.set(productId, {
      costPrice: roundCurrency(product.costPrice),
      taxRate: toNumber(product.taxRate),
    });
    foundIds.add(productId);
  }

  for (const productId of missingIds) {
    if (!foundIds.has(productId)) {
      productBasisCache.set(productId, { costPrice: 0, taxRate: 0 });
    }
  }
}

/** Costs and VAT rates for the products on a sale, in the shape the basis wants. */
async function buildTransactionBasis(tx) {
  const items = Array.isArray(tx?.items) ? tx.items : [];
  const productIds = items.map((item) => normalizeId(item?.productId)).filter(Boolean);
  await ensureProductBasis(productIds);

  const productMap = {};
  for (const productId of productIds) {
    productMap[productId] = productBasisCache.get(productId) || { costPrice: 0, taxRate: 0 };
  }
  return productMap;
}

/** Cost of the goods on a sale — the same figure the tax report reads. */
async function calculateTransactionCost(tx) {
  const productMap = await buildTransactionBasis(tx);
  return saleCogs(tx, productMap).cost;
}

/**
 * How a sale splits between takings and VAT held for the taxman. The tax the POS
 * recorded is used as-is; a sale with none is split by the product VAT rates
 * rather than being credited to revenue in full, which is what used to leave the
 * books and the tax report disagreeing.
 */
async function splitSaleValue(tx, total) {
  const productMap = await buildTransactionBasis(tx);
  const gross = roundCurrency(total);
  const tax = Math.min(roundCurrency(saleVat(tx, productMap).vat), gross);
  return { gross, tax, salesValue: roundCurrency(Math.max(gross - tax, 0)) };
}

/**
 * A sale that was voided never happened: any entry already posted for it is
 * struck off rather than left standing as income.
 */
async function voidEntriesFor(referenceType, referenceId, reason) {
  if (!referenceType || !referenceId) return null;
  await mongooseConnect();

  const entries = await JournalEntry.find({ referenceType, referenceId, status: { $ne: "VOIDED" } });
  await Promise.all(
    entries.map((entry) => {
      entry.status = "VOIDED";
      entry.voidedAt = new Date();
      entry.voidReason = reason;
      return entry.save();
    })
  );
  return entries.length;
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
  if (isVoided(tx)) {
    await voidEntriesFor("SALE", tx?._id, "Sale voided at the till");
    return null;
  }

  const total = saleGross(tx);
  if (total <= 0) return null;

  const { tax, salesValue } = await splitSaleValue(tx, total);
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
  if (isVoided(tx)) {
    await voidEntriesFor("CREDIT_SALE", tx?._id, "Credit sale voided at the till");
    return null;
  }

  const total = saleGross(tx);
  if (total <= 0) return null;

  const { tax, salesValue } = await splitSaleValue(tx, total);
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

/**
 * Expense → Debit Expense, Credit Cash.
 *
 * Unless it is stock buying, which is an asset swap — cash out, inventory in —
 * and only reaches the profit and loss statement as cost of goods sold when the
 * stock sells. Posting it as an expense as well charged it to profit twice.
 */
export async function postExpenseEntry(exp) {
  const treatments = await getCategoryTreatments();
  if (isStockPurchase(exp, treatments)) {
    return createAutoEntry({
      date: exp.expenseDate || exp.createdAt,
      description: `Stock Purchase: ${exp.title} - ${exp.categoryName || "Supplies"}`,
      lines: [
        { code: SYS.INVENTORY, debit: exp.amount, description: `Stock bought: ${exp.title}` },
        { code: SYS.CASH, credit: exp.amount, description: `Payment for stock: ${exp.title}` },
      ],
      referenceType: "EXPENSE", referenceId: exp._id, reference: exp._id?.toString(), location: exp.locationName,
    });
  }

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

/**
 * PO Payment → Debit Inventory for the goods that are in, Debit the vendor
 * prepayment for money they are still holding, Credit Cash for the lot.
 *
 * The whole payment used to be debited to Inventory, which put stock on the books
 * before it existed whenever a vendor was paid up front, and inflated it again
 * whenever a payment ran past what the order came to. What the vendor is holding
 * is an asset owed back by them, not stock on the shelf.
 */
export async function postPurchaseOrderPayment(po, amount) {
  const paymentAmount = roundCurrency(amount ?? po?.paymentMade);
  if (paymentAmount <= 0) return null;

  const heldByVendor = Math.min(
    paymentAmount,
    roundCurrency(
      deriveVendorCredit({
        grandTotal: po?.grandTotal,
        paymentMade: paymentAmount,
        payBeforeSupply: po?.payBeforeSupply,
        receivedStatus: po?.receivedStatus,
      })
    )
  );
  const stockValue = roundCurrency(paymentAmount - heldByVendor);

  const lines = [{ code: SYS.CASH, credit: paymentAmount, description: `Payment for PO ${po.orderRef}` }];
  if (stockValue > 0) {
    lines.push({ code: SYS.INVENTORY, debit: stockValue, description: `Stock purchase from ${po.vendorName}` });
  }
  if (heldByVendor > 0) {
    lines.push({
      code: SYS.VENDOR_PREPAID,
      fallback: SYS.INVENTORY,
      debit: heldByVendor,
      description: `Held by ${po.vendorName} — owed back in goods or cash`,
    });
  }

  return createAutoEntry({
    date: po?.paymentDate ? new Date(po.paymentDate) : po?.updatedAt || new Date(),
    description: `PO Payment: ${po.orderRef} - ${po.vendorName}`,
    lines,
    referenceType: "PURCHASE_ORDER", referenceId: po._id, reference: po.orderRef, location: po.location,
  });
}

/** Refund → Debit Refund Expense + Inventory, Credit Cash + COGS */
export async function postRefundEntry(tx) {
  if (isVoided(tx)) {
    await voidEntriesFor("REFUND", tx?._id, "Transaction voided at the till");
    return null;
  }

  const total = saleGross(tx);
  if (total <= 0) return null;

  // The customer gets the whole price back, but the VAT inside it is reclaimed
  // from the tax account instead of being written off as a cost of the refund.
  const { tax, salesValue } = await splitSaleValue(tx, total);
  const restockValue = await calculateTransactionCost(tx);
  const lines = [
    { code: SYS.REFUND, debit: salesValue, description: "Refund for transaction" },
    ...buildSettlementLines({
      total,
      tenderType: tx?.tenderType,
      tenderPayments: tx?.tenderPayments,
      direction: "credit",
      description: "Refund paid",
    }),
  ];

  if (tax > 0) {
    lines.push({ code: SYS.TAX, debit: tax, description: "VAT reclaimed on refund" });
  }

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
      .select("_id createdAt updatedAt refundedAt refundReason status subStatus total tax tenderType tenderPayments location staffName customerName creditCustomerName creditOriginalTotal creditPaidAmount creditPaidAt creditPayments items")
      .lean(),
    Expense.find({ amount: { $gt: 0 } })
      .select("_id createdAt expenseDate title amount categoryId category categoryName description locationName")
      .lean(),
    PurchaseOrder.find({ paymentMade: { $gt: 0 } })
      .select("_id orderRef vendorName location paymentMade paymentDate updatedAt grandTotal payBeforeSupply receivedStatus")
      .lean(),
  ]);

  // A void is not skipped over: its entry has to be struck off if one was posted
  // before the void, so voided sales go through the same posting calls.
  const salesTransactions = transactions.filter((transaction) => transaction.status !== "credit");
  const creditTransactions = transactions.filter((transaction) => transaction.status === "credit");
  const voidedTransactions = transactions.filter((transaction) => isVoided(transaction));
  const treatments = await getCategoryTreatments();
  const stockPurchaseExpenses = expenses.filter((expense) => isStockPurchase(expense, treatments));
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
    voidedStruckOff: voidedTransactions.length,
    salesSynced: salesTransactions.filter((transaction) => !isVoided(transaction)).length,
    creditSalesSynced: creditTransactions.length,
    creditRecoveriesSynced: creditRecoveryTransactions.length,
    refundsSynced: transactions.filter((transaction) => transaction.status === "refunded" && transaction.refundedAt).length,
    expensesSynced: expenses.length - stockPurchaseExpenses.length,
    stockPurchasesSynced: stockPurchaseExpenses.length,
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
  if (_seedChecked) return false;
  await mongooseConnect();
  const count = await Account.countDocuments();
  if (count > 0) { _seedChecked = true; return false; }

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
