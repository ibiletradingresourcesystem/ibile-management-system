import { mongooseConnect } from "@/lib/mongodb";
import mongoose from "mongoose";
import Product from "@/models/Product";
import StockMovement from "@/models/StockMovement";
import { deriveChildQty } from "@/lib/syncPackQty";
import { isValidObjectId } from "mongoose";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { sanitizeMultilineText, sanitizePlainText } from "@/lib/textSanitizers";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { fromLocationId, toLocationId, staffId, reason, products, notes, vendorName } = req.body;
  const isOperationalLoss = reason === "Operational Loss";

  /* =========================
     BASIC VALIDATION
  ========================= */
  if (!fromLocationId || !reason || (!isOperationalLoss && !toLocationId)) {
    return res.status(400).json({
      message: isOperationalLoss
        ? "Missing required fields: fromLocationId, reason"
        : "Missing required fields: fromLocationId, toLocationId, reason",
    });
  }

  if (typeof fromLocationId !== "string" || (!isOperationalLoss && typeof toLocationId !== "string")) {
    return res.status(400).json({
      message: isOperationalLoss
        ? "fromLocationId must be a string"
        : "fromLocationId and toLocationId must be strings",
    });
  }

  // Handle special cases and validate ObjectId format
  const isFromLocationVendor = fromLocationId.toLowerCase() === "vendor" || fromLocationId === "vendor";
  const isToLocationVendor = typeof toLocationId === "string" && (toLocationId.toLowerCase() === "vendor" || toLocationId === "vendor");
  
  // Validate that actual location IDs (non-vendor) are valid ObjectIds
  if (!isFromLocationVendor && !isValidObjectId(fromLocationId)) {
    return res.status(400).json({
      message: `Invalid fromLocationId format: "${fromLocationId}". Must be a valid location ID or "vendor" for external stock.`,
    });
  }

  if (isOperationalLoss && isFromLocationVendor) {
    return res.status(400).json({
      message: "Operational loss must be recorded against a real stock location.",
    });
  }

  if (!isOperationalLoss && !isToLocationVendor && !isValidObjectId(toLocationId)) {
    return res.status(400).json({
      message: `Invalid toLocationId format: "${toLocationId}". Must be a valid location ID or "vendor" for returns.`,
    });
  }

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({
      message: "Products must be a non-empty array",
    });
  }

  try {
    await mongooseConnect();

    /* =========================
       VALIDATE PRODUCTS
    ========================= */
    let totalCostPrice = 0;
    const productsToCreate = [];

    for (const item of products) {
      const { id, quantity, expiryDate } = item;

      if (!id || typeof quantity !== "number" || quantity < 1) {
        return res.status(400).json({
          message:
            "Invalid product format. Each product must have id and quantity >= 1",
          product: item,
        });
      }

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          message: `Invalid product ID format: ${id}`,
        });
      }

      const product = await Product.findById(id).select("_id name costPrice isStockManaged isChildProduct parentProduct packType qtyPerPack");
      if (!product) {
        return res.status(404).json({
          message: `Product not found with ID: ${id}`,
        });
      }

      // If product is a child, resolve to parent and add qty to parent instead
      if (product.isChildProduct && product.parentProduct) {
        const parentProduct = await Product.findById(product.parentProduct).select("_id name costPrice isStockManaged packType qtyPerPack");
        if (!parentProduct) {
          return res.status(400).json({
            message: `"${product.name || id}" is a child product but its parent could not be found. Please use the parent product directly.`,
          });
        }

        // Merge qty into existing parent entry or create a new one
        const existingParent = productsToCreate.find(p => String(p.productId) === String(parentProduct._id));
        if (existingParent) {
          existingParent.quantity += quantity;
        } else {
          totalCostPrice += (parentProduct.costPrice || 0) * quantity;
          productsToCreate.push({
            productId: String(parentProduct._id),
            quantity,
            expiryDate: expiryDate || null,
            notes: item.notes || "",
            isStockManaged: parentProduct.isStockManaged !== false,
          });
        }
        continue;
      }

      totalCostPrice += (product.costPrice || 0) * quantity;

      productsToCreate.push({
        productId: id,
        quantity,
        expiryDate: expiryDate || null,
        notes: item.notes || "",
        isStockManaged: product.isStockManaged !== false,
      });
    }

    /* =========================
       CREATE STOCK MOVEMENT & UPDATE STOCK
       (Wrapped in a transaction for atomicity)
    ========================= */
    const transRef = Date.now().toString();
    const now = new Date();
    const session = await mongoose.startSession();
    let movement = null;

    try {
      await session.withTransaction(async () => {
        // 1. Create the movement record
        const [created] = await StockMovement.create(
          [
            {
              transRef,
              fromLocationId: isFromLocationVendor ? null : fromLocationId,
              vendorName: isFromLocationVendor ? sanitizePlainText(vendorName) : "",
              toLocationId: isOperationalLoss || isToLocationVendor ? null : toLocationId,
              staffId: staffId || null,
              reason,
              status: "Received",
              totalCostPrice,
              dateSent: now,
              dateReceived: now,
              barcode: transRef,
              products: productsToCreate,
              notes: sanitizeMultilineText(notes),
            },
          ],
          { session }
        );
        movement = created;

        // 2. Build qty updates for stock-managed products
        const stockManagedProducts = productsToCreate.filter(({ isStockManaged }) => isStockManaged);
        const bulkOps = stockManagedProducts.map(({ productId, quantity }) => {
          let qtyChange = 0;
          if (reason === "Restock") qtyChange = quantity;
          else if (reason === "Return") qtyChange = -quantity;
          else if (reason === "Adjustment" || reason === "Operational Loss") qtyChange = -quantity;
          // Transfer = 0 (no global change)

          return {
            updateOne: {
              filter: { _id: productId },
              update: { $inc: { quantity: qtyChange } },
            },
          };
        });

        if (bulkOps.length > 0) {
          const bulkResult = await Product.bulkWrite(bulkOps, { session });

          // 3. Verify ALL products were actually updated
          const expectedUpdates = bulkOps.length;
          const actualUpdates = (bulkResult.modifiedCount || 0) + (bulkResult.matchedCount || 0);
          if (actualUpdates < expectedUpdates) {
            const failedCount = expectedUpdates - actualUpdates;
            throw new Error(
              `Stock update verification failed: ${failedCount} of ${expectedUpdates} products were not updated. Rolling back.`
            );
          }
        }
      });
    } finally {
      await session.endSession();
    }

    // 4. Post-transaction: derive child quantities (safe to do outside transaction)
    for (const { productId } of productsToCreate.filter((p) => p.isStockManaged)) {
      try {
        await deriveChildQty(productId);
      } catch (deriveErr) {
        console.warn(`⚠️ deriveChildQty failed for ${productId}:`, deriveErr.message);
      }
    }

    // 5. Post-transaction: low stock notifications (non-critical)
    try {
      const updatedProducts = await Product.find({
        _id: { $in: productsToCreate.map((p) => p.productId) },
      }).lean();

      const lowStockItems = updatedProducts.filter(
        (p) => p.quantity < (p.minStock || 0) && p.quantity >= 0
      );

      if (lowStockItems.length > 0) {
        console.log("⚠️ Low stock alert for:", lowStockItems.map((p) => p.name).join(", "));
        fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000"}/api/notify-low-stock`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
          },
          body: JSON.stringify({ products: lowStockItems, movementId: movement._id }),
        }).catch((err) => console.warn("⚠️ Low stock email notification failed:", err.message));
      }
    } catch (notifyErr) {
      console.warn("⚠️ Low stock check failed (non-critical):", notifyErr.message);
    }

    /* =========================
       SUCCESS RESPONSE
    ========================= */
    return res.status(201).json({
      success: true,
      message: "Stock movement saved successfully",
      data: {
        movementId: movement._id,
        transRef,
        totalCostPrice,
      },
    });
  } catch (err) {
    console.error("❌ Stock movement error:", err);
    
    // Handle validation errors
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({
        message: "Validation failed",
        details: messages,
        error: process.env.NODE_ENV === "development" ? err.message : undefined,
      });
    }
    
    return res.status(500).json({
      message: "Server error",
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Internal server error",
    });
  }
}

