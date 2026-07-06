import { mongooseConnect } from "@/lib/mongodb";
import EndOfDayReport from "@/models/EndOfDayReport";
import Transaction from "@/models/Transactions";
import Store from "@/models/Store";
import Till from "@/models/Till";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    const {
      action,
      storeId,
      locationId,
      staffId,
      staffName,
      openingBalance,
      physicalCount,
      closingNotes,
      closedBy,
      device,
    } = req.body || {};

    if (!action || !storeId || !locationId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: action, storeId, locationId",
      });
    }

    if (action === "create") {
      if (!staffId || !staffName) {
        return res.status(400).json({
          success: false,
          message: "Staff ID and name required for opening till",
        });
      }

      if (openingBalance === undefined || openingBalance === null) {
        return res.status(400).json({
          success: false,
          message: "Opening balance required",
        });
      }

      const existingOpen = await EndOfDayReport.findOne({
        storeId,
        locationId,
        closedAt: null,
      });

      if (existingOpen) {
        return res.status(409).json({
          success: false,
          message: "An open till already exists for this location",
          reportId: existingOpen._id,
        });
      }

      const now = new Date();
      const till = await Till.create({
        storeId,
        locationId,
        staffId,
        staffName,
        status: "OPEN",
        openingBalance: safeNumber(openingBalance, 0),
        openedAt: now,
        device: device || "POS Terminal",
      });

      const newReport = await EndOfDayReport.create({
        storeId,
        locationId,
        tillId: till._id,
        staffId,
        staffName,
        openingBalance: safeNumber(openingBalance, 0),
        openedAt: now,
        closedAt: null,
        tenderBreakdown: new Map(),
        date: startOfToday(),
      });

      return res.status(201).json({
        success: true,
        message: "Till opened successfully",
        report: newReport,
        till,
      });
    }

    if (action === "close") {
      if (physicalCount === undefined || physicalCount === null) {
        return res.status(400).json({
          success: false,
          message: "Physical count required for closing till",
        });
      }

      const openReport = await EndOfDayReport.findOne({
        storeId,
        locationId,
        closedAt: null,
      }).sort({ openedAt: -1 });

      if (!openReport) {
        return res.status(404).json({
          success: false,
          message: "No open till found for this location",
        });
      }

      const store = await Store.findById(storeId).select("locations").lean();
      let locationName = null;
      if (store && Array.isArray(store.locations)) {
        const location = store.locations.find(
          (loc) => loc._id.toString() === locationId.toString()
        );
        locationName = location?.name;
      }

      const now = new Date();
      const locationFilters = [{ location: locationId }];
      if (locationName) {
        locationFilters.unshift({ location: locationName });
      }
      const txQuery = {
        createdAt: { $gte: openReport.openedAt, $lte: now },
        status: "completed",
        $or: locationFilters,
      };

      const transactions = await Transaction.find(txQuery).lean();

      const totalSales = transactions.reduce((sum, tx) => sum + (tx.total || 0), 0);
      const transactionCount = transactions.length;

      const tenderBreakdown = new Map();
      for (const tx of transactions) {
        if (Array.isArray(tx.tenderPayments) && tx.tenderPayments.length > 0) {
          for (const payment of tx.tenderPayments) {
            const tender =
              payment?.tenderName || payment?.tenderType || tx.tenderType || "CASH";
            const current = tenderBreakdown.get(tender) || 0;
            tenderBreakdown.set(tender, current + safeNumber(payment?.amount, 0));
          }
        } else {
          const tender = tx.tenderType || "CASH";
          const current = tenderBreakdown.get(tender) || 0;
          tenderBreakdown.set(tender, current + safeNumber(tx.amountPaid || tx.total, 0));
        }
      }

      const expectedClosingBalance =
        safeNumber(openReport.openingBalance, 0) + safeNumber(totalSales, 0);
      const safePhysicalCount = safeNumber(physicalCount, 0);
      const variance = safePhysicalCount - expectedClosingBalance;
      const variancePercentage =
        expectedClosingBalance > 0 ? (variance / expectedClosingBalance) * 100 : 0;
      const status = Math.abs(variance) < 1 ? "RECONCILED" : "VARIANCE_NOTED";

      const closedReport = await EndOfDayReport.findByIdAndUpdate(
        openReport._id,
        {
          closedAt: now,
          closedBy: closedBy || req.user?.id || null,
          physicalCount: safePhysicalCount,
          totalSales,
          transactionCount,
          tenderBreakdown,
          expectedClosingBalance,
          variance,
          variancePercentage,
          closingNotes: closingNotes || "",
          status,
          updatedAt: now,
        },
        { new: true }
      )
        .populate("staffId", "name")
        .populate("closedBy", "name")
        .populate("tillId");

      if (openReport.tillId) {
        await Till.findByIdAndUpdate(openReport.tillId, {
          status: "CLOSED",
          closingBalance: safePhysicalCount,
          closedAt: now,
          notes: closingNotes || "",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Till closed successfully",
        report: closedReport,
        summary: {
          totalSales,
          transactionCount,
          expectedClosingBalance,
          physicalCount: safePhysicalCount,
          variance,
          variancePercentage,
          status,
        },
      });
    }

    return res.status(400).json({
      success: false,
      message: "Invalid action. Must be 'create' or 'close'",
    });
  } catch (error) {
    console.error("Error in EOD API:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to process end-of-day",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}
