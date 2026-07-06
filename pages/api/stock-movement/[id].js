import { mongooseConnect } from "@/lib/mongodb";
import StockMovement from "@/models/StockMovement";
import Product from "@/models/Product";
import mongoose from "mongoose";
import { buildLocationCache, resolveLocationName } from "@/lib/serverLocationHelper";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { formatVendorMovementLabel } from "@/lib/vendorDisplay";

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

  return res.status(405).json({ message: "Method not allowed" });
}
