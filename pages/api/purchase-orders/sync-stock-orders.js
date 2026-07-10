import { mongooseConnect } from "@/lib/mongodb";
import PurchaseOrder from "@/models/PurchaseOrder";
import StockMovement from "@/models/StockMovement";
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
    // Find restock stock movements that don't already have a linked purchase order
    const existingLinkedIds = await PurchaseOrder.distinct("stockMovementId");
    const restockMovements = await StockMovement.find({
      reason: "Restock",
      _id: { $nin: existingLinkedIds },
    })
      .populate("products.productId", "name costPrice salePriceIncTax")
      .sort({ createdAt: -1 })
      .lean();

    if (restockMovements.length === 0) {
      return res.status(200).json({ success: true, synced: 0, message: "No new stock orders to sync" });
    }

    // Build a map of vendor names to vendor docs
    const vendorNames = [...new Set(restockMovements.map((m) => m.vendorName).filter(Boolean))];
    const vendors = await Vendor.find({
      companyName: { $in: vendorNames },
    }).lean();
    const vendorMap = {};
    for (const v of vendors) {
      vendorMap[v.companyName.toLowerCase()] = v;
    }

    const ordersToCreate = [];

    for (const movement of restockMovements) {
      const vendorDoc = movement.vendorName
        ? vendorMap[movement.vendorName.toLowerCase()]
        : null;

      const products = (movement.products || []).map((p) => ({
        productId: p.productId?._id || p.productId,
        name: p.productId?.name || "Product",
        quantity: p.quantity || 0,
        price: p.costPrice || p.productId?.costPrice || 0,
        total: (p.quantity || 0) * (p.costPrice || p.productId?.costPrice || 0),
      }));

      const grandTotal = products.reduce((s, p) => s + p.total, 0);

      ordersToCreate.push({
        orderRef: generateOrderRef(),
        date: movement.dateSent || movement.createdAt,
        vendor: vendorDoc?._id || null,
        vendorName: movement.vendorName || "Unknown Vendor",
        contact: vendorDoc?.repPhone || "",
        products,
        grandTotal,
        paymentMade: 0,
        balance: grandTotal,
        status: "Not Paid",
        staffName: "",
        notes: `Synced from stock order ${movement.transRef}`,
        receivedStatus: movement.status === "Received" ? "Received" : "Pending",
        stockMovementId: movement._id,
      });
    }

    // Filter out orders without a vendor ID (can't create without vendor ref)
    const validOrders = ordersToCreate.filter((o) => o.vendor);
    const skipped = ordersToCreate.length - validOrders.length;

    if (validOrders.length > 0) {
      await PurchaseOrder.insertMany(validOrders);
    }

    return res.status(200).json({
      success: true,
      synced: validOrders.length,
      skipped,
      message: `Synced ${validOrders.length} stock orders into purchase orders${skipped > 0 ? ` (${skipped} skipped — no matching vendor)` : ""}`,
    });
  } catch (err) {
    console.error("Sync stock orders error:", err);
    return res.status(500).json({ error: err.message });
  }
}
