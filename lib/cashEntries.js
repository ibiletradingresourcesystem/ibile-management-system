/**
 * Money that moves without a sale or a vendor order behind it.
 *
 * The Quick Entry on the payment tracker only ever knew how to pay a vendor, so
 * the money a shop actually has to account for — a customer who transferred too
 * much and has to be refunded, cash the owner takes out for an emergency, money
 * the owner puts back in — had nowhere to go but a made-up purchase order against
 * whichever vendor was nearest.
 *
 * Each purpose says which way the money runs and where it belongs in the books.
 * Nothing here touches the database, so the page and the API share one list.
 */

/** Chart of accounts codes these entries post against. */
const CASH = "1000";
const HELD_FOR_CUSTOMERS = "2400";
const PAYABLE = "2000";
const OWNER_EQUITY = "3000";
const OWNER_DRAWINGS = "3200";
const REFUND_EXPENSE = "6200";
const GENERAL_EXPENSE = "6100";

/**
 * `counterAccount` is the side that is not cash: debited when money goes out,
 * credited when it comes in. `fallback` is used when a business has not got that
 * account in its chart.
 */
export const CASH_PURPOSES = [
  {
    key: "vendor-payment",
    direction: "out",
    label: "Vendor payment",
    hint: "Paying a vendor against an order. Recorded on the vendor payment tracker.",
    needsVendor: true,
  },
  {
    key: "owner-withdrawal",
    direction: "out",
    label: "Cash taken by the owner",
    hint: "An emergency draw or cash taken for personal use. Not a business cost — it comes off what the business owes its owner.",
    counterAccount: OWNER_DRAWINGS,
    fallback: GENERAL_EXPENSE,
    defaultParty: "Owner",
  },
  {
    key: "customer-refund",
    direction: "out",
    label: "Refund to a customer",
    hint: "Money sent back to a customer — including money that reached the business by mistake.",
    counterAccount: HELD_FOR_CUSTOMERS,
    fallback: REFUND_EXPENSE,
  },
  {
    key: "other-payment",
    direction: "out",
    label: "Other payment out",
    hint: "Anything else leaving the till or the bank that is not a vendor order.",
    counterAccount: GENERAL_EXPENSE,
  },
  {
    key: "funds-received",
    direction: "in",
    label: "Funds received to hold",
    hint: "Money in that is not a sale — a customer who paid too much or paid in error. It is owed back until it is refunded.",
    counterAccount: HELD_FOR_CUSTOMERS,
    fallback: PAYABLE,
  },
  {
    key: "owner-funding",
    direction: "in",
    label: "Money put in by the owner",
    hint: "Cash the owner puts into the business.",
    counterAccount: OWNER_EQUITY,
  },
];

export const CASH_PURPOSE_KEYS = CASH_PURPOSES.map((purpose) => purpose.key);
/** The purposes this module records itself; a vendor payment is an order, not a cash entry. */
export const CASH_ENTRY_PURPOSES = CASH_PURPOSES.filter((purpose) => !purpose.needsVendor);

export function findPurpose(key) {
  return CASH_PURPOSES.find((purpose) => purpose.key === key) || null;
}

export function purposeLabel(key) {
  return findPurpose(key)?.label || "Cash entry";
}

/** Which way the money runs for a purpose. Out unless the purpose says otherwise. */
export function purposeDirection(key) {
  return findPurpose(key)?.direction === "in" ? "in" : "out";
}

/**
 * The two lines this entry posts: cash on one side, the purpose account on the
 * other. Money out debits the purpose and credits cash; money in does the reverse.
 */
export function cashEntryLines({ purpose, amount = 0, party = "", settlementAccount = CASH } = {}) {
  const rule = findPurpose(purpose);
  const value = Math.round((Number(amount) || 0) * 100) / 100;
  if (!rule || rule.needsVendor || value <= 0) return [];

  const who = party || rule.defaultParty || "";
  const description = who ? `${rule.label} — ${who}` : rule.label;

  if (rule.direction === "in") {
    return [
      { code: settlementAccount, debit: value, description },
      { code: rule.counterAccount, fallback: rule.fallback, credit: value, description },
    ];
  }
  return [
    { code: rule.counterAccount, fallback: rule.fallback, debit: value, description },
    { code: settlementAccount, credit: value, description },
  ];
}

/** A short line for a list: who, and which way it went. */
export function describeCashEntry(entry = {}) {
  const rule = findPurpose(entry.purpose);
  const who = entry.party || rule?.defaultParty || "";
  return who ? `${rule?.label || "Cash entry"} — ${who}` : rule?.label || "Cash entry";
}
