import { mongooseConnect } from "@/lib/mongoose";
import { authMiddleware } from "@/lib/auth-middleware";
import {
  buildApprovalHistoryEntry,
  buildStaffSnapshot,
} from "@/lib/petty-cash-transactions";
import PettyCashTransaction from "@/models/PettyCashTransaction";
import Vendor from "@/models/Vendor";

function parseDate(value, fallback = null) {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeOrderValues({ quantity, unitPrice, amount }) {
  const parsedQuantity = Number(quantity);
  const parsedUnitPrice = Number(unitPrice);
  const parsedAmount = Number(amount);

  const normalizedQuantity =
    Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1;
  const normalizedUnitPrice =
    Number.isFinite(parsedUnitPrice) && parsedUnitPrice >= 0
      ? parsedUnitPrice
      : Number.isFinite(parsedAmount) && parsedAmount > 0
        ? parsedAmount / normalizedQuantity
        : 0;
  const normalizedAmount =
    Number.isFinite(parsedAmount) && parsedAmount > 0
      ? parsedAmount
      : normalizedQuantity * normalizedUnitPrice;

  return {
    quantity: normalizedQuantity,
    unitPrice: normalizedUnitPrice,
    amount: normalizedAmount,
  };
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return;

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const { vendorId, status, location } = req.query;
      const filter = {};

      if (vendorId) filter.vendor = vendorId;
      if (status) filter.status = status;
      if (location) filter.location = location;

      const transactions = await PettyCashTransaction.find(filter)
        .populate("vendor")
        .populate("expense")
        .sort({ createdAt: -1 });

      return res.status(200).json({ success: true, transactions });
    } catch (error) {
      console.error("Petty cash transaction fetch error:", error);
      return res
        .status(500)
        .json({ error: "Failed to fetch petty cash transactions" });
    }
  }

  if (req.method === "POST") {
    try {
      const {
        vendor: vendorId,
        purpose,
        description,
        amount,
        quantity,
        unitPrice,
        location,
        requestDate,
        neededBy,
      } = req.body || {};

      const normalizedOrder = normalizeOrderValues({
        quantity,
        unitPrice,
        amount,
      });

      if (
        !vendorId ||
        !purpose ||
        !location ||
        !requestDate ||
        normalizedOrder.quantity <= 0 ||
        normalizedOrder.amount <= 0
      ) {
        return res.status(400).json({
          error:
            "Vendor, order purpose, quantity, unit price, location, and order date are required.",
        });
      }

      const vendor = await Vendor.findById(vendorId);
      if (!vendor || vendor.vendorType !== "petty-cash") {
        return res
          .status(400)
          .json({ error: "Petty cash vendor not found." });
      }

      const staffSnapshot = {
        _id: req.user._id || req.user.id,
        name: req.user.name || "",
        role: req.user.role || "",
        email: req.user.email || "",
      };

      const transaction = await PettyCashTransaction.create({
        vendor: vendor._id,
        vendorName: vendor.companyName,
        purpose: String(purpose).trim(),
        description:
          typeof description === "string" ? description.trim() : "",
        quantity: normalizedOrder.quantity,
        unitPrice: normalizedOrder.unitPrice,
        amount: normalizedOrder.amount,
        location: String(location).trim(),
        requestDate: parseDate(requestDate, new Date()),
        neededBy: parseDate(neededBy, null),
        status: "Ordered",
        requestedBy: staffSnapshot,
        approvalHistory: [
          buildApprovalHistoryEntry({
            action: "ordered",
            toStatus: "Ordered",
            note:
              typeof description === "string" ? description : "",
            staff: staffSnapshot,
            amount: normalizedOrder.amount,
          }),
        ],
      });

      await transaction.populate("vendor");

      return res.status(201).json({ success: true, transaction });
    } catch (error) {
      console.error("Petty cash transaction create error:", error);
      return res.status(500).json({
        success: false,
        error:
          error.message || "Failed to create petty cash transaction",
      });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
