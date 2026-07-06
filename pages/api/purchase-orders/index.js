import { mongooseConnect } from "@/lib/mongodb";
import PurchaseOrder from "@/models/PurchaseOrder";
import Vendor from "@/models/Vendor";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { isValidObjectId } from "mongoose";
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

function generateOrderRef() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${rand}`;
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const { page = 1, limit = 20, vendor, status, receivedStatus } = req.query;
      const filter = {};
      if (vendor) filter.vendor = vendor;
      if (status) filter.status = status;
      if (receivedStatus) filter.receivedStatus = receivedStatus;

      const skip = (Number(page) - 1) * Number(limit);
      const [orders, total] = await Promise.all([
        PurchaseOrder.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .populate("vendor", "companyName")
          .lean(),
        PurchaseOrder.countDocuments(filter),
      ]);

      return res.status(200).json({ success: true, orders, total, totalPages: Math.ceil(total / Number(limit)) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const {
        vendor,
        date,
        contact,
        location,
        locationId,
        products,
        grandTotal,
        notes,
        payBeforeSupply,
        staffName,
        paymentMade,
        paymentDate,
        receivedStatus,
      } = req.body;

      if (!vendor || !products || products.length === 0) {
        return res.status(400).json({ error: "Vendor and products are required" });
      }

      const vendorDoc = await Vendor.findById(vendor).lean();
      if (!vendorDoc) {
        return res.status(404).json({ error: "Vendor not found" });
      }

      const grandTotalValue = Number(
        grandTotal || products.reduce((sum, product) => sum + (product.total || product.price * product.quantity || 0), 0)
      );
      const normalizedProducts = products.map((product) => {
        const quantity = Number(product.quantity) || 0;
        const price = Number(product.price) || 0;
        const total = Number(product.total) || quantity * price;
        const normalizedProduct = {
          name: sanitizePlainText(product.name),
          quantity,
          price,
          total,
        };

        if (isValidObjectId(product?.productId)) {
          normalizedProduct.productId = product.productId;
        }

        return normalizedProduct;
      });
      const paymentMadeValue = Number(paymentMade || 0);
      const receivedState = receivedStatus || "Pending";
      const payBeforeSupplyFlag = Boolean(payBeforeSupply);
      const status = derivePaymentStatus({
        paymentMade: paymentMadeValue,
        grandTotal: grandTotalValue,
        payBeforeSupply: payBeforeSupplyFlag,
        receivedStatus: receivedState,
      });

      const order = await PurchaseOrder.create({
        orderRef: generateOrderRef(),
        date: date || new Date(),
        vendor,
        vendorName: vendorDoc.companyName,
        contact: sanitizePlainText(contact || vendorDoc.repPhone || ""),
        location: sanitizePlainText(location),
        locationId: locationId || null,
        products: normalizedProducts,
        grandTotal: grandTotalValue,
        paymentMade: paymentMadeValue,
        paymentDate: paymentDate || "",
        balance: Math.max(0, grandTotalValue - paymentMadeValue),
        status,
        staff: req.user?.id || null,
        staffName: staffName || req.user?.name || "",
        notes: sanitizeMultilineText(notes),
        payBeforeSupply: payBeforeSupplyFlag,
        receivedStatus: receivedState,
      });

      return res.status(201).json({ success: true, order });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
