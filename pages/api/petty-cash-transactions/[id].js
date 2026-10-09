import { mongooseConnect } from "@/lib/mongoose";
import { authMiddleware, isManager } from "@/lib/auth-middleware";
import {
  SETTLED_PETTY_CASH_STATUSES,
  buildApprovalHistoryEntry,
  deletePettyCashTransaction,
  pettyCashUndoPlan,
  syncPettyCashExpense,
  updateInventoryFromPettyCashReceive,
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

  // What deleting the order would undo, shown before anyone confirms it
  if (req.method === "GET" && req.query.undo) {
    if (!isManager(req)) {
      return res.status(403).json({ error: "Only a manager or admin can delete petty cash orders." });
    }
    try {
      const transaction = await PettyCashTransaction.findById(id).lean();
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found." });
      }
      return res.status(200).json({ success: true, ...(await pettyCashUndoPlan(transaction)) });
    } catch (error) {
      console.error("Petty cash undo plan error:", error);
      return res.status(500).json({ error: "Could not work out what deleting would undo." });
    }
  }

  if (req.method === "DELETE") {
    // Deleting undoes the order, its stock and its expense: a manager's or an admin's call
    if (!isManager(req)) {
      return res.status(403).json({ error: "Only a manager or admin can delete petty cash orders." });
    }
    try {
      const transaction = await PettyCashTransaction.findById(id);
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found." });
      }
      const result = await deletePettyCashTransaction(transaction);
      return res.status(200).json({ success: true, ...result });
    } catch (error) {
      console.error("Petty cash delete error:", error);
      return res.status(500).json({ error: "Failed to delete transaction" });
    }
  }

  if (req.method !== "PUT") {
    res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
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

      // Can be marked paid from Ordered, Received, or Approved status
      const fromStatusBeforePaid = transaction.status;
      transaction.status = "Paid";
      transaction.paidAt = parseDate(paidAt, new Date()) || new Date();
      transaction.paidBy = staffSnapshot;
      transaction.paymentMethod =
        paymentMethod || transaction.paymentMethod || "transfer";
      transaction.paymentReference =
        paymentReference || transaction.paymentReference || "";
    } else if (action === "mark-received") {
      // Mark the order as received — items delivered but not yet paid
      if (transaction.status === "Cancelled" || transaction.status === "Rejected") {
        return res.status(400).json({ error: "Cannot receive a cancelled order." });
      }
      // A second receipt would add the stock again
      if (transaction.receivedAt) {
        return res.status(400).json({ error: "This order has already been received." });
      }

      transaction.status = "Received";
      transaction.receivedAt = new Date();
      transaction.receivedBy = staffSnapshot;

      // Update inventory: add products to stock
      try {
        await updateInventoryFromPettyCashReceive(transaction);
      } catch (error) {
        console.error("Failed to update inventory:", error);
        return res.status(500).json({
          error: "Items received but failed to update inventory: " + error.message,
        });
      }
    } else if (action === "cancel") {
      // The page has always offered Cancel; it was answered "Unsupported action"
      if (SETTLED_PETTY_CASH_STATUSES.includes(transaction.status)) {
        return res.status(400).json({
          error: `A ${transaction.status.toLowerCase()} order cannot be cancelled. A manager can delete it instead.`,
        });
      }
      if (transaction.status === "Cancelled") {
        return res.status(400).json({ error: "This order is already cancelled." });
      }
      transaction.status = "Cancelled";
    } else if (action === "reopen") {
      if (transaction.status !== "Cancelled" && transaction.status !== "Rejected") {
        return res.status(400).json({ error: "Only a cancelled or rejected order can be reopened." });
      }
      transaction.status = "Ordered";
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
