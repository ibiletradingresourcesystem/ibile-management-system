/**
 * API: /api/stock-orders/[id]
 *
 * GET    — one order.
 * PUT    — edit its lines, or receive it.
 * DELETE — remove an order that was raised in error.
 *
 * Receiving raises the purchase order and hands the id back, so the caller can go on
 * to the receive screen and book the stock in with expiry dates and a location. The order
 * stays on order until that is done: it used to be marked received here, before any stock
 * was booked, and when the receive screen failed or was left the order simply disappeared.
 * Pressing Receive again goes back to the same purchase order.
 */
import { mongooseConnect } from "@/lib/mongodb";
import StockOrder, { isOnOrder, receivableLines } from "@/models/StockOrder";
import PurchaseOrder from "@/models/PurchaseOrder";
import { authMiddleware, isStaff, isAdmin, isBasicStaff } from "@/lib/auth-middleware";
import { isValidObjectId } from "mongoose";
import {
  createPurchaseOrderFromStockOrder,
  derivePaymentState,
  normalizeOrderProducts,
  sumTotals,
} from "@/lib/purchaseOrders";
import { sanitizeMultilineText, sanitizePlainText } from "@/lib/textSanitizers";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  const { id } = req.query;
  if (!isValidObjectId(id)) return res.status(400).json({ error: "Invalid order ID" });

  await mongooseConnect();

  const order = await StockOrder.findById(id);
  if (!order) return res.status(404).json({ error: "Stock order not found" });

  // The purchase order raised when Receive was pressed, while its stock is still to be booked
  const linkedPo = order.purchaseOrderId ? await PurchaseOrder.findById(order.purchaseOrderId) : null;
  const stockBooked = linkedPo?.receivedStatus === "Received";
  const stillOnOrder = !stockBooked && (isOnOrder(order) || Boolean(linkedPo));

  if (req.method === "GET") {
    const populated = await StockOrder.findById(id).populate("vendor", "companyName repPhone").lean();
    return res.status(200).json({ success: true, order: populated });
  }

  if (req.method === "PUT") {
    try {
      const { action } = req.body || {};

      if (action === "receive") {
        if (isBasicStaff(req)) {
          return res.status(403).json({ error: "Receiving stock orders is for a manager. Ask one to receive this order." });
        }
        if (!stillOnOrder) {
          return res.status(400).json({ error: "This order has already been received" });
        }
        if (!order.vendor) {
          return res.status(400).json({ error: "This order has no vendor, so it cannot be received" });
        }
        // An order with a total but no product lines (or only lines ordered as 0) has no stock
        // to book: the receive screen opened empty and the order was gone.
        if (receivableLines(order).length === 0) {
          return res.status(400).json({
            code: "NOTHING_TO_RECEIVE",
            error:
              (order.products || []).length === 0
                ? "This order has no products on it, so there is no stock to receive. Open View / Edit and add the products that came, then receive it."
                : "Every product on this order has a quantity of 0, so there is no stock to receive. Open View / Edit and enter the quantities that came.",
          });
        }

        let purchaseOrder = linkedPo;
        if (!purchaseOrder) {
          purchaseOrder = await createPurchaseOrderFromStockOrder(order, {
            staffId: req.user?.id,
            staffName: req.user?.name,
            notes: `Received from stock order ${order.orderRef || order._id}`,
          });
        } else {
          // Receiving again: the lines may have been edited since the first try
          const products = normalizeOrderProducts(order.products);
          purchaseOrder.products = products;
          purchaseOrder.grandTotal = Number(order.grandTotal) || sumTotals(products);
          Object.assign(purchaseOrder, derivePaymentState(purchaseOrder));
          await purchaseOrder.save();
        }

        order.purchaseOrderId = purchaseOrder._id;
        order.receivingStartedAt = order.receivingStartedAt || new Date();
        await order.save();

        return res.status(200).json({
          success: true,
          message: linkedPo ? "Back to receiving this order" : "Purchase order raised; book the stock in to finish",
          purchaseOrderId: purchaseOrder._id,
          orderRef: purchaseOrder.orderRef,
          continued: Boolean(linkedPo),
        });
      }

      // Plain edit of the order's own details
      if (!stillOnOrder) {
        return res.status(400).json({ error: "A received order can no longer be edited" });
      }

      const { date, contact, location, notes, products } = req.body || {};
      if (date !== undefined) order.date = date;
      if (contact !== undefined) order.contact = sanitizePlainText(contact);
      if (location !== undefined) order.location = sanitizePlainText(location);
      if (notes !== undefined) order.notes = sanitizeMultilineText(notes);

      if (products !== undefined) {
        const normalized = normalizeOrderProducts(products);
        if (normalized.length === 0) {
          return res.status(400).json({ error: "An order needs at least one product" });
        }
        order.products = normalized;
        order.grandTotal = sumTotals(normalized);
        // The order is worth something different now, so what is owed — or what the
        // vendor is holding, on a seeded order that was already paid on — moves with it.
        Object.assign(order, derivePaymentState(order));
      }

      await order.save();
      return res.status(200).json({ success: true, order });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    try {
      if (isBasicStaff(req)) {
        return res.status(403).json({ error: "Deleting stock orders is for a manager." });
      }
      if (!stillOnOrder && !isAdmin(req)) {
        return res.status(403).json({ error: "Only an administrator can delete a received order" });
      }
      // Receiving had started: its purchase order goes too, unless money has been recorded on it
      if (stillOnOrder && linkedPo) {
        if ((Number(linkedPo.paymentMade) || 0) > 0) {
          return res.status(400).json({
            error: `A payment is recorded on its purchase order ${linkedPo.orderRef || ""}. Finish receiving it, or remove the payment in the Vendor Payment Tracker first.`,
          });
        }
        await PurchaseOrder.deleteOne({ _id: linkedPo._id });
      }
      await StockOrder.deleteOne({ _id: id });
      return res.status(200).json({ success: true, message: "Stock order deleted" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
