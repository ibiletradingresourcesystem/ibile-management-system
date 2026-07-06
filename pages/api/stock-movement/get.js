// /pages/api/stock-movement/get.js
// Optimized with pagination and lean queries

import { mongooseConnect, withRetry } from "@/lib/mongodb";
import StockMovement from "@/models/StockMovement";
import Product from "@/models/Product";
import Staff from "@/models/Staff";
import { buildLocationCache, resolveLocationName } from "@/lib/serverLocationHelper";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { formatVendorMovementLabel } from "@/lib/vendorDisplay";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    // Parse pagination params
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    // Parse filter params
    const { status, reason, fromDate, toDate, location } = req.query;

    const result = await withRetry(async () => {
      // Build query filter
      const filter = {};
      
      if (status && status !== "All Statuses") {
        filter.status = status;
      }
      
      if (reason && reason !== "* All Reasons") {
        filter.reason = reason;
      }
      
      if (fromDate || toDate) {
        filter.dateSent = {};
        if (fromDate) filter.dateSent.$gte = new Date(fromDate);
        if (toDate) filter.dateSent.$lte = new Date(toDate + "T23:59:59.999Z");
      }
      
      if (location && location !== "* All Locations") {
        filter.$or = [
          { fromLocationId: location },
          { toLocationId: location }
        ];
      }

      // Get total count for pagination (cached for 30 seconds in production)
      const total = await StockMovement.countDocuments(filter);

      // Fetch movements with optimized query
      const data = await StockMovement.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: "products.productId",
          select: "name costPrice _id" // Only fetch needed fields
        })
        .populate({
          path: "staffId",
          select: "name _id"
        })
        .lean();

      // Build location cache once
      const locationCache = await buildLocationCache();

      // Process movements efficiently
      const processedMovements = data.map(m => {
        if (!m || typeof m !== 'object') return null;

        // Calculate totalCostPrice if needed
        let totalCostPrice = m.totalCostPrice || 0;
        if (totalCostPrice === 0 && m.products?.length > 0) {
          totalCostPrice = m.products.reduce((sum, p) => {
            return sum + ((p.productId?.costPrice || 0) * (p.quantity || 0));
          }, 0);
        }

        // Resolve location names synchronously from cache
        const fromLocationName = !m.fromLocationId
          ? (m.reason === "Restock" ? formatVendorMovementLabel(m.vendorName) : "Unknown")
          : (locationCache[m.fromLocationId?.toString()] || "Unknown");
        const toLocationName = !m.toLocationId
          ? (m.reason === "Return"
              ? formatVendorMovementLabel(m.vendorName)
              : m.reason === "Operational Loss"
                ? "Loss Register"
                : "Unknown")
          : (locationCache[m.toLocationId?.toString()] || "Unknown");

        // Map products efficiently
        const mappedProducts = (m.products || []).map(p => ({
          productId: p.productId?._id?.toString() || p.productId || "Unknown",
          productName: p.productId?.name || "Unknown",
          quantity: p.quantity || 0,
          costPrice: p.productId?.costPrice || 0,
          expiryDate: p.expiryDate || null,
        }));

        return {
          _id: m._id?.toString(),
          transRef: m.transRef || "Unknown",
          fromLocationId: m.fromLocationId?.toString() || null,
          toLocationId: m.toLocationId?.toString() || null,
          vendorName: m.vendorName || "",
          fromLocation: fromLocationName,
          toLocation: toLocationName,
          sender: fromLocationName,
          receiver: toLocationName,
          reason: m.reason || "Unknown",
          staff: m.staffId || null,
          staffName: m.staffId?.name || "N/A",
          dateSent: m.dateSent || m.createdAt,
          dateReceived: m.dateReceived || m.updatedAt,
          totalCostPrice,
          status: m.status || "Received",
          barcode: m.barcode || m.transRef || "",
          notes: m.notes || "",
          productCount: mappedProducts.length,
          totalQuantity: mappedProducts.reduce((sum, p) => sum + (p.quantity || 0), 0),
          products: mappedProducts,
        };
      }).filter(Boolean);

      return {
        movements: processedMovements,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasMore: page * limit < total
        }
      };
    });

    // Return array for backwards compatibility, but include pagination header
    res.setHeader('X-Total-Count', result.pagination.total);
    res.setHeader('X-Page', result.pagination.page);
    res.setHeader('X-Total-Pages', result.pagination.totalPages);
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    
    return res.status(200).json(result.movements);
  } catch (error) {
    console.error("Fetch stock movement failed:", error);
    return res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
}

