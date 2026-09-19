import { mongooseConnect } from "@/lib/mongodb";
import StockMovement from "@/models/StockMovement";
import Product from "@/models/Product";
import mongoose from "mongoose";
import { buildLocationCache, resolveLocationName } from "@/lib/serverLocationHelper";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { formatVendorMovementLabel } from "@/lib/vendorDisplay";
import { deriveChildQty } from "@/lib/syncPackQty";
import { sanitizeMultilineText } from "@/lib/textSanitizers";

/**
 * How a movement of each reason changes global stock, per unit.
 * Transfer moves stock between locations without changing the total.
 */
const STOCK_SIGN = {
  Restock: 1,
  Return: -1,
  Adjustment: -1,
  "Operational Loss": -1,
  Transfer: 0,
};

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  await mongooseConnect();

  const { id } = req.query;

  if (req.method === "GET") {
    try {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid ID format" });
      }

      const movement = await StockMovement.findById(id).populate("products.productId");
       


      if (!movement) {
        return res.status(404).json({ message: "Movement not found" });
      }

      // Debug: Log the raw movement data
      console.log("Raw movement:", JSON.stringify(movement, null, 2));
      console.log("Raw products:", movement.products);

      // If products don't have productId populated, try to fetch them
      let productsWithDetails = [];
      
      if (movement.products && movement.products.length > 0) {
        productsWithDetails = await Promise.all(
          movement.products.map(async (p) => {
            console.log("Processing product:", p);
            let product = p.productId;
            
            // If productId is not populated (it's just an ObjectId string), fetch the product
            if (!product || typeof product === 'string' || !product.name) {
              const productId = p.productId?._id || p.productId || p.id;
              console.log("Fetching product with ID:", productId);
              if (productId) {
                product = await Product.findById(productId);
                console.log("Fetched product:", product?.name, product?.costPrice);
              }
            }
            
            return {
              productId: p.productId?._id || p.productId || p.id,
              productName: product?.name || "N/A",
              quantity: p.quantity,
              costPrice: product?.costPrice || 0,
              salePrice: product?.salePriceIncTax || 0,
              barcode: product?.barcode || "",
            };
          })
        );
      }

      // Build location cache using centralized helper
      const locationCache = await buildLocationCache();

      // Use stored totalCostPrice if available, otherwise calculate
      let totalCostPrice = movement.totalCostPrice || 0;
      
      if (totalCostPrice === 0 && productsWithDetails && productsWithDetails.length > 0) {
        totalCostPrice = productsWithDetails.reduce((sum, p) => {
          return sum + (p.costPrice || 0) * p.quantity;
        }, 0);
      }

      // Map location IDs to names using centralized helper
      const fromLocationId = movement.fromLocationId || movement.fromLocation || "";
      const toLocationId = movement.toLocationId || movement.toLocation || "";
      
      const senderName = fromLocationId
        ? await resolveLocationName(fromLocationId, locationCache)
        : movement.reason === "Restock"
        ? formatVendorMovementLabel(movement.vendorName)
        : "Unknown";
      const receiverName = toLocationId
        ? await resolveLocationName(toLocationId, locationCache)
        : movement.reason === "Return"
        ? formatVendorMovementLabel(movement.vendorName)
        : movement.reason === "Operational Loss"
        ? "Loss Register"
        : "Unknown";

      return res.status(200).json({
        _id: movement._id,
        transRef: movement.transRef,
        vendorName: movement.vendorName || "",
        fromLocation: senderName,
        toLocation: receiverName,
        reason: movement.reason,
        staff: movement.staffId || movement.staff,
        dateSent: movement.dateSent || movement.createdAt,
        dateReceived: movement.dateReceived || movement.updatedAt,
        status: movement.status || "Received",
        totalCostPrice,
        notes: movement.notes || "",
        products: productsWithDetails,
      });
    } catch (err) {
      console.error("Server error:", err);
      return res.status(500).json({ message: "Server error", details: err.message });
    }
  }

  /* ─────────────────────────────────────────────────────────────
     PUT — edit received quantities / mark a movement as received.

     The detail page has always had an "Edit / Receive" button, but it
     pointed at a page that did not exist and there was no endpoint behind
     it. Receiving reconciles the quantity that actually arrived against
     what was sent, and moves the stock difference on the product record so
     inventory stays truthful.
     ───────────────────────────────────────────────────────────── */
  if (req.method === "PUT") {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format" });
    }

    const { products: submitted, notes, status, staffId } = req.body || {};

    if (!Array.isArray(submitted)) {
      return res.status(400).json({ message: "products must be an array" });
    }

    if (status && !["Pending", "Sent", "Received"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const session = await mongoose.startSession();
    let touchedProductIds = [];

    try {
      await session.withTransaction(async () => {
        const movement = await StockMovement.findById(id).session(session);
        if (!movement) {
          const err = new Error("Movement not found");
          err.statusCode = 404;
          throw err;
        }

        const sign = STOCK_SIGN[movement.reason] ?? 0;
        const bulkOps = [];
        let totalCostPrice = 0;

        // Index the submitted lines by product so order does not matter
        const submittedByProduct = new Map(
          submitted
            .filter((line) => line && line.productId)
            .map((line) => [String(line.productId), line])
        );

        for (const line of movement.products) {
          const productId = String(line.productId?._id || line.productId || "");
          const update = submittedByProduct.get(productId);
          const previousQty = Number(line.quantity) || 0;

          if (update) {
            const nextQty = Number(update.quantity);
            if (!Number.isFinite(nextQty) || nextQty < 0) {
              const err = new Error(`Invalid quantity for product ${productId}`);
              err.statusCode = 400;
              throw err;
            }

            // Only the delta is applied, so saving twice does not double-count.
            const delta = nextQty - previousQty;
            if (delta !== 0 && sign !== 0) {
              bulkOps.push({
                updateOne: {
                  filter: { _id: productId },
                  update: { $inc: { quantity: delta * sign } },
                },
              });
              touchedProductIds.push(productId);
            }

            line.quantity = nextQty;
            if (update.notes !== undefined) line.notes = sanitizeMultilineText(update.notes);
            if (update.expiryDate !== undefined) {
              line.expiryDate = update.expiryDate ? new Date(update.expiryDate) : null;
            }
          }

          totalCostPrice += (Number(line.costPrice) || 0) * (Number(line.quantity) || 0);
        }

        // Fall back to the live product cost when the line never stored one
        if (totalCostPrice === 0) {
          const ids = movement.products.map((p) => p.productId).filter(Boolean);
          const costs = await Product.find({ _id: { $in: ids } })
            .select("_id costPrice")
            .session(session)
            .lean();
          const costMap = new Map(costs.map((p) => [String(p._id), p.costPrice || 0]));
          totalCostPrice = movement.products.reduce(
            (sum, line) =>
              sum + (costMap.get(String(line.productId)) || 0) * (Number(line.quantity) || 0),
            0
          );
        }

        movement.totalCostPrice = Math.round(totalCostPrice * 100) / 100;
        if (notes !== undefined) movement.notes = sanitizeMultilineText(notes);
        if (staffId && mongoose.Types.ObjectId.isValid(staffId)) movement.staffId = staffId;

        if (status && status !== movement.status) {
          movement.status = status;
          if (status === "Received" && !movement.dateReceived) {
            movement.dateReceived = new Date();
          }
        } else if (!movement.dateReceived && movement.status === "Received") {
          movement.dateReceived = new Date();
        }

        if (bulkOps.length > 0) {
          const result = await Product.bulkWrite(bulkOps, { session });
          const applied = (result.modifiedCount || 0) + (result.matchedCount || 0);
          if (applied < bulkOps.length) {
            throw new Error(
              `Stock update failed: ${bulkOps.length - applied} of ${bulkOps.length} products were not updated. Rolling back.`
            );
          }
        }

        await movement.save({ session });
      });
    } catch (err) {
      await session.endSession();
      const code = err.statusCode || 500;
      console.error("Stock movement update error:", err.message);
      return res.status(code).json({ message: err.message || "Failed to update movement" });
    }

    await session.endSession();

    // Child pack quantities are derived, so refresh them outside the transaction
    for (const productId of [...new Set(touchedProductIds)]) {
      try {
        await deriveChildQty(productId);
      } catch (deriveErr) {
        console.warn(`deriveChildQty failed for ${productId}:`, deriveErr.message);
      }
    }

    return res.status(200).json({ success: true, message: "Stock movement updated" });
  }

  return res.status(405).json({ message: "Method not allowed" });
}
