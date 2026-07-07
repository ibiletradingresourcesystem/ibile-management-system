import { mongooseConnect } from "@/lib/mongoose";
import { authMiddleware } from "@/lib/auth-middleware";
import {
  buildApprovalHistoryEntry,
  buildStaffSnapshot,
  syncPettyCashExpense,
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
  const { id } = req.query;

  if (req.method === "DELETE") {
    try {
      const transaction = await PettyCashTransaction.findById(id);
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found." });
      }
      if (transaction.status === "Paid") {
        return res
          .status(400)
          .json({ error: "Cannot delete a paid transaction." });
      }
      await PettyCashTransaction.findByIdAndDelete(id);
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Petty cash delete error:", error);
      return res.status(500).json({ error: "Failed to delete transaction" });
    }
  }

  if (req.method !== "PUT") {
    res.setHeader("Allow", ["PUT", "DELETE"]);
    return res
      .status(405)
      .json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const transaction = await PettyCashTransaction.findById(id);
    if (!transaction) {
      return res
        .status(404)
        .json({ error: "Petty cash transaction not found." });
    }

    const {
      action,
      note = "",
      paymentMethod = "",
      paymentReference = "",
      paidAt,
      vendor: vendorId,
      purpose,
      description,
      quantity,
      unitPrice,
      amount,
      location,
      requestDate,
      neededBy,
    } = req.body || {};

    const fromStatus = transaction.status;
    const previousLocation = transaction.location;

    const staffSnapshot = {
      _id: req.user._id || req.user.id,
      name: req.user.name || "",
      role: req.user.role || "",
      email: req.user.email || "",
    };

    if (!action) {
      return res.status(400).json({ error: "Action is required." });
    }

    if (action === "update-details") {
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
            "Vendor, purpose, quantity, unit price, location, and date are required.",
        });
      }

      const vendor = await Vendor.findById(vendorId);
      if (!vendor || vendor.vendorType !== "petty-cash") {
        return res
          .status(400)
          .json({ error: "Petty cash vendor not found." });
      }

      const nextRequestDate = parseDate(
        requestDate,
        transaction.requestDate
      );
      const nextNeededBy = parseDate(neededBy, null);
      const nextDescription =
        typeof description === "string" ? description.trim() : "";
      const nextPurpose = String(purpose).trim();
      const nextLocation = String(location).trim();
      const changedFields = [];

      if (String(transaction.vendor) !== String(vendor._id))
        changedFields.push("vendor");
      if (transaction.purpose !== nextPurpose)
        changedFields.push("purpose");
      if ((transaction.description || "") !== nextDescription)
        changedFields.push("note");
      if (Number(transaction.quantity || 1) !== normalizedOrder.quantity)
        changedFields.push("quantity");
      if (Number(transaction.unitPrice || 0) !== normalizedOrder.unitPrice)
        changedFields.push("unit price");
      if (Number(transaction.amount || 0) !== normalizedOrder.amount)
        changedFields.push("total amount");
      if (transaction.location !== nextLocation)
        changedFields.push("location");

      transaction.vendor = vendor._id;
      transaction.vendorName = vendor.companyName;
      transaction.purpose = nextPurpose;
      transaction.description = nextDescription;
      transaction.quantity = normalizedOrder.quantity;
      transaction.unitPrice = normalizedOrder.unitPrice;
      transaction.amount = normalizedOrder.amount;
      transaction.location = nextLocation;
      transaction.requestDate = nextRequestDate;
      transaction.neededBy = nextNeededBy;

      const updateNote = changedFields.length
        ? `Updated ${changedFields.join(", ")}`
        : "Order details reviewed with no value changes.";

      transaction.approvalHistory.push(
        buildApprovalHistoryEntry({
          action,
          fromStatus,
          toStatus: transaction.status,
          note:
            typeof note === "string" && note.trim() ? note : updateNote,
          staff: staffSnapshot,
          amount: transaction.amount,
          paymentMethod: transaction.paymentMethod,
          paymentReference: transaction.paymentReference,
        })
      );
    } else if (action === "mark-paid") {
      if (
        transaction.status === "Cancelled" ||
        transaction.status === "Rejected"
      ) {
        return res.status(400).json({
          error: "Cancelled orders cannot be marked as paid.",
        });
      }

      transaction.status = "Paid";
      transaction.paidAt = parseDate(paidAt, new Date()) || new Date();
      transaction.paidBy = staffSnapshot;
      transaction.paymentMethod =
        paymentMethod || transaction.paymentMethod || "transfer";
      transaction.paymentReference =
        paymentReference || transaction.paymentReference || "";
    } else if (action === "cancel") {
      if (transaction.status === "Paid") {
        return res.status(400).json({
          error: "Paid orders cannot be cancelled directly.",
        });
      }
      transaction.status = "Cancelled";
    } else if (action === "reopen") {
      transaction.status = "Ordered";
      transaction.paidAt = null;
      transaction.paidBy = null;
      transaction.paymentMethod = "";
      transaction.paymentReference = "";
    } else {
      return res.status(400).json({ error: "Unsupported action." });
    }

    if (action !== "update-details") {
      transaction.approvalHistory.push(
        buildApprovalHistoryEntry({
          action,
          fromStatus,
          toStatus: transaction.status,
          note,
          staff: staffSnapshot,
          amount: transaction.amount,
          paymentMethod: transaction.paymentMethod,
          paymentReference: transaction.paymentReference,
        })
      );
    }

    const expenseId = await syncPettyCashExpense(transaction);
    transaction.expense = expenseId;
    await transaction.save();

    await transaction.populate("vendor");
    await transaction.populate("expense");

    return res.status(200).json({ success: true, transaction });
  } catch (error) {
    console.error("Petty cash transaction update error:", error);
    return res.status(500).json({
      success: false,
      error:
        error.message || "Failed to update petty cash transaction",
    });
  }
}
