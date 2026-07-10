import { mongooseConnect } from "@/lib/mongodb";
import mongoose from "mongoose";
import PurchaseOrder from "@/models/PurchaseOrder";
import StockMovement from "@/models/StockMovement";
import StockOrder from "@/models/StockOrder";
import Vendor from "@/models/Vendor";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

function generateOrderRef() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${rand}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  await mongooseConnect();

  try {
    // 1. Get all existing linked IDs to avoid duplicates
    const existingStockMovementIds = await PurchaseOrder.distinct("stockMovementId");
    const existingSourceIds = await PurchaseOrder.distinct("sourceId");
    const allLinkedIds = [...existingStockMovementIds, ...existingSourceIds].map(String).filter(Boolean);

    const ordersToCreate = [];

    // 2. Sync from StockOrder collection (from expense/vendor app)
    try {
      const stockOrders = await StockOrder.find({
        _id: { $nin: allLinkedIds.filter(id => mongoose.isValidObjectId(id)).map(id => new mongoose.Types.ObjectId(id)) },
      })
        .populate("vendor", "companyName repPhone")
        .sort({ createdAt: -1 })
        .lean();

      for (const so of stockOrders) {
        const vendorId = so.vendor?._id || so.vendor;
        const vendorName = so.vendor?.companyName || so.supplier || "Unknown Vendor";

        if (!vendorId) continue;

        const products = (so.products || []).map((p) => ({
          productId: p.productId,
          name: p.name || "Product",
          quantity: p.quantity || 0,
          price: p.price || 0,
          total: p.total || (p.quantity || 0) * (p.price || 0),
        }));

        ordersToCreate.push({
          orderRef: generateOrderRef(),
          date: so.date || so.createdAt,
          vendor: vendorId,
          vendorName,
          contact: so.vendor?.repPhone || so.contact || "",
          products,
          grandTotal: so.grandTotal || products.reduce((s, p) => s + p.total, 0),
          paymentMade: so.paymentMade || 0,
          balance: so.balance || 0,
          status: so.status || "Not Paid",
          paymentDate: so.paymentDate || "",
          payBeforeSupply: so.payBeforeSupply || false,
          staffName: "",
          notes: `Synced from stock order`,
          receivedStatus: "Received",
          stockMovementId: so._id,
        });
      }
    } catch (stockOrderErr) {
      console.log("StockOrder collection not available:", stockOrderErr.message);
    }

    // 3. Also sync from StockMovement (reason=Restock)
    const restockMovements = await StockMovement.find({
      reason: "Restock",
      _id: { $nin: allLinkedIds.filter(id => mongoose.isValidObjectId(id)).map(id => new mongoose.Types.ObjectId(id)) },
    })
      .populate("products.productId", "name costPrice salePriceIncTax")
      .sort({ createdAt: -1 })
      .lean();

    // Build vendor name map for stock movements
    const movementVendorNames = [...new Set(restockMovements.map((m) => m.vendorName).filter(Boolean))];
    const vendorDocs = movementVendorNames.length > 0
      ? await Vendor.find({ companyName: { $in: movementVendorNames } }).lean()
      : [];
    const vendorMap = {};
    for (const v of vendorDocs) vendorMap[v.companyName.toLowerCase()] = v;

    for (const movement of restockMovements) {
      const vendorDoc = movement.vendorName ? vendorMap[movement.vendorName.toLowerCase()] : null;
      if (!vendorDoc) continue;

      const products = (movement.products || []).map((p) => ({
        productId: p.productId?._id || p.productId,
        name: p.productId?.name || "Product",
        quantity: p.quantity || 0,
        price: p.costPrice || p.productId?.costPrice || 0,
        total: (p.quantity || 0) * (p.costPrice || p.productId?.costPrice || 0),
      }));

      ordersToCreate.push({
        orderRef: generateOrderRef(),
        date: movement.dateSent || movement.createdAt,
        vendor: vendorDoc._id,
        vendorName: movement.vendorName,
        contact: vendorDoc.repPhone || "",
        products,
        grandTotal: products.reduce((s, p) => s + p.total, 0),
        paymentMade: 0,
        balance: products.reduce((s, p) => s + p.total, 0),
        status: "Not Paid",
        staffName: "",
        notes: `Synced from stock movement ${movement.transRef}`,
        receivedStatus: movement.status === "Received" ? "Received" : "Pending",
        stockMovementId: movement._id,
      });
    }

    if (ordersToCreate.length === 0) {
      return res.status(200).json({ success: true, synced: 0, message: "No new stock orders to sync" });
    }

    await PurchaseOrder.insertMany(ordersToCreate);

    return res.status(200).json({
      success: true,
      synced: ordersToCreate.length,
      message: `Synced ${ordersToCreate.length} stock order${ordersToCreate.length > 1 ? "s" : ""} into purchase orders`,
    });
  } catch (err) {
    console.error("Sync stock orders error:", err);
    return res.status(500).json({ error: err.message });
  }
}
