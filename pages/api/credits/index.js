import mongoose from "mongoose";
import Transaction from "@/models/Transactions";
import Customer from "@/models/Customer";
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { postCreditRecoveryEntry, postCreditSaleEntry } from "@/lib/accounting";

function toMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function getPaymentTotal(transaction = {}) {
  const payments = Array.isArray(transaction.creditPayments) ? transaction.creditPayments : [];
  if (payments.length > 0) {
    return toMoney(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  }
  return toMoney(transaction.creditPaidAmount || 0);
}

function getCreditBalance(transaction = {}) {
  const total = toMoney(transaction.creditOriginalTotal || transaction.total || 0);
  const paid = getPaymentTotal(transaction);
  return Math.max(0, toMoney(total - paid));
}

function getCreditStatus(balance, paid, previousStatus) {
  if (previousStatus === "written_off") return "written_off";
  if (balance <= 0) return "paid";
  if (paid > 0) return "partly_paid";
  return "open";
}

async function recalculateCustomerBalance(customerId) {
  if (!customerId || !mongoose.Types.ObjectId.isValid(String(customerId))) return null;

  const customerObjectId = new mongoose.Types.ObjectId(String(customerId));
  const openCredits = await Transaction.find({
    status: "credit",
    creditCustomerId: customerObjectId,
    creditStatus: { $nin: ["paid", "written_off"] },
  }).select("creditBalance total creditOriginalTotal creditPaidAmount creditPayments");

  const creditBalance = toMoney(
    openCredits.reduce((sum, transaction) => sum + getCreditBalance(transaction), 0)
  );

  await Customer.findByIdAndUpdate(customerObjectId, {
    creditBalance,
    isCreditCustomer: true,
    type: "CREDIT",
    updatedAt: new Date(),
  });

  return creditBalance;
}

function serializeCredit(transaction, customerById = new Map()) {
  const customerId = String(transaction.creditCustomerId || transaction.customerId || "");
  const customer = customerById.get(customerId);
  const paidAmount = getPaymentTotal(transaction);
  const balance = getCreditBalance(transaction);
  const total = toMoney(transaction.creditOriginalTotal || transaction.total || 0);

  return {
    ...transaction,
    customerId,
    customerName: transaction.creditCustomerName || transaction.customerName || customer?.name || "Walk-in credit",
    customerPhone: customer?.phone || "",
    customerEmail: customer?.email || "",
    creditOriginalTotal: total,
    creditPaidAmount: paidAmount,
    creditBalance: balance,
    creditStatus: getCreditStatus(balance, paidAmount, transaction.creditStatus),
  };
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  }

  try {
    await mongooseConnect();

    if (req.method === "GET") {
      const [creditTransactions, creditCustomers] = await Promise.all([
        Transaction.find({
          $or: [
            { status: "credit" },
            { creditStatus: { $in: ["open", "partly_paid", "paid", "written_off"] } },
          ],
        }).sort({ createdAt: -1 }).lean(),
        Customer.find({
          $or: [{ isCreditCustomer: true }, { type: "CREDIT" }],
        }).sort({ name: 1 }).lean(),
      ]);

      const customerById = new Map(creditCustomers.map((customer) => [String(customer._id), customer]));
      const credits = creditTransactions.map((transaction) => serializeCredit(transaction, customerById));
      const activeCredits = credits.filter((credit) => !["paid", "written_off"].includes(credit.creditStatus));
      const recoveredCredits = credits.filter((credit) => credit.creditStatus === "paid");

      const summary = {
        creditCustomers: creditCustomers.length,
        totalCreditIssued: toMoney(credits.reduce((sum, credit) => sum + Number(credit.creditOriginalTotal || 0), 0)),
        totalRecovered: toMoney(credits.reduce((sum, credit) => sum + Number(credit.creditPaidAmount || 0), 0)),
        outstandingBalance: toMoney(activeCredits.reduce((sum, credit) => sum + Number(credit.creditBalance || 0), 0)),
        activeCredits: activeCredits.length,
        recoveredCredits: recoveredCredits.length,
        partialCredits: credits.filter((credit) => credit.creditStatus === "partly_paid").length,
      };

      return res.status(200).json({
        success: true,
        credits,
        customers: creditCustomers,
        summary,
      });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ success: false, message: "Method not allowed" });
    }

    const action = String(req.body?.action || "").trim();

    if (action === "create-customer") {
      const { name, phone, email, address, creditLimit, creditNotes } = req.body || {};
      if (!name || !phone) {
        return res.status(400).json({ success: false, message: "Name and phone are required" });
      }

      if (email) {
        const existing = await Customer.findOne({ email });
        if (existing) {
          return res.status(409).json({ success: false, message: "Customer with this email already exists" });
        }
      }

      const customer = await Customer.create({
        name,
        phone,
        email: email || undefined,
        address: address || "",
        type: "CREDIT",
        isCreditCustomer: true,
        creditLimit: toMoney(creditLimit),
        creditBalance: 0,
        creditNotes: creditNotes || "",
      });

      return res.status(201).json({ success: true, customer });
    }

    if (action === "create-debt") {
      const { customerId, amount, dueDate, notes, reference } = req.body || {};
      const safeAmount = toMoney(amount);
      if (!customerId || !mongoose.Types.ObjectId.isValid(String(customerId)) || safeAmount <= 0) {
        return res.status(400).json({ success: false, message: "Valid customer and amount are required" });
      }

      const customer = await Customer.findById(customerId).lean();
      if (!customer) {
        return res.status(404).json({ success: false, message: "Customer not found" });
      }

      const transaction = await Transaction.create({
        items: [{ name: reference || "Opening credit balance", qty: 1, quantity: 1, salePriceIncTax: safeAmount, price: safeAmount }],
        total: safeAmount,
        subtotal: safeAmount,
        tax: 0,
        discount: 0,
        amountPaid: 0,
        change: 0,
        tenderType: "CREDIT",
        tenderPayments: [],
        staffName: req.user?.name || "Admin",
        location: "Credit Management",
        device: "Admin",
        transactionType: "pos",
        status: "credit",
        customerId: customer._id,
        customerName: customer.name,
        creditStatus: "open",
        creditCustomerId: customer._id,
        creditCustomerName: customer.name,
        creditOriginalTotal: safeAmount,
        creditPaidAmount: 0,
        creditBalance: safeAmount,
        creditDueDate: dueDate ? new Date(dueDate) : null,
        creditNotes: notes || "",
        createdAt: new Date(),
      });

      await recalculateCustomerBalance(customer._id);

      try {
        await postCreditSaleEntry(transaction);
      } catch (accountingError) {
        console.error("Accounting auto-post failed for created credit debt:", transaction._id, accountingError.message);
      }

      return res.status(201).json({ success: true, transaction });
    }

    if (action === "record-payment") {
      const { transactionId, amount, tenderType, reference, notes, paidAt } = req.body || {};
      const safeAmount = toMoney(amount);
      if (!transactionId || !mongoose.Types.ObjectId.isValid(String(transactionId)) || safeAmount <= 0) {
        return res.status(400).json({ success: false, message: "Valid transaction and payment amount are required" });
      }

      const transaction = await Transaction.findById(transactionId);
      if (!transaction) {
        return res.status(404).json({ success: false, message: "Credit transaction not found" });
      }

      const existingPayments = Array.isArray(transaction.creditPayments) ? transaction.creditPayments : [];
      const sequence = existingPayments.length + 1;
      const paymentDate = paidAt ? new Date(paidAt) : new Date();
      transaction.creditPayments.push({
        amount: safeAmount,
        tenderType: tenderType || "CASH",
        tenderName: tenderType || "CASH",
        reference: reference || "",
        notes: notes || "",
        paidAt: Number.isNaN(paymentDate.getTime()) ? new Date() : paymentDate,
        recordedBy: req.user?._id || null,
        recordedByName: req.user?.name || "Admin",
        sequence,
      });

      const paidAmount = getPaymentTotal(transaction);
      const balance = getCreditBalance(transaction);
      transaction.creditPaidAmount = paidAmount;
      transaction.creditBalance = balance;
      transaction.creditStatus = getCreditStatus(balance, paidAmount, transaction.creditStatus);
      if (transaction.creditStatus === "paid") {
        transaction.creditPaidAt = Number.isNaN(paymentDate.getTime()) ? new Date() : paymentDate;
      }

      await transaction.save();

      if (transaction.creditCustomerId) {
        const customerBalance = await recalculateCustomerBalance(transaction.creditCustomerId);
        await Customer.findByIdAndUpdate(transaction.creditCustomerId, {
          lastCreditPaymentAt: new Date(),
          creditBalance: customerBalance,
        });
      }

      try {
        await postCreditRecoveryEntry(transaction);
      } catch (accountingError) {
        console.error("Accounting auto-post failed for credit recovery:", transaction._id, accountingError.message);
      }

      return res.status(200).json({ success: true, transaction });
    }

    if (action === "write-off") {
      const { transactionId, notes } = req.body || {};
      if (!transactionId || !mongoose.Types.ObjectId.isValid(String(transactionId))) {
        return res.status(400).json({ success: false, message: "Valid transaction is required" });
      }

      const transaction = await Transaction.findByIdAndUpdate(
        transactionId,
        {
          creditStatus: "written_off",
          creditNotes: notes || "Written off",
          creditBalance: 0,
        },
        { new: true }
      );

      if (!transaction) {
        return res.status(404).json({ success: false, message: "Credit transaction not found" });
      }

      if (transaction.creditCustomerId) {
        await recalculateCustomerBalance(transaction.creditCustomerId);
      }

      return res.status(200).json({ success: true, transaction });
    }

    return res.status(400).json({ success: false, message: "Unknown credit action" });
  } catch (error) {
    console.error("Credit management API error:", error);
    return res.status(500).json({
      success: false,
      message: "Credit management request failed",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}