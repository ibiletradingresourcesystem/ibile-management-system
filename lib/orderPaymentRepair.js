/**
 * Bring old orders onto the current payment rules.
 *
 * The balance used to be written clamped at zero, so an order paid past what it
 * came to was saved as "Paid" with nothing recording that the vendor was holding
 * store money. Those records are still in the database, and nothing would have
 * recomputed them until somebody happened to edit each one.
 *
 * A list route hands its rows through here: the figures are worked out again for
 * the response, and any record whose stored copy disagrees is repaired in place,
 * so the books, the exports and the payment tracker all read the same thing.
 */
import { derivePaymentState } from "@/lib/orderPayments";

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * @param {import("mongoose").Model} Model  the order model the rows came from
 * @param {object[]} orders                 lean order documents
 * @returns {Promise<object[]>}             the same orders, with current figures
 */
export async function repayPaymentState(Model, orders = []) {
  if (!Array.isArray(orders) || orders.length === 0) return orders || [];

  const repairs = [];
  const corrected = orders.map((order) => {
    const state = derivePaymentState(order);
    const stale =
      money(order.balance) !== state.balance ||
      money(order.vendorCredit) !== state.vendorCredit ||
      (order.status || "") !== state.status;

    if (stale && order._id) {
      repairs.push({ updateOne: { filter: { _id: order._id }, update: { $set: state } } });
    }
    return { ...order, ...state };
  });

  if (repairs.length > 0) {
    try {
      // Awaited rather than left running: a serverless function is killed the
      // moment it responds, and an unfinished repair would never land.
      await Model.bulkWrite(repairs, { ordered: false });
    } catch (error) {
      // A failed repair must not cost the caller its list.
      console.error("Order payment repair failed:", error?.message || error);
    }
  }

  return corrected;
}
