/**
 * Double-entry books, worked out from the records.
 *
 * Each kind of record has one builder that says what it posts (saleDraft, refundDraft, …). The
 * statements run every record in their period through those builders when they are opened
 * (buildLiveEntries); nothing is posted ahead or stored, so the books always say what the records
 * say.
 */

import { mongooseConnect } from "@/lib/mongodb";
import Account from "@/models/Account";
import CashEntry from "@/models/CashEntry";
import Expense from "@/models/Expense";
import ExpenseCategory from "@/models/ExpenseCategory";
import Product from "@/models/Product";
import PurchaseOrder from "@/models/PurchaseOrder";
import StockMovement from "@/models/StockMovement";
import StockTake from "@/models/StockTake";
import Tender from "@/models/Tender";
import Transaction from "@/models/Transactions";
import { isStockPurchase, isVoided, saleCogs, saleGross, saleVat } from "@/lib/financial-basis";
import { deriveVendorCredit } from "@/lib/orderPayments";
import { cashEntryLines, describeCashEntry } from "@/lib/cashEntries";

const SYS = {
  CASH: "1000", BANK: "1010", AR: "1100", INVENTORY: "1200", VENDOR_PREPAID: "1300",
  AP: "2000", TAX: "2100", REVENUE: "4000", RETURNS: "4900", COGS: "5000", STOCK_LOSS: "5100",
  SALARY: "6000", EXPENSE: "6100", REFUND: "6200", MISC: "6900", REPAIRS: "6950",
};

/** The subType that marks an account as one taken off sales revenue. */
const CONTRA_REVENUE = "Contra Revenue";

/** The subType the profit and loss statement counts as cost of sales. */
const COST_OF_SALES = "Cost of Sales";

/** Stock movements that write stock off. Transfers, returns and restocks are not losses. */
const STOCK_LOSS_REASONS = ["Adjustment", "Operational Loss"];

/**
 * Stock written off before this date stays off the books: posting it now would change months that
 * have already been reported. Move the date back to bring earlier losses in.
 */
const STOCK_ADJUSTMENTS_FROM = new Date("2026-11-01T00:00:00+01:00");

const postsToBooks = (date) => Boolean(date) && new Date(date) >= STOCK_ADJUSTMENTS_FROM;

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
  {
    code: SYS.STOCK_LOSS,
    name: "Stock Losses & Adjustments",
    type: "EXPENSE",
    subType: COST_OF_SALES,
    normalBalance: "DEBIT",
    isSystem: true,
    description: "Stock written off at cost: operational losses, adjustments and stock take differences.",
  },
  {
    code: SYS.REPAIRS,
    name: "Repairs & Maintenance",
    type: "EXPENSE",
    subType: "Operating Expense",
    normalBalance: "DEBIT",
    isSystem: true,
    description: "Repairs and maintenance, kept apart from the miscellaneous expenses.",
  },
  {
    code: SYS.MISC,
    name: "Miscellaneous Expense",
    type: "EXPENSE",
    subType: "Operating Expense",
    normalBalance: "DEBIT",
    isSystem: true,
    description: "Every expense no other account takes.",
  },
];

/** Writes sent to the database at a time. */
const WRITE_BATCH = 500;
/**
 * Older sales that get their line costs saved per opening of the books, at most. The first openings
 * after costs started being saved have every older sale to do; spread over a few, no one is long.
 */
const COST_FREEZE_PER_RUN = 5000;

let _seedChecked = false;
let systemAccountsChecked = false;
/** Expense category treatments, refreshed at most once a minute. */
const treatmentCache = { map: null, loadedAt: 0 };
const TREATMENT_TTL_MS = 60 * 1000;
/** Tender classifications, refreshed at most once a minute. */
const tenderClassCache = { map: null, loadedAt: 0 };
/**
 * Where an expense goes, by what it is about. Repairs and maintenance have their own account;
 * anything no rule takes is miscellaneous.
 */
const EXPENSE_ACCOUNT_RULES = [
  { code: SYS.SALARY, fallback: SYS.EXPENSE, keywords: ["salary", "salaries", "payroll", "wage", "staff"] },
  { code: SYS.REPAIRS, fallback: SYS.MISC, keywords: ["repair", "maintenance", "servicing"] },
  { code: "6300", fallback: SYS.EXPENSE, keywords: ["rent", "lease"] },
  { code: "6400", fallback: SYS.EXPENSE, keywords: ["utility", "utilities", "electric", "electricity", "water", "internet", "airtime"] },
  { code: "6500", fallback: SYS.EXPENSE, keywords: ["transport", "travel", "fuel", "delivery", "logistics"] },
  { code: "6700", fallback: SYS.EXPENSE, keywords: ["insurance"] },
  { code: "6800", fallback: SYS.EXPENSE, keywords: ["marketing", "advert", "advertising", "branding", "promotion", "social media"] },
];
const OTHER_EXPENSES = { code: SYS.MISC, fallback: SYS.EXPENSE };

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
  return ["card", "transfer", "bank", "pos", "visa", "mastercard", "mobile money", "wallet", "online", "paystack"].some((token) => normalized.includes(token));
}

const BANK_CLASSIFICATIONS = new Set(["Card", "Transfer", "Cheque"]);
const tenderKey = (value) => String(value || "").trim().toLowerCase();

/**
 * Where a payment landed goes by how it was taken: the classification set on the tender under Setup
 * → Payment Methods (Cash to cash; Card, Transfer and Cheque to the bank). A tender left unclassified
 * is read by its name: ONLINE is taken by the web shop's payment gateway, so bank, and MANUAL ENTRY
 * is an order settled on delivery with no tender picked, so cash.
 */
function getSettlementAccountCode(tenderType, tenderName, tenderClasses = {}) {
  const classification = tenderClasses[tenderKey(tenderName)] || tenderClasses[tenderKey(tenderType)];
  if (classification === "Cash") return SYS.CASH;
  if (BANK_CLASSIFICATIONS.has(classification)) return SYS.BANK;
  return isBankTender(tenderType, tenderName) ? SYS.BANK : SYS.CASH;
}

/**
 * Expenses are paid in cash, except those sent from the bank on a payment memo, which the payment
 * tracker's Quick Entry records with `paidFrom: "bank"`.
 */
function settlementCodeFor(paidFrom) {
  return paidFrom === "bank" ? SYS.BANK : SYS.CASH;
}

/** How each tender is classified, by lower-cased name. "Other" says nothing, so it is left out. */
async function getTenderClasses() {
  const now = Date.now();
  if (tenderClassCache.map && now - tenderClassCache.loadedAt < TREATMENT_TTL_MS) {
    return tenderClassCache.map;
  }

  const tenders = await Tender.find({}, { name: 1, classification: 1 }).lean();
  const map = {};
  for (const tender of tenders) {
    if (tender.classification && tender.classification !== "Other") map[tenderKey(tender.name)] = tender.classification;
  }

  tenderClassCache.map = map;
  tenderClassCache.loadedAt = now;
  return map;
}

function buildSettlementLines({ total, tenderType, tenderPayments, tenderClasses, direction, description }) {
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
        code: getSettlementAccountCode(payment.tenderType, payment.tenderName, tenderClasses),
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
export async function getCategoryTreatments() {
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

/**
 * The account an expense belongs to. Its category decides first: one filed under Repairs/Maintenance
 * is a repair, whatever its title mentions. Only an expense whose category says nothing is read by
 * its title and description. Anything no rule takes is miscellaneous.
 */
function getExpenseAccountRule(expense) {
  const matches = (text) => EXPENSE_ACCOUNT_RULES.find((rule) => rule.keywords.some((keyword) => text.includes(keyword)));
  return matches(normalizeSearchText(expense?.categoryName))
    || matches(normalizeSearchText(expense?.title, expense?.description))
    || OTHER_EXPENSES;
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
function saleDraft(tx, productMap, tenderClasses) {
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
      tenderClasses,
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
function creditRecoveryDraft(tx, tenderClasses) {
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
      tenderClasses,
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
 * Expense → Debit Expense, Credit Cash (Bank for an expense paid by memo).
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
        { code: settlementCodeFor(exp.paidFrom), credit: exp.amount, description: `Payment for stock: ${exp.title}` },
      ],
      referenceType: "EXPENSE", referenceId: exp._id, reference: exp._id?.toString(), location: exp.locationName,
    };
  }

  const { code: accountCode, fallback: fallbackCode } = getExpenseAccountRule(exp);

  return {
    date: exp.expenseDate || exp.createdAt,
    description: `Expense: ${exp.title} - ${exp.categoryName || "General"}`,
    lines: [
      { code: accountCode, fallback: fallbackCode, debit: exp.amount, description: exp.title },
      { code: settlementCodeFor(exp.paidFrom), credit: exp.amount, description: `Payment for: ${exp.title}` },
    ],
    referenceType: "EXPENSE", referenceId: exp._id, reference: exp._id?.toString(), location: exp.locationName,
  };
}

/**
 * PO Payment → Debit Inventory for the goods that are in, Debit the vendor
 * prepayment for money they are still holding, Credit Bank for the lot: vendors
 * are paid from the bank on a transfer memo (petty cash is an expense, not an order).
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

  const lines = [{ code: SYS.BANK, credit: paymentAmount, description: `Payment for PO ${po.orderRef}` }];
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
function refundDraft(tx, productMap, tenderClasses) {
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
      tenderClasses,
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

/**
 * Stock written off at cost → Debit Stock Losses, Credit Inventory. A positive value is a loss; a
 * stock take that found more than the system held is negative and goes the other way.
 */
function stockAdjustmentDraft({ value, date, description, referenceId, reference, location, source }) {
  const amount = roundCurrency(value);
  if (amount === 0) return null;

  const isLoss = amount > 0;
  const size = Math.abs(amount);
  return {
    date,
    description,
    lines: [
      {
        code: SYS.STOCK_LOSS,
        requireSubType: COST_OF_SALES,
        fallback: SYS.COGS,
        debit: isLoss ? size : 0,
        credit: isLoss ? 0 : size,
        description,
      },
      {
        code: SYS.INVENTORY,
        debit: isLoss ? 0 : size,
        credit: isLoss ? size : 0,
        description: isLoss ? "Stock written off" : "Stock written back on",
      },
    ],
    referenceType: "STOCK_ADJUSTMENT",
    referenceId,
    reference,
    location,
    source,
  };
}

/** An operational loss or adjustment → the movement's value at the cost it was recorded at. */
function stockMovementDraft(movement) {
  if (!STOCK_LOSS_REASONS.includes(movement?.reason)) return null;
  const date = movement.dateSent || movement.createdAt;
  if (!postsToBooks(date)) return null;

  return stockAdjustmentDraft({
    value: movement.totalCostPrice,
    date,
    description: `Stock ${movement.reason}: ${movement.transRef}`,
    referenceId: movement._id,
    reference: movement.transRef,
    source: "stock-movement",
  });
}

/** An applied stock take → what it changed stock by, at cost, shortages against overages. */
function stockTakeDraft(stockTake) {
  if (!stockTake?.adjustmentApplied || !postsToBooks(stockTake.adjustedAt)) return null;

  const applied = stockTake.appliedAdjustments || [];
  const stockChange = applied.length > 0
    ? applied.reduce((sum, entry) => sum + toNumber(entry?.value), 0)
    : toNumber(stockTake.totalVarianceValue);

  return stockAdjustmentDraft({
    value: -stockChange,
    date: stockTake.adjustedAt,
    description: `Stock take: ${stockTake.reference}`,
    referenceId: stockTake._id,
    reference: stockTake.reference,
    location: stockTake.locationName,
    source: "stock-take",
  });
}

/* ───────────── Turning a draft into an entry ───────────── */

/**
 * The entry a draft stands for, with its accounts found — or null when an account is missing or it
 * would not balance.
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
    source: draft.source || "",
    totalDebit,
    totalCredit,
  };
  return payload;
}

/* ───────────── The books, worked out from the records ───────────── */

/**
 * The books are not stored. Each statement works out its entries from the records themselves —
 * sales, refunds, expenses, vendor payments, quick entries, stock losses, salary payments — with the
 * rules above, each time it is opened. A record added, changed or deleted is in or out of the books
 * the next time they are opened, and no second copy of every sale is kept.
 *
 * An entry reads as a journal entry did: { date, description, reference, referenceType, referenceId,
 * source, location, lines: [{ account, accountCode, accountName, debit, credit, description }] }.
 */

/** Entries this server worked out in the last minute, by period: changing tabs reads them once. */
const liveCache = new Map();
const LIVE_CACHE_MS = 60 * 1000;
const LIVE_CACHE_SIZE = 12;

/** What a sale is read for: the lines only as far as cost and VAT need them. */
const SALE_BOOK_FIELDS =
  "_id createdAt updatedAt refundedAt refundReason status subStatus total tax tenderType tenderPayments " +
  "location staffName customerName creditCustomerName creditOriginalTotal creditPaidAmount creditPaidAt creditPayments " +
  "items.productId items.qty items.quantity items.price items.salePriceIncTax items.costPrice items.unitCost " +
  "items.purchasePrice items.taxRate";

function inPeriod(date, start, end) {
  const time = date ? new Date(date).getTime() : NaN;
  if (Number.isNaN(time)) return false;
  return (!start || time >= start.getTime()) && (!end || time < end.getTime());
}

/** A date condition for a query, or null when the period is open at both ends. */
function dateRange(start, end) {
  const range = {};
  if (start) range.$gte = start;
  if (end) range.$lt = end;
  return Object.keys(range).length > 0 ? range : null;
}

/** Records dated in the period by `field`, or by createdAt when the record has no such date. */
function datedIn(field, range) {
  return range ? { $or: [{ [field]: range }, { [field]: null, createdAt: range }] } : {};
}

/**
 * Saves today's product cost on sale lines that have none, so an older sale stops following the
 * product's cost from then on. Sales save their own cost when made (models/Transactions.js); this is
 * for the ones from before, and any sent in by a till still on an older version. Today's cost is what
 * the books already use for such a line (saleCogs), so no figure changes. Each update only lands if
 * the line is still the one read, and still has no cost.
 */
function costFreezeOperations(transactions, productMap) {
  const operations = [];
  for (const tx of transactions) {
    const filter = { _id: tx._id };
    const set = {};
    (tx.items || []).forEach((item, index) => {
      if (!item?.productId || toNumber(item.costPrice ?? item.unitCost ?? item.purchasePrice) > 0) return;
      const cost = toNumber(productMap[String(item.productId)]?.costPrice);
      if (cost <= 0) return;
      filter[`items.${index}.productId`] = item.productId;
      filter[`items.${index}.costPrice`] = { $not: { $gt: 0 } };
      set[`items.${index}.costPrice`] = cost;
    });
    if (Object.keys(set).length === 0) continue;
    operations.push({ updateOne: { filter, update: { $set: set } } });
    if (operations.length >= COST_FREEZE_PER_RUN) break;
  }
  return operations;
}

/**
 * Every entry dated in [start, end). Either end may be left open: a balance sheet reads everything
 * up to its date, "all time" reads everything. Sales are read with only what the books need.
 * `fresh` skips the last minute's copy, for a read that must see a change made a moment ago.
 */
export async function buildLiveEntries({ start = null, end = null, fresh = false } = {}) {
  const key = `${start ? start.toISOString() : ""}|${end ? end.toISOString() : ""}`;
  const cached = liveCache.get(key);
  if (!fresh && cached && Date.now() - cached.at < LIVE_CACHE_MS) return cached.entries;

  await mongooseConnect();
  await seedDefaultAccounts();
  await ensureSystemAccounts();

  const range = dateRange(start, end);
  // Stock losses reach the books from STOCK_ADJUSTMENTS_FROM on
  const lossRange = dateRange(start && start > STOCK_ADJUSTMENTS_FROM ? start : STOCK_ADJUSTMENTS_FROM, end);
  const saleFilter = { status: { $in: ["completed", "refunded", "credit"] } };
  if (range) {
    saleFilter.$or = [{ createdAt: range }, { refundedAt: range }, { creditPaidAt: range }, { "creditPayments.paidAt": range }];
  }

  const [transactions, expenses, purchaseOrders, cashEntries, stockLosses, stockTakes, products, accounts, treatments, tenderClasses] = await Promise.all([
    Transaction.find(saleFilter).select(SALE_BOOK_FIELDS).lean(),
    Expense.find({ amount: { $gt: 0 }, ...datedIn("expenseDate", range) })
      .select("_id createdAt expenseDate title amount categoryId category categoryName description locationName paidFrom")
      .lean(),
    // The pay date is kept as text, so the period is checked on each order's entry below
    PurchaseOrder.find({ paymentMade: { $gt: 0 } })
      .select("_id orderRef vendorName location paymentMade paymentDate updatedAt createdAt grandTotal payBeforeSupply receivedStatus")
      .lean(),
    CashEntry.find(datedIn("date", range)).lean(),
    StockMovement.find({ reason: { $in: STOCK_LOSS_REASONS }, ...datedIn("dateSent", lossRange) })
      .select("_id reason transRef totalCostPrice dateSent createdAt")
      .lean(),
    StockTake.find({ adjustmentApplied: true, adjustedAt: lossRange })
      .select("_id reference locationName adjustmentApplied adjustedAt appliedAdjustments totalVarianceValue")
      .lean(),
    Product.find({}, { _id: 1, costPrice: 1, taxRate: 1 }).lean(),
    Account.find({ isActive: true }).lean(),
    getCategoryTreatments(),
    getTenderClasses(),
  ]);

  const productMap = {};
  for (const product of products) {
    productMap[String(product._id)] = { costPrice: roundCurrency(product.costPrice), taxRate: toNumber(product.taxRate) };
  }
  const accountsByCode = new Map(accounts.map((account) => [account.code, account]));
  const accountFor = (code) => accountsByCode.get(code) || null;

  // What every record posts
  const drafts = [];
  for (const tx of transactions) {
    // A voided sale never happened
    if (isVoided(tx)) continue;
    if (tx.status === "credit") {
      drafts.push(creditSaleDraft(tx, productMap));
      if (getCreditPaymentTotal(tx) > 0) drafts.push(creditRecoveryDraft(tx, tenderClasses));
      continue;
    }
    drafts.push(saleDraft(tx, productMap, tenderClasses));
    if (tx.status === "refunded" && tx.refundedAt) drafts.push(refundDraft(tx, productMap, tenderClasses));
  }
  for (const entry of cashEntries) drafts.push(cashEntryDraft(entry));
  for (const expense of expenses) drafts.push(expenseDraft(expense, treatments));
  for (const purchaseOrder of purchaseOrders) drafts.push(purchaseOrderDraft(purchaseOrder, purchaseOrder.paymentMade));
  for (const movement of stockLosses) drafts.push(stockMovementDraft(movement));
  for (const stockTake of stockTakes) drafts.push(stockTakeDraft(stockTake));

  // A record whose account is missing from the chart, or that would not balance, is left out
  const entries = [];
  for (const draft of drafts) {
    if (!draft || !inPeriod(draft.date, start, end)) continue;
    const entry = resolveDraft(draft, accountFor);
    if (entry) entries.push(entry);
  }
  entries.sort((a, b) => a.date - b.date);

  const freeze = costFreezeOperations(transactions, productMap);
  for (let index = 0; index < freeze.length; index += WRITE_BATCH) {
    await Transaction.collection.bulkWrite(freeze.slice(index, index + WRITE_BATCH), { ordered: false });
  }

  liveCache.set(key, { at: Date.now(), entries });
  if (liveCache.size > LIVE_CACHE_SIZE) liveCache.delete(liveCache.keys().next().value);
  return entries;
}

/**
 * Stock written off in the period, for the tax pages: what left the inventory account, an overage
 * negative. The same rules as the books, so the two agree.
 */
export async function stockLossesBetween(start, end) {
  await mongooseConnect();
  const lossRange = dateRange(start && start > STOCK_ADJUSTMENTS_FROM ? start : STOCK_ADJUSTMENTS_FROM, end);
  const [movements, stockTakes] = await Promise.all([
    StockMovement.find({ reason: { $in: STOCK_LOSS_REASONS }, ...datedIn("dateSent", lossRange) })
      .select("_id reason transRef totalCostPrice dateSent createdAt")
      .lean(),
    StockTake.find({ adjustmentApplied: true, adjustedAt: lossRange })
      .select("_id reference locationName adjustmentApplied adjustedAt appliedAdjustments totalVarianceValue")
      .lean(),
  ]);

  return [...movements.map(stockMovementDraft), ...stockTakes.map(stockTakeDraft)]
    .filter((draft) => draft && inPeriod(draft.date, start, end))
    .map((draft) => ({
      date: draft.date,
      amount: draft.lines
        .filter((line) => line.code === SYS.INVENTORY)
        .reduce((sum, line) => sum + toNumber(line.credit) - toNumber(line.debit), 0),
    }));
}

/** Where an entry came from, for the general ledger: what kind of record, and its page if it has one. */
export function entrySource(entry) {
  const id = String(entry?.referenceId || "");
  switch (entry?.referenceType) {
    case "SALE": return { label: "Sale", href: "/reporting/completed-transactions" };
    case "REFUND": return { label: "Refund", href: "/reporting/completed-transactions" };
    case "CREDIT_SALE": return { label: "Credit sale", href: "/reporting/completed-transactions" };
    case "CREDIT_PAYMENT": return { label: "Credit payment", href: "/reporting/completed-transactions" };
    case "EXPENSE": return { label: "Expense", href: "/expenses/expenses" };
    case "PURCHASE_ORDER": return { label: "Vendor payment", href: "/manage/purchase-orders" };
    case "OTHER": return { label: "Quick entry", href: id ? `/memo/${id}` : "/manage/purchase-orders" };
    case "STOCK_ADJUSTMENT":
      return entry.source === "stock-take"
        ? { label: "Stock take", href: id ? `/stock/stock-take/${id}` : "/stock/stock-take" }
        : { label: "Stock loss", href: id ? `/stock/movement/${id}` : "/stock/movement" };
    default: return { label: "Record", href: "" };
  }
}

/**
 * What posts to each account, in words, for the chart of accounts and the general ledger. An expense
 * account's words come from the rules that send expenses to it.
 */
export function accountGuide(code) {
  const rule = EXPENSE_ACCOUNT_RULES.find((entry) => entry.code === code);
  if (rule) return `Expenses whose category (or, failing that, title) mentions ${rule.keywords.join(", ")}.`;
  return ACCOUNT_GUIDE[code] || "";
}

const ACCOUNT_GUIDE = {
  [SYS.CASH]: "Sales paid with tenders classed as Cash, refunds paid back in cash, expenses and petty cash paid in cash, and Quick Entry money in and out.",
  [SYS.BANK]: "Sales paid by card, transfer or online, refunds paid back by bank, vendor payments, and expenses and salaries paid by memo.",
  [SYS.AR]: "Credit sales not yet paid, less what customers have paid back.",
  [SYS.INVENTORY]: "Stock bought (vendor payments for goods in, stock bought through expenses and petty cash) less the cost of goods sold, stock losses and stock take shortages.",
  [SYS.VENDOR_PREPAID]: "Money paid to vendors for goods not yet received.",
  [SYS.TAX]: "VAT collected on sales, less VAT handed back on refunds.",
  "2400": "Money received that is not a sale (a customer who paid too much), until it is refunded.",
  "3000": "Money the owner puts into the business (Quick Entry), and the opening balance set here.",
  "3200": "Cash or money taken out by the owner (Quick Entry).",
  [SYS.REVENUE]: "Sales, before VAT.",
  [SYS.RETURNS]: "Refunds given back to customers, before VAT.",
  [SYS.COGS]: "What the goods sold cost: the cost saved on each sale when it was made.",
  [SYS.STOCK_LOSS]: "Stock written off at cost: operational losses, adjustments and stock take shortages (overages reduce it).",
  [SYS.MISC]: "Every expense no other account takes, and Quick Entry's other payments out.",
  [SYS.EXPENSE]: "Used only when the account an expense belongs to is missing from the chart.",
};

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
    // Miscellaneous (6900) and Repairs & Maintenance (6950) come in with SYSTEM_ACCOUNTS above
  ];

  await Account.insertMany(defaults);
  return true;
}
