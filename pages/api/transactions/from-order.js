import { mongooseConnect } from "@/lib/mongodb";
import Order from "@/models/Order";
import Transaction from "@/models/Transactions";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import mongoose from "mongoose";

const ONLINE_TENDER_NAME = "ONLINE";
const MANUAL_ENTRY_TENDER_NAME = "MANUAL ENTRY";
const ONLINE_PAYMENT_CHANNELS = new Set(["paystack", "paystack-webhook", "online"]);
const ONLINE_SALES_CHANNEL = "ONLINE_STORE";
const ONLINE_SOURCE_ORDER_TYPE = "ORDER";
const ONLINE_SOURCE_SITE_KEY = "webpage-app";

const normalizePaymentChannel = (value) => String(value || "").trim().toLowerCase();

const getActorStaffId = (req) => {
  const candidate = String(req?.user?.id || "").trim();
  return mongoose.Types.ObjectId.isValid(candidate) ? candidate : null;
};

const getActorStaffName = (req) =>
  String(req?.user?.name || req?.user?.email || "").trim() || "Online";

const buildOnlineSourceMetadata = (order) => ({
  salesChannel: ONLINE_SALES_CHANNEL,
  sourceOrderId: String(order?._id || ""),
  sourceOrderType: ONLINE_SOURCE_ORDER_TYPE,
  sourceSiteKey: ONLINE_SOURCE_SITE_KEY,
});

const getOrderTenderName = (order) => {
  const hasRecordedOnlinePayment =
    ONLINE_PAYMENT_CHANNELS.has(normalizePaymentChannel(order?.paymentChannel)) &&
    Boolean(order?.paid || order?.paymentStatus === "Paid" || order?.paymentReference);

  return hasRecordedOnlinePayment ? ONLINE_TENDER_NAME : MANUAL_ENTRY_TENDER_NAME;
};

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  await mongooseConnect();

  const { orderId } = req.body || {};
  if (!orderId) {
    return res.status(400).json({ error: "Missing orderId" });
  }

  try {
    const order = await Order.findById(orderId).lean();
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const externalId = `order:${order._id.toString()}`;
    const existing = await Transaction.findOne({ externalId }).lean();
    if (existing) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        message: "Transaction already exists for order",
        transaction: existing,
      });
    }

    const orderItems = Array.isArray(order.items) && order.items.length
      ? order.items
      : order.cartProducts || [];

    const items = orderItems.map((product) => ({
      productId: product.productId || null,
      name: product.name,
      salePriceIncTax: Number(product.price || 0),
      price: Number(product.price || 0),
      qty: Number(product.quantity || 0),
      quantity: Number(product.quantity || 0),
    }));

    const recordedTenderName = getOrderTenderName(order);
    const actorStaffId = getActorStaffId(req);
    const actorStaffName = getActorStaffName(req);
    const sourceMetadata = buildOnlineSourceMetadata(order);

    const transaction = await Transaction.create({
      tenderType: recordedTenderName,
      tenderPayments: [{
        tenderType: recordedTenderName,
        tenderName: recordedTenderName,
        amount: Number(order.total || 0),
      }],
      amountPaid: Number(order.total || 0),
      total: Number(order.total || 0),
      subtotal: Number(order.subtotal || order.total || 0),
      tax: 0,
      staff: actorStaffId,
      staffName: actorStaffName,
      location: order.locationName || "online",
      device: "WEB",
      tableName: "OrderCheckout",
      discount: 0,
      discountReason: "",
      customerName: order.shippingDetails?.name || "Online Customer",
      transactionType: "pos",
      status: "completed",
      change: 0,
      items,
      externalId,
      dedupeKey: externalId,
      ...sourceMetadata,
    });

    return res
      .status(201)
      .json({ success: true, message: "Transaction created", transaction });
  } catch (error) {
    console.error("Transaction creation failed:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
