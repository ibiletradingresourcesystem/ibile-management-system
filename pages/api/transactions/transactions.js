import Transaction from "@/models/Transactions";
import "@/models/Staff";
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import {
  normalizeItems,
  normalizeTenderPayments,
  applyInventoryDelta,
  toSafeNumber,
} from "@/lib/transaction-utils";
import { aggregateProductSales } from "@/lib/product-sales-report";
import { postCreditRecoveryEntry, postCreditSaleEntry, postSaleEntry } from "@/lib/accounting";

async function connectDB() {
  await mongooseConnect();
}

function isOnlineTransaction(tx = {}) {
  const location = String(tx.location || "").toLowerCase();
  const tenderType = String(tx.tenderType || "").toLowerCase();
  const device = String(tx.device || "").toLowerCase();

  return location === "online" || tenderType === "online" || device === "web";
}

function getNormalizedStaffName(tx = {}) {
  const rawName = tx.staff?.name || tx.staffName || tx.staff || "";
  const normalizedRawName = String(rawName).trim();

  if (normalizedRawName) {
    return normalizedRawName.toLowerCase() === "online"
      ? "Online"
      : normalizedRawName;
  }

  return isOnlineTransaction(tx) ? "Online" : "Unknown";
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (req.method === "POST") {
    if (!isStaff(req)) {
      return res
        .status(403)
        .json({ success: false, message: "Insufficient permissions" });
    }
    return handlePOST(req, res);
  }

  if (req.method === "GET") {
    return handleGET(req, res);
  }

  return res.status(405).json({ message: "Method not allowed" });
}

async function handlePOST(req, res) {
  try {
    await connectDB();

    const {
      items,
      total,
      staffId,
      staffName,
      location,
      device,
      tenders,
      tenderPayments: requestTenderPayments,
      tenderType,
      discount,
      tax,
      subtotal,
      amountPaid,
      change,
      status: requestStatus,
      externalId: requestExternalId,
      dedupeKey: requestDedupeKey,
      customerId,
      customerName,
      customerType,
      creditDueDate,
      creditNotes,
      createdAt,
    } = req.body || {};

    const normalizedItems = normalizeItems(items);
    if (!normalizedItems.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction: at least one item is required",
      });
    }

    const normalizedTenderPayments = normalizeTenderPayments(
      requestTenderPayments || tenders
    );
    const tenderPaymentsTotal = normalizedTenderPayments.reduce(
      (sum, payment) => sum + (payment.amount || 0),
      0
    );

    const safeTotal = toSafeNumber(total, 0);
    const safeSubtotal = toSafeNumber(subtotal, safeTotal);
    const safeTax = toSafeNumber(tax, 0);
    const safeDiscount = toSafeNumber(discount, 0);
    const requestedStatus = String(requestStatus || "").trim().toLowerCase();
    const status = ["held", "completed", "refunded", "credit"].includes(requestedStatus)
      ? requestedStatus
      : "completed";
    const isCreditTransaction = status === "credit";
    const safeAmountPaid = isCreditTransaction
      ? toSafeNumber(amountPaid, 0)
      : toSafeNumber(amountPaid, tenderPaymentsTotal > 0 ? tenderPaymentsTotal : safeTotal);
    const safeChange = isCreditTransaction
      ? 0
      : toSafeNumber(change, Math.max(safeAmountPaid - safeTotal, 0));
    const creditBalance = isCreditTransaction ? Math.max(0, safeTotal - safeAmountPaid) : 0;
    const creditStatus = !isCreditTransaction
      ? "none"
      : creditBalance <= 0
        ? "paid"
        : safeAmountPaid > 0
          ? "partly_paid"
          : "open";

    const primaryTender =
      tenderType ||
      normalizedTenderPayments[0]?.tenderName ||
      normalizedTenderPayments[0]?.tenderType ||
      (isCreditTransaction ? "CREDIT" : "CASH");

    const parsedCreatedAt = createdAt ? new Date(createdAt) : new Date();
    const safeCreatedAt = Number.isNaN(parsedCreatedAt.getTime())
      ? new Date()
      : parsedCreatedAt;

    const safeStaffId =
      typeof staffId === "string" && /^[a-fA-F0-9]{24}$/.test(staffId)
        ? staffId
        : null;

    const normalizedLocation = String(
      location || req.user?.location || "Default Location"
    ).trim();
    const normalizedStaffName = getNormalizedStaffName({
      staffName: staffName || req.user?.name,
      location: normalizedLocation,
      tenderType: primaryTender,
      device,
    });

    const externalId = requestExternalId
      ? String(requestExternalId).trim()
      : null;
    const dedupeKey = requestDedupeKey
      ? String(requestDedupeKey).trim()
      : externalId;

    const transactionPayload = {
      items: normalizedItems,
      total: safeTotal,
      subtotal: safeSubtotal,
      tax: safeTax,
      discount: safeDiscount,
      amountPaid: safeAmountPaid,
      change: safeChange,
      tenderType: primaryTender,
      tenderPayments: normalizedTenderPayments,
      staff: safeStaffId,
      staffName: normalizedStaffName,
      location: normalizedLocation,
      device: device || "POS",
      tableName: null,
      transactionType: "pos",
      status,
      discountReason: "",
      customerId: customerId || null,
      customerName: customerName || null,
      customerType: customerType || null,
      creditStatus,
      creditCustomerId: customerId || null,
      creditCustomerName: customerName || "",
      creditOriginalTotal: isCreditTransaction ? safeTotal : 0,
      creditPaidAmount: isCreditTransaction ? safeAmountPaid : 0,
      creditBalance,
      creditDueDate: creditDueDate ? new Date(creditDueDate) : null,
      creditPaidAt: isCreditTransaction && creditBalance <= 0 ? safeCreatedAt : null,
      creditNotes: creditNotes || "",
      createdAt: safeCreatedAt,
      externalId: externalId || undefined,
      dedupeKey: dedupeKey || undefined,
    };

    let transaction;
    try {
      transaction = await Transaction.create(transactionPayload);
    } catch (error) {
      const isDuplicateInsert =
        error?.code === 11000 &&
        (error?.keyPattern?.externalId || error?.keyPattern?.dedupeKey);

      if (!isDuplicateInsert) throw error;

      const existing = await Transaction.findOne({
        $or: [
          externalId ? { externalId } : null,
          dedupeKey ? { dedupeKey } : null,
        ].filter(Boolean),
      }).lean();

      return res.status(200).json({
        success: true,
        duplicate: true,
        message: "Transaction already synced",
        transaction: existing || null,
      });
    }

    if (status === "completed" || status === "credit") {
      await applyInventoryDelta(normalizedItems, "decrement");
      transaction.inventoryUpdated = true;
      await transaction.save();

      if (status === "credit" && transaction.creditCustomerId) {
        const openCredits = await Transaction.find({
          status: "credit",
          creditCustomerId: transaction.creditCustomerId,
          creditStatus: { $nin: ["paid", "written_off"] },
        }).select("creditBalance total creditOriginalTotal creditPaidAmount creditPayments");
        const creditBalance = openCredits.reduce((sum, credit) => {
          const totalCredit = Number(credit.creditOriginalTotal || credit.total || 0);
          const paid = Array.isArray(credit.creditPayments) && credit.creditPayments.length > 0
            ? credit.creditPayments.reduce((paymentSum, payment) => paymentSum + Number(payment.amount || 0), 0)
            : Number(credit.creditPaidAmount || 0);
          return sum + Math.max(0, totalCredit - paid);
        }, 0);
        const Customer = (await import("@/models/Customer")).default;
        await Customer.findByIdAndUpdate(transaction.creditCustomerId, {
          isCreditCustomer: true,
          type: "CREDIT",
          creditBalance,
          updatedAt: new Date(),
        });
      }

      if (status === "credit") {
        try {
          await postCreditSaleEntry(transaction);
          if (Number(transaction.creditPaidAmount || 0) > 0) {
            await postCreditRecoveryEntry(transaction);
          }
        } catch (acctErr) {
          console.error("Accounting auto-post failed for credit transaction:", transaction._id, acctErr.message);
        }

        return res.status(201).json({
          success: true,
          message: "Credit transaction saved",
          transaction,
        });
      }

      // Auto-post accounting journal entry
      try {
        await postSaleEntry(transaction);
      } catch (acctErr) {
        console.error("Accounting auto-post failed for transaction:", transaction._id, acctErr.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: "Transaction saved",
      transaction,
    });
  } catch (err) {
    console.error("Transaction POST API error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to save transaction",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}

async function handleGET(req, res) {
  try {
    await connectDB();

    const hasPaginationParams =
      typeof req.query.page !== "undefined" ||
      typeof req.query.limit !== "undefined";

    const requestedPage = Math.max(1, Number(req.query.page) || 1);
    const requestedLimit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const skip = (requestedPage - 1) * requestedLimit;

    let transactions = [];
    let totalRecords = 0;

    if (hasPaginationParams) {
      totalRecords = await Transaction.countDocuments({});
      transactions = await Transaction.find()
        .populate("staff", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(requestedLimit)
        .lean();
    } else {
      transactions = await Transaction.find()
        .populate("staff", "name")
        .sort({ createdAt: -1 })
        .lean();
      totalRecords = transactions.length;
    }

    const enrichedTransactions = transactions.map((tx) => ({
      ...tx,
      location: tx.location || (isOnlineTransaction(tx) ? "online" : "Unknown"),
      staffName: getNormalizedStaffName(tx),
      staff: tx.staff?.name
        ? tx.staff
        : isOnlineTransaction(tx)
          ? { name: "Online" }
          : tx.staff,
    }));

    const paidTransactions = enrichedTransactions.filter((tx) => tx.status === "completed");

    const totalSales = paidTransactions.reduce(
      (sum, tx) => sum + (tx.total || 0),
      0
    );

    const totalTransactions = paidTransactions.length;

    const summary = {
      totalSales,
      totalTransactions,
      averageTransactionValue:
        totalTransactions > 0 ? totalSales / totalTransactions : 0,
    };

    const topProducts = aggregateProductSales(paidTransactions)
      .map((product) => ({
        productId: product.productId,
        name: product.name,
        qty: product.unitsSold,
        total: product.totalSales,
      }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    const byStaff = {};
    paidTransactions.forEach((tx) => {
      const staff = getNormalizedStaffName(tx);
      byStaff[staff] = (byStaff[staff] || 0) + (tx.total || 0);
    });

    const byLocation = {};
    paidTransactions.forEach((tx) => {
      const loc = tx.location || "Unknown";
      byLocation[loc] = (byLocation[loc] || 0) + (tx.total || 0);
    });

    const pagination = {
      enabled: hasPaginationParams,
      page: requestedPage,
      limit: requestedLimit,
      totalRecords,
      totalPages: requestedLimit > 0 ? Math.ceil(totalRecords / requestedLimit) : 1,
      hasMore: hasPaginationParams ? skip + enrichedTransactions.length < totalRecords : false,
      loadedRecords: hasPaginationParams ? Math.min(skip + enrichedTransactions.length, totalRecords) : enrichedTransactions.length,
    };

    return res.status(200).json({
      success: true,
      transactions: enrichedTransactions,
      summary,
      topProducts,
      pagination,
      byStaff: Object.entries(byStaff).map(([staff, total]) => ({
        staff,
        total,
      })),
      byLocation: Object.entries(byLocation).map(([locationName, total]) => ({
        location: locationName,
        total,
      })),
    });
  } catch (err) {
    console.error("Transaction GET API error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}
