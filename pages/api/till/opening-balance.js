import { mongooseConnect } from "@/lib/mongodb";
import Till from "@/models/Till";
import EndOfDayReport from "@/models/EndOfDayReport";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  }

  await mongooseConnect();

  if (req.method === "GET") {
    const { storeId, locationId } = req.query;
    if (!storeId || !locationId) {
      return res.status(400).json({
        success: false,
        message: "storeId and locationId are required",
      });
    }

    const till = await Till.findOne({
      storeId,
      locationId,
      status: "OPEN",
    }).sort({ openedAt: -1 });

    return res.status(200).json({
      success: true,
      till: till || null,
    });
  }

  if (req.method === "POST") {
    const { storeId, locationId, staffId, staffName, openingBalance, device } = req.body || {};

    if (!storeId || !locationId || !staffId || !staffName) {
      return res.status(400).json({
        success: false,
        message: "storeId, locationId, staffId and staffName are required",
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

    const report = await EndOfDayReport.create({
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
      till,
      report,
    });
  }

  return res.status(405).json({ success: false, message: "Method not allowed" });
}
