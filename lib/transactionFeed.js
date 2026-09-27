/**
 * The dashboard's transaction feed: the most recent sales, split by what happened to
 * them. Kept out of the page so the rules match the transactions report — a void is
 * recorded as a sub-status on a completed sale, not as a status of its own, so
 * "completed" has to exclude them or a voided sale would be counted as a sale.
 */

export const TRANSACTION_TABS = [
  { key: "completed", label: "Completed", reportStatus: "completed" },
  { key: "held", label: "Held", reportStatus: "held" },
  { key: "void", label: "Voided", reportStatus: "void" },
];

/** Voided: the sub-status the till writes, or the older records' own status. */
export function isVoidedTransaction(tx) {
  return tx?.subStatus === "void" || tx?.status === "voided";
}

export function matchesTransactionTab(tx, tab) {
  if (!tx) return false;
  if (tab === "void") return isVoidedTransaction(tx);
  if (tab === "held") return tx.status === "held" && !isVoidedTransaction(tx);
  // A voided sale is not a completed one, however it is stored.
  return tx.status === "completed" && !isVoidedTransaction(tx);
}

export function countTransactionTabs(transactions = []) {
  const counts = { completed: 0, held: 0, void: 0 };
  for (const tx of transactions) {
    for (const { key } of TRANSACTION_TABS) {
      if (matchesTransactionTab(tx, key)) counts[key] += 1;
    }
  }
  return counts;
}

const timeOf = (tx) => new Date(tx?.completedAt || tx?.createdAt || 0).getTime() || 0;

/** The newest first, however the list arrived. */
export function recentTransactions(transactions = [], tab = "completed", limit = 6) {
  return (Array.isArray(transactions) ? transactions : [])
    .filter((tx) => matchesTransactionTab(tx, tab))
    .sort((a, b) => timeOf(b) - timeOf(a))
    .slice(0, Math.max(0, limit));
}

/** Who the sale was for, as the reports name it. */
export function transactionLabel(tx) {
  return tx?.customerName?.trim() || tx?.creditCustomerName?.trim() || "Walk-in";
}

export function transactionStaffName(tx) {
  return tx?.staff?.name || tx?.staffName || (typeof tx?.staff === "string" ? tx.staff : "") || "";
}

/**
 * How the sale was paid. A sale can be split across tenders, so this is a list;
 * older records carry a single `tenderType` instead, which reads the same way.
 */
export function transactionTenders(tx) {
  const payments = Array.isArray(tx?.tenderPayments) ? tx.tenderPayments : [];
  const listed = payments
    .map((payment) => ({
      label: payment?.tenderName || payment?.tenderType || "Payment",
      amount: Number(payment?.amount) || 0,
    }))
    .filter((payment) => payment.label);

  if (listed.length > 0) return listed;

  const single = tx?.tenderName || tx?.tenderType || tx?.paymentMethod;
  return single ? [{ label: single, amount: Number(tx?.amountPaid ?? tx?.total) || 0 }] : [];
}

/** The lines on the sale. The till and the reports name these fields differently. */
export function transactionItems(tx) {
  return (Array.isArray(tx?.items) ? tx.items : [])
    .map((item) => {
      const quantity = Number(item?.qty ?? item?.quantity) || 0;
      const price = Number(item?.salePriceIncTax ?? item?.price) || 0;
      return {
        name: item?.name || "Item",
        quantity,
        price,
        total: Number(item?.total) || quantity * price,
      };
    })
    .filter((item) => item.name);
}

/** A time for today's sales, a short date for older ones. */
export function transactionWhen(tx, now = new Date()) {
  const when = new Date(tx?.completedAt || tx?.createdAt || 0);
  if (Number.isNaN(when.getTime()) || when.getTime() === 0) return "";
  const sameDay =
    when.getDate() === now.getDate() && when.getMonth() === now.getMonth() && when.getFullYear() === now.getFullYear();
  return sameDay
    ? when.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })
    : when.toLocaleDateString("en-NG", { day: "2-digit", month: "short" });
}
