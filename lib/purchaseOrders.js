/**
 * Purchase order helpers shared by the ordering, receiving and seeding routes.
 *
 * The reference generator and the payment-status rule used to be copied into every
 * route that touched a purchase order, so a change to either had to be made in
 * several places to hold.
 */
import PurchaseOrder from "@/models/PurchaseOrder";
import { isValidObjectId } from "mongoose";
import { sanitizePlainText } from "@/lib/textSanitizers";

/** Where a payment stands, given what is paid and whether the goods have arrived. */
export function derivePaymentStatus({
  paymentMade = 0,
  grandTotal = 0,
  payBeforeSupply = false,
  receivedStatus = "Pending",
}) {
  const paidAmount = Number(paymentMade) || 0;
  const totalAmount = Number(grandTotal) || 0;
  const fullyPaid = totalAmount > 0 && paidAmount >= totalAmount;

  if (paidAmount <= 0) return "Not Paid";
  // Paid up front and still not delivered: the vendor owes goods, not money.
  if (payBeforeSupply && receivedStatus !== "Received" && fullyPaid) return "Credit";
  if (fullyPaid) return "Paid";
  return "Partly Paid";
}

export function generateOrderRef(prefix = "PO") {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${rand}`;
}

/** Order lines with the numbers filled in and only real product ids kept. */
export function normalizeOrderProducts(products = []) {
  return (Array.isArray(products) ? products : [])
    .map((product) => {
      const quantity = Number(product?.quantity) || 0;
      const price = Number(product?.price ?? product?.costPrice) || 0;
      const line = {
        name: sanitizePlainText(product?.name || ""),
        quantity,
        price,
        total: Number(product?.total) || quantity * price,
      };
      if (isValidObjectId(product?.productId)) line.productId = product.productId;
      return line;
    })
    .filter((product) => product.name);
}

export const sumTotals = (products = []) =>
  products.reduce((sum, product) => sum + (Number(product.total) || 0), 0);

/**
 * Create the purchase order for a stock order that has been received.
 * It is raised as Pending on purpose: the stock itself is booked in on the receive
 * screen, where quantities, expiry dates and the destination location are confirmed.
 */
export async function createPurchaseOrderFromStockOrder(stockOrder, { staffId, staffName, notes } = {}) {
  const products = normalizeOrderProducts(stockOrder.products);
  const grandTotal = Number(stockOrder.grandTotal) || sumTotals(products);
  const paymentMade = Number(stockOrder.paymentMade) || 0;
  const payBeforeSupply = Boolean(stockOrder.payBeforeSupply);

  return PurchaseOrder.create({
    orderRef: generateOrderRef(),
    date: stockOrder.date || new Date(),
    vendor: stockOrder.vendor,
    vendorName: stockOrder.supplier || stockOrder.vendorName || "",
    contact: sanitizePlainText(stockOrder.contact || ""),
    location: sanitizePlainText(stockOrder.location || ""),
    locationId: stockOrder.locationId || null,
    products,
    grandTotal,
    paymentMade,
    paymentDate: stockOrder.paymentDate || "",
    balance: Math.max(0, grandTotal - paymentMade),
    status: derivePaymentStatus({ paymentMade, grandTotal, payBeforeSupply, receivedStatus: "Pending" }),
    payBeforeSupply,
    staff: staffId || stockOrder.staff || null,
    staffName: staffName || stockOrder.staffName || "",
    notes: [stockOrder.notes, notes].filter(Boolean).join("\n"),
    receivedStatus: "Pending",
    sourceApp: stockOrder.sourceApp || "",
    sourceId: stockOrder.sourceId || "",
    stockOrderId: stockOrder._id,
  });
}
