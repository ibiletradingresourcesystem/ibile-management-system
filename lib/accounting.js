/**
 * Double-Entry Accounting Auto-Posting Utility
 * Auto-creates journal entries from sales, expenses, PO payments, and refunds.
 *
 * Each kind of record has one builder that says what it posts (saleDraft, refundDraft, …). A record
 * saved through the management app is posted on its own through createAutoEntry; the sync posts
 * every record in bulk with the same builders, so the two can never post a record differently.
 */

import { createHash } from "crypto";
import { mongooseConnect } from "@/lib/mongodb";
import Account from "@/models/Account";
import AccountingSyncState from "@/models/AccountingSyncState";
import JournalEntry, { createJournalEntry, reserveJournalEntryNumbers } from "@/models/JournalEntry";
import Expense from "@/models/Expense";
import ExpenseCategory from "@/models/ExpenseCategory";
import Product from "@/models/Product";
import PurchaseOrder from "@/models/PurchaseOrder";
import Transaction from "@/models/Transactions";
import { isStockPurchase, isVoided, saleCogs, saleGross, saleVat } from "@/lib/financial-basis";
import { deriveVendorCredit } from "@/lib/orderPayments";
import { cashEntryLines, describeCashEntry } from "@/lib/cashEntries";

const SYS = {
  CASH: "1000", BANK: "1010", AR: "1100", INVENTORY: "1200", VENDOR_PREPAID: "1300",
  AP: "2000", TAX: "2100", REVENUE: "4000", RETURNS: "4900", COGS: "5000",
  SALARY: "6000", EXPENSE: "6100", REFUND: "6200",
};

/** The subType that marks an account as one taken off sales revenue. */
const CONTRA_REVENUE = "Contra Revenue";

/**
 * Accounts the posting rules need that a chart seeded before them does not have. Added once, and
 * only where the code is free: an account a business made under that code stays theirs.
 */
const SYSTEM_ACCOUNTS = [
  {
    code: SYS.RETURNS,
    name: "Sales Returns & Refunds",
    type: "REVENUE",
    subType: CONTRA_REVENUE,
    normalBalance: "DEBIT",
    isSystem: true,
    description: "Refunds given to customers, taken off sales revenue in the period the money went back.",
  },
];

/** The kinds of entry the sync keeps in step with their records. Manual and cash entries are not. */
const SYNCED_TYPES = ["SALE", "CREDIT_SALE", "CREDIT_PAYMENT", "REFUND", "EXPENSE", "PURCHASE_ORDER"];

/**
 * Why the system strikes an entry off. One struck off for any of these is posted again if its
 * record counts once more; one a person voided is left alone.
 */
const SYSTEM_VOID = {
  voidedSale: "Sale voided at the till",
  voidedCreditSale: "Credit sale voided at the till",
  voidedTransaction: "Transaction voided at the till",
  superseded: "Superseded by synchronized system entry",
  gone: "No longer in the records it was posted from",
};
const SYSTEM_VOID_REASONS = new Set(Object.values(SYSTEM_VOID));

const DEFAULT_SYNC_INTERVAL_MS = Math.max(0, Number(process.env.ACCOUNTING_SYNC_INTERVAL_MS) || 5 * 60 * 1000);
/** How long a running sync holds the lock before another server may take it as dead. */
const SYNC_LOCK_MS = 10 * 60 * 1000;
const SYNC_STATE_ID = "accounting";
/** Writes the sync sends to the database at a time. */
const WRITE_BATCH = 500;

/** What the sync reads off a sale: the lines only as far as cost and VAT need them. */
const SALE_SYNC_FIELDS =
  "_id createdAt updatedAt refundedAt refundReason status subStatus total tax tenderType tenderPayments " +
  "location staffName customerName creditCustomerName creditOriginalTotal creditPaidAmount creditPaidAt creditPayments " +
  "items.productId items.qty items.quantity items.price items.salePriceIncTax items.costPrice items.unitCost " +
  "items.purchasePrice items.taxRate";

const accountCache = new Map();
/** productId -> { costPrice, taxRate }, shared by the cost and the VAT split. */
const productBasisCache = new Map();
/** A sync already running in this server, so a second request waits for it instead. */
const syncState = { inFlight: null };

let _seedChecked = false;
let systemAccountsChecked = false;
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

/**
 * How a sale splits between takings and VAT held for the taxman. The tax the POS
 * recorded is used as-is; a sale with none is split by the product VAT rates
 * rather than being credited to revenue in full, which is what used to leave the
 * books and the tax report disagreeing.
 */
function splitSaleValue(tx, total, productMap) {
  const gross = roundCurrency(total);
  const tax = Math.min(roundCurrency(saleVat(tx, productMap).vat), gross);
  return { gross, tax, salesValue: roundCurrency(Math.max(gross - tax, 0)) };
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

/* ───────────── What each record posts ───────────── */

/** POS Sale → Debit Cash/Bank, Debit COGS, Credit Revenue + Tax + Inventory */
function saleDraft(tx, productMap) {
  if (isVoided(tx)) return null;
  const total = saleGross(tx);
  if (total <= 0) return null;

  const { tax, salesValue } = splitSaleValue(tx, total, productMap);
  const costOfGoodsSold = saleCogs(tx, productMap).cost;
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

  return {
    date: tx.createdAt, description: `POS Sale - ${tx.staffName || "Staff"} at ${tx.location || ""}`,
    lines, referenceType: "SALE", referenceId: tx._id, reference: tx._id?.toString(), location: tx.location,
  };
}

/** Credit Sale → Debit Accounts Receivable, Debit COGS, Credit Revenue + Tax + Inventory */
function creditSaleDraft(tx, productMap) {
  if (isVoided(tx)) return null;
  const total = saleGross(tx);
  if (total <= 0) return null;

  const { tax, salesValue } = splitSaleValue(tx, total, productMap);
  const costOfGoodsSold = saleCogs(tx, productMap).cost;
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

  return {
    date: tx?.createdAt,
    description: `Credit Sale - ${customerName}`,
    lines,
    referenceType: "CREDIT_SALE",
    referenceId: tx?._id,
    reference: tx?._id?.toString(),
    location: tx?.location,
  };
}

/** Credit Recovery → Debit Cash/Bank, Credit Accounts Receivable */
function creditRecoveryDraft(tx) {
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

  return {
    // Falls back to when the sale was made rather than to "now", which moved the entry every sync
    date: latestPayment?.paidAt || tx?.creditPaidAt || tx?.updatedAt || tx?.createdAt,
    description: `Credit Recovery - ${customerName}`,
    lines,
    referenceType: "CREDIT_PAYMENT",
    referenceId: tx?._id,
    reference: tx?._id?.toString(),
    location: tx?.location,
  };
}

/**
 * Cash entry → the two lines its purpose calls for.
 *
 * Money out debits where it went — the owner's drawings, the funds held for a
 * customer, a general expense — and credits cash; money in does the reverse. It
 * only touches an expense account when the purpose says so, which is how an owner
 * draw stays off the profit and loss statement.
 */
function cashEntryDraft(entry) {
  const lines = cashEntryLines({
    purpose: entry?.purpose,
    amount: entry?.amount,
    party: entry?.party,
  });
  if (lines.length < 2) return null;

  return {
    date: entry?.date || entry?.createdAt || new Date(),
    description: describeCashEntry(entry),
    lines,
    referenceType: "OTHER",
    referenceId: entry?._id,
    reference: entry?.reference || entry?._id?.toString(),
    location: entry?.location,
  };
}

/**
 * Expense → Debit Expense, Credit Cash.
 *
 * Unless it is stock buying, which is an asset swap — cash out, inventory in —
 * and only reaches the profit and loss statement as cost of goods sold when the
 * stock sells. Posting it as an expense as well charged it to profit twice.
 */
function expenseDraft(exp, treatments) {
  if (isStockPurchase(exp, treatments)) {
    return {
      date: exp.expenseDate || exp.createdAt,
      description: `Stock Purchase: ${exp.title} - ${exp.categoryName || "Supplies"}`,
      lines: [
        { code: SYS.INVENTORY, debit: exp.amount, description: `Stock bought: ${exp.title}` },
        { code: SYS.CASH, credit: exp.amount, description: `Payment for stock: ${exp.title}` },
      ],
      referenceType: "EXPENSE", referenceId: exp._id, reference: exp._id?.toString(), location: exp.locationName,
    };
  }

  const accountRule = getExpenseAccountRule(exp);
  const accountCode = accountRule?.code || SYS.EXPENSE;
  const fallbackCode = accountRule?.fallback || SYS.EXPENSE;

  return {
    date: exp.expenseDate || exp.createdAt,
    description: `Expense: ${exp.title} - ${exp.categoryName || "General"}`,
    lines: [
      { code: accountCode, fallback: fallbackCode, debit: exp.amount, description: exp.title },
      { code: SYS.CASH, credit: exp.amount, description: `Payment for: ${exp.title}` },
    ],
    referenceType: "EXPENSE", referenceId: exp._id, reference: exp._id?.toString(), location: exp.locationName,
  };
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
function purchaseOrderDraft(po, amount) {
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

  return {
    date: po?.paymentDate ? new Date(po.paymentDate) : po?.updatedAt || po?.createdAt || new Date(),
    description: `PO Payment: ${po.orderRef} - ${po.vendorName}`,
    lines,
    referenceType: "PURCHASE_ORDER", referenceId: po._id, reference: po.orderRef, location: po.location,
  };
}

/**
 * Refund → Debit Sales Returns + Tax + Inventory, Credit Cash/Bank + COGS.
 *
 * The takings handed back come off sales revenue, through the returns account. They used to be
 * debited to a "refund expense" among the running costs, which left revenue and gross profit
 * overstated by every refund, and the books quoting different figures from the tax page.
 */
function refundDraft(tx, productMap) {
  if (isVoided(tx) || !tx?.refundedAt) return null;
  const total = saleGross(tx);
  if (total <= 0) return null;

  // The customer gets the whole price back, but the VAT inside it is reclaimed
  // from the tax account instead of being written off as a cost of the refund.
  const { tax, salesValue } = splitSaleValue(tx, total, productMap);
  const restockValue = saleCogs(tx, productMap).cost;
  const lines = [
    {
      code: SYS.RETURNS,
      requireSubType: CONTRA_REVENUE,
      fallback: SYS.REVENUE,
      debit: salesValue,
      description: "Refund for transaction",
    },
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

  return {
    date: tx.refundedAt,
    description: `Refund - ${tx.refundReason || "Customer refund"}`,
    lines,
    referenceType: "REFUND", referenceId: tx._id, reference: tx._id?.toString(), location: tx.location,
  };
}

/* ───────────── Turning a draft into an entry ───────────── */

/** A fingerprint of what an entry posts, so an entry that is already right is left alone. */
function fingerprint(payload) {
  const basis = JSON.stringify([
    payload.referenceType,
    String(payload.referenceId || ""),
    payload.date.toISOString(),
    payload.description,
    payload.reference,
    payload.location,
    payload.lines.map((line) => [line.accountCode, line.debit, line.credit, line.description]),
  ]);
  return createHash("sha1").update(basis).digest("hex");
}

/**
 * The entry a draft stands for, with its accounts found — or null when an account is missing or
 * it would not balance. The same rules whether one record is posted or the sync posts them all.
 */
function resolveDraft(draft, accountFor) {
  if (!draft) return null;

  const lines = [];
  for (const line of draft.lines || []) {
    let account = accountFor(line.code);
    // An account under that code that is not what the line needs (a business's own 4900, say)
    if (account && line.requireSubType && account.subType !== line.requireSubType) account = null;
    if (!account && line.fallback) account = accountFor(line.fallback);
    if (!account) return null;
    lines.push({
      account: account._id,
      accountCode: account.code,
      accountName: account.name,
      debit: roundCurrency(line.debit),
      credit: roundCurrency(line.credit),
      description: line.description || "",
    });
  }

  if (lines.length < 2) return null;

  const totalDebit = roundCurrency(lines.reduce((sum, line) => sum + line.debit, 0));
  const totalCredit = roundCurrency(lines.reduce((sum, line) => sum + line.credit, 0));
  if (Math.abs(totalDebit - totalCredit) >= 0.01) return null;

  const when = draft.date ? new Date(draft.date) : null;
  const payload = {
    date: when && !Number.isNaN(when.getTime()) ? when : new Date(),
    description: draft.description,
    lines,
    reference: draft.reference || "",
    referenceType: draft.referenceType,
    referenceId: draft.referenceId,
    location: draft.location || "",
    totalDebit,
    totalCredit,
  };
  payload.syncHash = fingerprint(payload);
  return payload;
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

/** Posts one record's entry, or brings its existing entry up to date. */
async function createAutoEntry(draft) {
  await mongooseConnect();
  if (!draft) return null;

  const accounts = new Map();
  for (const line of draft.lines || []) {
    for (const code of [line.code, line.fallback]) {
      if (code && !accounts.has(code)) accounts.set(code, await getAccount(code));
    }
  }
  const payload = resolveDraft(draft, (code) => accounts.get(code) || null);
  if (!payload) return null;

  const existingEntries = payload.referenceType && payload.referenceId
    ? await JournalEntry.find({ referenceType: payload.referenceType, referenceId: payload.referenceId }).sort({ createdAt: 1 })
    : [];
  const activeEntries = existingEntries.filter((entry) => entry.status !== "VOIDED");
  // An entry the system struck off is posted again now its record counts (a refund the old rules
  // read as a void); one a person voided stays voided.
  const existingEntry =
    activeEntries[0] || existingEntries.find((entry) => SYSTEM_VOID_REASONS.has(entry.voidReason)) || existingEntries[0] || null;

  if (activeEntries.length > 1) {
    await Promise.all(
      activeEntries.slice(1).map((entry) => {
        entry.status = "VOIDED";
        entry.voidedAt = new Date();
        entry.voidReason = SYSTEM_VOID.superseded;
        return entry.save();
      })
    );
  }

  if (existingEntry?.status === "VOIDED" && !SYSTEM_VOID_REASONS.has(existingEntry.voidReason)) {
    return existingEntry;
  }

  const entryPayload = {
    ...payload,
    status: "POSTED",
    postedAt: existingEntry?.postedAt || new Date(),
  };

  if (existingEntry) {
    existingEntry.set({ ...entryPayload, voidedAt: undefined, voidReason: undefined });
    return existingEntry.save();
  }

  return createJournalEntry(entryPayload);
}

/* ───────────── Posting one record ───────────── */

export async function postSaleEntry(tx) {
  if (isVoided(tx)) {
    await voidEntriesFor("SALE", tx?._id, SYSTEM_VOID.voidedSale);
    return null;
  }
  return createAutoEntry(saleDraft(tx, await buildTransactionBasis(tx)));
}

export async function postCreditSaleEntry(tx) {
  if (isVoided(tx)) {
    await voidEntriesFor("CREDIT_SALE", tx?._id, SYSTEM_VOID.voidedCreditSale);
    return null;
  }
  return createAutoEntry(creditSaleDraft(tx, await buildTransactionBasis(tx)));
}

export async function postCreditRecoveryEntry(tx) {
  return createAutoEntry(creditRecoveryDraft(tx));
}

export async function postCashEntry(entry) {
  return createAutoEntry(cashEntryDraft(entry));
}

export async function postExpenseEntry(exp) {
  return createAutoEntry(expenseDraft(exp, await getCategoryTreatments()));
}

export async function postPurchaseOrderPayment(po, amount) {
  return createAutoEntry(purchaseOrderDraft(po, amount));
}

export async function postRefundEntry(tx) {
  if (isVoided(tx)) {
    await voidEntriesFor("REFUND", tx?._id, SYSTEM_VOID.voidedTransaction);
    return null;
  }
  // The returns account, for a chart seeded before it existed
  await ensureSystemAccounts();
  return createAutoEntry(refundDraft(tx, await buildTransactionBasis(tx)));
}

/* ───────────── Posting everything ───────────── */

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

const entryKey = (referenceType, referenceId) => `${referenceType}:${String(referenceId)}`;

const voidOperation = (id, reason, when) => ({
  updateOne: { filter: { _id: id }, update: { $set: { status: "VOIDED", voidedAt: when, voidReason: reason, updatedAt: when } } },
});

/**
 * Brings every system entry into line with the records behind it.
 *
 * It used to post each record one at a time — two to four trips to the database each, several
 * thousand of them through a pool of five connections — which ran for minutes on a busy shop and
 * was cut off by the server before it finished, leaving the books part-posted. Now everything is
 * read in one go, each entry is compared with what it should say, and only what differs is written,
 * in batches:
 *
 *   - an entry that is already right is left alone
 *   - a record with no entry gets one, and an entry the system struck off is posted again if its
 *     record counts once more (a refund the old rules read as a void)
 *   - an entry whose record is gone — an expense deleted, a petty cash order unpaid, a sale voided,
 *     a credit sale that is no longer one — is struck off, so the books stop counting it
 *   - an entry a person voided, and every manual entry, is left exactly as it is
 */
export async function syncSystemAccountingEntries() {
  await mongooseConnect();
  await seedDefaultAccounts();
  await ensureSystemAccounts();
  accountCache.clear();

  const [transactions, expenses, purchaseOrders, products, accounts, treatments, existing] = await Promise.all([
    Transaction.find({ status: { $in: ["completed", "refunded", "credit"] } }).select(SALE_SYNC_FIELDS).lean(),
    Expense.find({ amount: { $gt: 0 } })
      .select("_id createdAt expenseDate title amount categoryId category categoryName description locationName")
      .lean(),
    PurchaseOrder.find({ paymentMade: { $gt: 0 } })
      .select("_id orderRef vendorName location paymentMade paymentDate updatedAt createdAt grandTotal payBeforeSupply receivedStatus")
      .lean(),
    Product.find({}, { _id: 1, costPrice: 1, taxRate: 1 }).lean(),
    Account.find({ isActive: true }).lean(),
    getCategoryTreatments(),
    JournalEntry.find(
      { referenceType: { $in: SYNCED_TYPES }, referenceId: { $ne: null } },
      { referenceType: 1, referenceId: 1, status: 1, voidReason: 1, syncHash: 1, postedAt: 1, createdAt: 1, createdBy: 1 }
    )
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  const productMap = {};
  for (const product of products) {
    productMap[String(product._id)] = { costPrice: roundCurrency(product.costPrice), taxRate: toNumber(product.taxRate) };
  }
  const accountsByCode = new Map(accounts.map((account) => [account.code, account]));
  const accountFor = (code) => accountsByCode.get(code) || null;

  // What every record should have posted
  const drafts = [];
  const voidedIds = new Set();
  const counts = {
    sales: 0, creditSales: 0, creditRecoveries: 0, refunds: 0, voided: 0, expenses: 0, stockPurchases: 0, purchaseOrders: 0,
  };
  for (const tx of transactions) {
    if (isVoided(tx)) {
      // Nothing to post; any entry it already has is struck off below
      voidedIds.add(String(tx._id));
      counts.voided += 1;
      continue;
    }
    if (tx.status === "credit") {
      drafts.push(creditSaleDraft(tx, productMap));
      counts.creditSales += 1;
      if (getCreditPaymentTotal(tx) > 0) {
        drafts.push(creditRecoveryDraft(tx));
        counts.creditRecoveries += 1;
      }
      continue;
    }
    drafts.push(saleDraft(tx, productMap));
    counts.sales += 1;
    if (tx.status === "refunded" && tx.refundedAt) {
      drafts.push(refundDraft(tx, productMap));
      counts.refunds += 1;
    }
  }
  for (const expense of expenses) {
    drafts.push(expenseDraft(expense, treatments));
    if (isStockPurchase(expense, treatments)) counts.stockPurchases += 1;
    else counts.expenses += 1;
  }
  for (const purchaseOrder of purchaseOrders) {
    drafts.push(purchaseOrderDraft(purchaseOrder, purchaseOrder.paymentMade));
    counts.purchaseOrders += 1;
  }

  // A record whose draft cannot be posted (an account missing) keeps whatever entry it has
  const recordKeys = new Set();
  const wanted = new Map();
  for (const draft of drafts) {
    if (!draft) continue;
    const key = entryKey(draft.referenceType, draft.referenceId);
    recordKeys.add(key);
    const payload = resolveDraft(draft, accountFor);
    if (payload) wanted.set(key, payload);
  }

  const existingByKey = groupBy(existing, (entry) => entryKey(entry.referenceType, entry.referenceId));
  const now = new Date();
  const operations = [];
  const inserts = [];
  const tally = { added: 0, updated: 0, reposted: 0, unchanged: 0, struckOff: 0 };

  for (const [key, payload] of wanted) {
    const list = existingByKey.get(key) || [];
    const active = list.filter((entry) => entry.status !== "VOIDED");
    const primary = active[0] || list.find((entry) => SYSTEM_VOID_REASONS.has(entry.voidReason)) || null;
    // Every entry it has was voided by a person: their call stands
    if (!primary && list.length > 0) continue;

    for (const extra of active.slice(1)) {
      operations.push(voidOperation(extra._id, SYSTEM_VOID.superseded, now));
      tally.struckOff += 1;
    }

    if (primary && primary.status === "POSTED" && primary.syncHash === payload.syncHash) {
      tally.unchanged += 1;
      continue;
    }

    if (primary) {
      operations.push({
        updateOne: {
          filter: { _id: primary._id },
          update: {
            $set: { ...payload, status: "POSTED", postedAt: primary.postedAt || now, updatedAt: now },
            $unset: { voidedAt: "", voidReason: "" },
          },
        },
      });
      if (primary.status === "VOIDED") tally.reposted += 1;
      else tally.updated += 1;
    } else {
      inserts.push({ ...payload, status: "POSTED", postedAt: now, createdAt: now, updatedAt: now });
    }
  }

  // Entries whose record has gone, or no longer posts
  for (const entry of existing) {
    if (entry.status !== "POSTED" || entry.createdBy) continue;
    if (recordKeys.has(entryKey(entry.referenceType, entry.referenceId))) continue;
    const reason = voidedIds.has(String(entry.referenceId)) ? SYSTEM_VOID.voidedSale : SYSTEM_VOID.gone;
    operations.push(voidOperation(entry._id, reason, now));
    tally.struckOff += 1;
  }

  if (inserts.length > 0) {
    const numbers = await reserveJournalEntryNumbers(inserts.length);
    inserts.forEach((document, index) => {
      operations.push({ insertOne: { document: { entryNumber: numbers[index], ...document } } });
    });
    tally.added = inserts.length;
  }

  // Straight to the collection: every value is already the type the schema wants (ids, dates,
  // rounded amounts, totals worked out), and having Mongoose cast tens of thousands of entries one
  // by one took most of a first sync's time
  for (let index = 0; index < operations.length; index += WRITE_BATCH) {
    await JournalEntry.collection.bulkWrite(operations.slice(index, index + WRITE_BATCH), { ordered: false });
  }

  return {
    voidedStruckOff: counts.voided,
    salesSynced: counts.sales,
    creditSalesSynced: counts.creditSales,
    creditRecoveriesSynced: counts.creditRecoveries,
    refundsSynced: counts.refunds,
    expensesSynced: counts.expenses,
    stockPurchasesSynced: counts.stockPurchases,
    purchaseOrdersSynced: counts.purchaseOrders,
    entriesAdded: tally.added,
    entriesUpdated: tally.updated,
    entriesReposted: tally.reposted,
    entriesUnchanged: tally.unchanged,
    entriesStruckOff: tally.struckOff,
  };
}

/* ───────────── When to sync ───────────── */

async function readSyncState() {
  return (await AccountingSyncState.findById(SYNC_STATE_ID).lean()) || null;
}

export async function getAccountingSyncStatus() {
  await mongooseConnect();
  const state = await readSyncState();
  const lockedUntil = state?.lockedUntil ? new Date(state.lockedUntil) : null;
  return {
    isSyncing: Boolean(syncState.inFlight) || Boolean(lockedUntil && lockedUntil > new Date()),
    lastSyncAt: state?.lastSyncAt ? new Date(state.lastSyncAt).toISOString() : null,
    lastDurationMs: state?.lastDurationMs ?? null,
    lastSummary: state?.lastSummary || null,
    lastError: state?.lastError || null,
    minIntervalMs: DEFAULT_SYNC_INTERVAL_MS,
  };
}

/** Takes the sync lock for this server, or says another one holds it. */
async function acquireSyncLock(now) {
  try {
    const state = await AccountingSyncState.findOneAndUpdate(
      { _id: SYNC_STATE_ID, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
      { $set: { lockedUntil: new Date(now.getTime() + SYNC_LOCK_MS) } },
      { upsert: true, new: true }
    ).lean();
    return Boolean(state);
  } catch (error) {
    // The document exists and is locked, so the upsert collided with it
    if (error?.code === 11000) return false;
    throw error;
  }
}

/**
 * Syncs the books unless they were synced a moment ago (or another server is syncing them now).
 * When they were synced, and whether one is running, is kept in the database: in memory, every
 * server instance had its own idea of it.
 */
export async function ensureAccountingEntriesSynced(options = {}) {
  const { force = false, minIntervalMs = DEFAULT_SYNC_INTERVAL_MS } = options;

  if (syncState.inFlight) {
    return syncState.inFlight;
  }

  syncState.inFlight = (async () => {
    await mongooseConnect();
    const now = new Date();
    const state = await readSyncState();
    const lastSyncAt = state?.lastSyncAt ? new Date(state.lastSyncAt) : null;

    if (!force && lastSyncAt && now.getTime() - lastSyncAt.getTime() < minIntervalMs) {
      return { skipped: true, syncedAt: lastSyncAt.toISOString(), durationMs: state.lastDurationMs, ...(state.lastSummary || {}) };
    }

    if (!(await acquireSyncLock(now))) {
      return { skipped: true, running: true, syncedAt: lastSyncAt ? lastSyncAt.toISOString() : null, ...(state?.lastSummary || {}) };
    }

    const startedAt = Date.now();
    try {
      const summary = await syncSystemAccountingEntries();
      const finishedAt = new Date();
      const durationMs = Date.now() - startedAt;
      await AccountingSyncState.updateOne(
        { _id: SYNC_STATE_ID },
        { $set: { lastSyncAt: finishedAt, lastDurationMs: durationMs, lastSummary: summary, lastError: null, lockedUntil: null } }
      );
      return { skipped: false, syncedAt: finishedAt.toISOString(), durationMs, ...summary };
    } catch (error) {
      await AccountingSyncState.updateOne(
        { _id: SYNC_STATE_ID },
        { $set: { lastError: error?.message || "Accounting sync failed", lockedUntil: null } }
      ).catch(() => {});
      throw error;
    }
  })().finally(() => {
    syncState.inFlight = null;
  });

  return syncState.inFlight;
}

/**
 * Adds the accounts the posting rules need to a chart seeded before they existed.
 */
export async function ensureSystemAccounts() {
  if (systemAccountsChecked) return;
  await mongooseConnect();
  for (const account of SYSTEM_ACCOUNTS) {
    try {
      await Account.updateOne({ code: account.code }, { $setOnInsert: account }, { upsert: true });
    } catch (error) {
      // Another request added it at the same moment
      if (error?.code !== 11000) throw error;
    }
    accountCache.delete(account.code);
  }
  systemAccountsChecked = true;
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
    { code: "2400", name: "Customer Funds Held", type: "LIABILITY", subType: "Current Liability", normalBalance: "CREDIT", isSystem: true },

    // Equity
    { code: "3000", name: "Owner's Equity", type: "EQUITY", subType: "Owner's Equity", normalBalance: "CREDIT", isSystem: true },
    { code: "3100", name: "Retained Earnings", type: "EQUITY", subType: "Retained Earnings", normalBalance: "CREDIT", isSystem: true },
    { code: "3200", name: "Owner's Drawings", type: "EQUITY", subType: "Drawings", normalBalance: "DEBIT" },

    // Revenue
    { code: "4000", name: "Sales Revenue", type: "REVENUE", subType: "Operating Revenue", normalBalance: "CREDIT", isSystem: true },
    { code: "4100", name: "Service Revenue", type: "REVENUE", subType: "Operating Revenue", normalBalance: "CREDIT" },
    { code: "4200", name: "Other Income", type: "REVENUE", subType: "Non-Operating Revenue", normalBalance: "CREDIT" },
    ...SYSTEM_ACCOUNTS,

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
