/**
 * Which way the money runs on a vendor order.
 *
 * The balance used to be clamped at zero everywhere it was written, so money paid
 * past what an order came to simply vanished: the order read "Paid", the credit
 * card on the payment tracker read zero, and nothing recorded that the vendor was
 * holding the store money. These are the rules, in one place, for both the API
 * routes that write an order and the pages that read one:
 *
 *   balance        what the STORE still owes the vendor. Negative means the money
 *                  has gone the other way and the vendor is holding too much.
 *   vendorCredit   what the VENDOR owes the store — an overpayment past the order
 *                  value, or a payment made up front for goods not yet supplied.
 *                  Either way it is the store money sitting with the vendor, and
 *                  it is owed back in goods or in cash.
 *
 * Nothing here touches the database, so a page can import it.
 */

const toMoney = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
};

export const PAYMENT_STATUSES = ["Not Paid", "Partly Paid", "Paid", "Credit"];

/** Has the order been delivered? Anything other than "Received" means no. */
const isReceived = (receivedStatus) => String(receivedStatus || "") === "Received";

/**
 * What the store still owes. Left signed on purpose: a negative balance is the
 * vendor owing the store, and clamping it is what hid the credit in the first place.
 */
export function deriveBalance({ grandTotal = 0, paymentMade = 0 } = {}) {
  return toMoney(toMoney(grandTotal) - toMoney(paymentMade));
}

/**
 * What the vendor owes the store: store money they are holding without having
 * given value for it.
 *
 *   overpaid            paid past the order value — owed back in cash or goods
 *   paid before supply  the order settled up front and nothing delivered yet
 */
export function deriveVendorCredit({
  grandTotal = 0,
  paymentMade = 0,
  payBeforeSupply = false,
  receivedStatus = "Pending",
} = {}) {
  const paid = toMoney(paymentMade);
  const total = toMoney(grandTotal);
  if (paid <= 0) return 0;

  const overpaid = toMoney(Math.max(0, paid - total));
  if (overpaid > 0) return overpaid;

  if (payBeforeSupply && !isReceived(receivedStatus) && total > 0 && paid >= total) {
    return paid;
  }
  return 0;
}

/** Where a payment stands, given what is paid and whether the goods have arrived. */
export function derivePaymentStatus({
  paymentMade = 0,
  grandTotal = 0,
  payBeforeSupply = false,
  receivedStatus = "Pending",
} = {}) {
  const paid = toMoney(paymentMade);
  const total = toMoney(grandTotal);
  const fullyPaid = total > 0 && paid >= total;

  if (paid <= 0) return "Not Paid";
  // More has gone out than the order was worth: the vendor owes the difference,
  // whether or not the goods arrived.
  if (paid > total) return "Credit";
  // Paid up front and still not delivered: the vendor owes goods, not money.
  if (payBeforeSupply && !isReceived(receivedStatus) && fullyPaid) return "Credit";
  if (fullyPaid) return "Paid";
  return "Partly Paid";
}

/**
 * The three figures together, for a route that is about to save an order or a
 * page that is about to show one.
 */
export function derivePaymentState({
  grandTotal = 0,
  paymentMade = 0,
  payBeforeSupply = false,
  receivedStatus = "Pending",
} = {}) {
  const args = { grandTotal, paymentMade, payBeforeSupply, receivedStatus };
  return {
    balance: deriveBalance(args),
    vendorCredit: deriveVendorCredit(args),
    status: derivePaymentStatus(args),
  };
}

/** What the store still owes, for a total that should not count credits. */
export function amountStoreOwes(order = {}) {
  return Math.max(0, deriveBalance(order));
}
