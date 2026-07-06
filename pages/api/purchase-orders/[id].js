import { mongooseConnect } from "@/lib/mongodb";
import mongoose from "mongoose";
import PurchaseOrder from "@/models/PurchaseOrder";
import StockMovement from "@/models/StockMovement";
import Product from "@/models/Product";
import { deriveChildQty } from "@/lib/syncPackQty";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { isValidObjectId } from "mongoose";
import { postPurchaseOrderPayment } from "@/lib/accounting";
import { sanitizeMultilineText, sanitizePlainText } from "@/lib/textSanitizers";

function derivePaymentStatus({ paymentMade = 0, grandTotal = 0, payBeforeSupply = false, receivedStatus = "Pending" }) {
  const paidAmount = Number(paymentMade) || 0;
  const totalAmount = Number(grandTotal) || 0;
  const fullyPaid = totalAmount > 0 && paidAmount >= totalAmount;

  if (paidAmount <= 0) return "Not Paid";
  if (payBeforeSupply && receivedStatus !== "Received" && fullyPaid) return "Credit";
  if (fullyPaid) return "Paid";
  return "Partly Paid";
}

function generateTransRef() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `SM-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${rand}`;
}

function normalizeMovementProducts(products = []) {
  return (Array.isArray(products) ? products : [])
    .map((product) => ({
      productId: product?.productId || product?.id || null,
      quantity: Number(product?.quantity) || 0,
      costPrice: Number(product?.costPrice ?? product?.price) || 0,
      expiryDate: product?.expiryDate ? new Date(product.expiryDate) : null,
      notes: sanitizePlainText(product?.notes),
    }))
    .filter((product) => isValidObjectId(product.productId) && product.quantity > 0);
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  const { id } = req.query;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: "Invalid order ID" });
  }

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const order = await PurchaseOrder.findById(id).populate("vendor", "companyName vendorRep repPhone").lean();
      if (!order) return res.status(404).json({ error: "Order not found" });
      return res.status(200).json({ success: true, order });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "PUT") {
    try {
      const order = await PurchaseOrder.findById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });

      const { action } = req.body;

      // Update payment
      if (action === "update-payment") {
        const { paymentMade, paymentDate } = req.body;
        order.paymentMade = paymentMade !== undefined ? Number(paymentMade) : order.paymentMade;
        order.balance = Math.max(0, Number(order.grandTotal || 0) - Number(order.paymentMade || 0));
        order.paymentDate = paymentDate || order.paymentDate;
        order.status = derivePaymentStatus({
          paymentMade: order.paymentMade,
          grandTotal: order.grandTotal,
          payBeforeSupply: order.payBeforeSupply,
          receivedStatus: order.receivedStatus,
        });
        await order.save();

        // Auto-post accounting journal entry for PO payment
        try {
          const paymentAmount = paymentMade !== undefined ? Number(paymentMade) : 0;
          if (paymentAmount > 0) {
            await postPurchaseOrderPayment(order, paymentAmount);
          }
        } catch (acctErr) {
          console.error("Accounting auto-post failed for PO payment:", order._id, acctErr.message);
        }

        return res.status(200).json({ success: true, order });
      }

      // Confirm received → auto-create stock movement
      if (action === "confirm-received") {
        if (order.receivedStatus === "Received") {
          return res.status(400).json({ error: "Order already received" });
        }

        const { toLocationId, staffId, notes, products: receivedProducts } = req.body;
        const requestedProducts = normalizeMovementProducts(receivedProducts);
        const sourceProducts =
          requestedProducts.length > 0
            ? requestedProducts
            : order.products
                .filter((product) => product.productId && product.quantity > 0)
                .map((product) => ({
                  productId: product.productId,
                  quantity: Number(product.quantity) || 0,
                  costPrice: Number(product.price) || 0,
                  expiryDate: null,
                  notes: `From PO: ${order.orderRef}`,
                }));

        // Create stock movement from this purchase order — resolve child products to parent
        const parentResolutions = new Map();
        if (sourceProducts.length > 0) {
          const productDocs = await Product.find({
            _id: { $in: sourceProducts.map((product) => product.productId) },
          }).select("_id isChildProduct parentProduct packType").lean();
          for (const doc of productDocs) {
            if (doc.isChildProduct && doc.parentProduct) {
              parentResolutions.set(String(doc._id), String(doc.parentProduct));
            }
          }
        }

        // Build movement products, merging children into their parent entries
        const movementProductMap = new Map();
        for (const product of sourceProducts) {
          const resolvedId = parentResolutions.get(String(product.productId)) || String(product.productId);
          const existing = movementProductMap.get(resolvedId);
          if (existing) {
            existing.quantity += product.quantity;
          } else {
            movementProductMap.set(resolvedId, {
              productId: resolvedId,
              quantity: product.quantity,
              expiryDate: product.expiryDate,
              costPrice: product.costPrice,
              notes: product.notes || `From PO: ${order.orderRef}`,
            });
          }
        }
        const movementProducts = [...movementProductMap.values()];

        if (movementProducts.length === 0) {
          return res.status(400).json({ error: "No valid products available to receive" });
        }

        const totalCostPrice = movementProducts.reduce(
          (sum, product) => sum + (product.costPrice || 0) * product.quantity,
          0
        );

        const movementNotes = [
          `Auto-generated from Purchase Order ${order.orderRef}`,
          sanitizeMultilineText(notes),
        ]
          .filter(Boolean)
          .join("\n");

        // Use a transaction to ensure movement + stock update are atomic
        const session = await mongoose.startSession();
        let stockMovement = null;

        try {
          await session.withTransaction(async () => {
            // 1. Create the stock movement
            const [created] = await StockMovement.create(
              [
                {
                  transRef: generateTransRef(),
                  fromLocationId: null,
                  vendorName: order.vendorName || "",
                  toLocationId: toLocationId || null,
                  staffId: staffId || req.user?.id || order.staff || null,
                  reason: "Restock",
                  status: "Received",
                  totalCostPrice,
                  dateSent: new Date(),
                  dateReceived: new Date(),
                  products: movementProducts,
                  notes: movementNotes,
                },
              ],
              { session }
            );
            stockMovement = created;

            // 2. Bulk update product quantities
            const bulkOps = movementProducts.map((item) => ({
              updateOne: {
                filter: { _id: item.productId },
                update: { $inc: { quantity: item.quantity } },
              },
            }));

            const bulkResult = await Product.bulkWrite(bulkOps, { session });

            // 3. Verify all products were updated
            const expectedUpdates = bulkOps.length;
            const actualUpdates = (bulkResult.modifiedCount || 0) + (bulkResult.matchedCount || 0);
            if (actualUpdates < expectedUpdates) {
              const failedCount = expectedUpdates - actualUpdates;
              throw new Error(
                `PO stock update verification failed: ${failedCount} of ${expectedUpdates} products were not updated. Rolling back.`
              );
            }

            // 4. Update the PO status within the same transaction
            order.stockMovementId = stockMovement._id;
            order.receivedStatus = "Received";
            order.receivedAt = new Date();
            order.status = derivePaymentStatus({
              paymentMade: order.paymentMade,
              grandTotal: order.grandTotal,
              payBeforeSupply: order.payBeforeSupply,
              receivedStatus: "Received",
            });
            await order.save({ session });
          });
        } finally {
          await session.endSession();
        }

        // 5. Post-transaction: derive child quantities (safe outside transaction)
        for (const item of movementProducts) {
          try {
            await deriveChildQty(item.productId);
          } catch (deriveErr) {
            console.warn(`⚠️ deriveChildQty failed for ${item.productId}:`, deriveErr.message);
          }
        }

        return res.status(200).json({
          success: true,
          message: "Order received and stock updated",
          order,
          stockMovementId: stockMovement._id,
        });
      }

      // General update
      const allowedFields = ["notes", "payBeforeSupply", "status"];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          order[field] = field === "notes" ? sanitizeMultilineText(req.body[field]) : req.body[field];
        }
      }
      if (req.body.payBeforeSupply !== undefined) {
        order.status = derivePaymentStatus({
          paymentMade: order.paymentMade,
          grandTotal: order.grandTotal,
          payBeforeSupply: order.payBeforeSupply,
          receivedStatus: order.receivedStatus,
        });
      }
      await order.save();
      return res.status(200).json({ success: true, order });
    } catch (err) {
      console.error("PurchaseOrder update error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    try {
      const order = await PurchaseOrder.findById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      if (order.receivedStatus === "Received") {
        return res.status(400).json({ error: "Cannot delete a received order" });
      }
      await PurchaseOrder.deleteOne({ _id: id });
      return res.status(200).json({ success: true, message: "Order deleted" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
