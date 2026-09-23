/**
 * API: /api/stock-orders/[id]
 *
 * GET    — one order.
 * PUT    — edit its lines, or receive it.
 * DELETE — remove an order that was raised in error.
 *
 * Receiving raises the purchase order and hands the id back, so the caller can go on
 * to the receive screen and book the stock in with expiry dates and a location.
 */
import { mongooseConnect } from "@/lib/mongodb";
import StockOrder, { isOnOrder } from "@/models/StockOrder";
import { authMiddleware, isStaff, isAdmin } from "@/lib/auth-middleware";
import { isValidObjectId } from "mongoose";
import {
  createPurchaseOrderFromStockOrder,
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

  if (req.method === "GET") {
    const populated = await StockOrder.findById(id).populate("vendor", "companyName repPhone").lean();
    return res.status(200).json({ success: true, order: populated });
  }

  if (req.method === "PUT") {
    try {
      const { action } = req.body || {};

      if (action === "receive") {
        if (!isOnOrder(order)) {
          return res.status(400).json({ error: "This order has already been received" });
        }
        if (!order.vendor) {
          return res.status(400).json({ error: "This order has no vendor, so it cannot be received" });
        }

        const purchaseOrder = await createPurchaseOrderFromStockOrder(order, {
          staffId: req.user?.id,
          staffName: req.user?.name,
          notes: `Received from stock order ${order.orderRef || order._id}`,
        });

        // Kept as a record rather than deleted, so the order can still be traced back
        // from the purchase order it became.
        order.stage = "Received";
        order.receivedAt = new Date();
        order.receivedBy = req.user?.id || null;
        order.purchaseOrderId = purchaseOrder._id;
        await order.save();

        return res.status(200).json({
          success: true,
          message: "Stock order received and a purchase order raised",
          purchaseOrderId: purchaseOrder._id,
          orderRef: purchaseOrder.orderRef,
        });
      }

      // Plain edit of the order's own details
      if (!isOnOrder(order)) {
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
      }

      await order.save();
      return res.status(200).json({ success: true, order });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    try {
      if (!isOnOrder(order) && !isAdmin(req)) {
        return res.status(403).json({ error: "Only an administrator can delete a received order" });
      }
      await StockOrder.deleteOne({ _id: id });
      return res.status(200).json({ success: true, message: "Stock order deleted" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
