/**
 * API: /api/stock-orders
 *
 * Orders placed with a vendor that have not been received yet. They are raised here,
 * merged here, and leave here when they are received — which is what creates the
 * purchase order the Vendor Payment Tracker pays against.
 *
 * GET  — the list, newest first. `stage=Received` shows ones already handed on.
 * POST — raise an order for a vendor.
 */
import { mongooseConnect } from "@/lib/mongodb";
import StockOrder from "@/models/StockOrder";
import Vendor from "@/models/Vendor";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { generateOrderRef, normalizeOrderProducts, sumTotals } from "@/lib/purchaseOrders";
import { sanitizeMultilineText, sanitizePlainText } from "@/lib/textSanitizers";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const { stage = "Submitted", vendor, limit = 200 } = req.query;

      const filter = {};
      if (vendor) filter.vendor = vendor;
      if (stage === "Submitted") {
        // Records seeded from the expense app have no stage; they are on order unless
        // that app marked them received.
        filter.$and = [
          { $or: [{ stage: "Submitted" }, { stage: { $exists: false } }, { stage: null }] },
          { $or: [{ reason: { $exists: false } }, { reason: { $ne: "Stock Received" } }] },
        ];
      } else if (stage === "Received") {
        filter.$or = [{ stage: "Received" }, { reason: "Stock Received" }];
      }

      const orders = await StockOrder.find(filter)
        .sort({ createdAt: -1 })
        .limit(Math.min(500, Math.max(1, Number(limit) || 200)))
        .populate("vendor", "companyName repPhone")
        .lean();

      return res.status(200).json({ success: true, orders, total: orders.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { vendor, date, contact, location, locationId, products, grandTotal, notes, mainProduct } = req.body || {};

      if (!vendor || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: "Vendor and products are required" });
      }

      const vendorDoc = await Vendor.findById(vendor).lean();
      if (!vendorDoc) return res.status(404).json({ error: "Vendor not found" });

      const normalizedProducts = normalizeOrderProducts(products);
      if (normalizedProducts.length === 0) {
        return res.status(400).json({ error: "Every product line needs a name" });
      }

      const order = await StockOrder.create({
        orderRef: generateOrderRef("SO"),
        date: date || new Date(),
        vendor,
        supplier: vendorDoc.companyName,
        contact: sanitizePlainText(contact || vendorDoc.repPhone || ""),
        location: sanitizePlainText(location || ""),
        locationId: locationId || null,
        mainProduct: sanitizePlainText(mainProduct || vendorDoc.mainProduct || ""),
        products: normalizedProducts,
        grandTotal: Number(grandTotal) || sumTotals(normalizedProducts),
        staff: req.user?.id || null,
        staffName: req.user?.name || "",
        notes: sanitizeMultilineText(notes || ""),
        stage: "Submitted",
      });

      return res.status(201).json({ success: true, order });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
