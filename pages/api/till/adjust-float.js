import { mongooseConnect } from "@/lib/mongodb";
import Till from "@/models/Till";
import EndOfDayReport from "@/models/EndOfDayReport";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

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

  await mongooseConnect();

  const { tillId, amount, reason, staffId } = req.body || {};
  const safeAmount = safeNumber(amount, NaN);

  if (!tillId || !Number.isFinite(safeAmount) || safeAmount === 0) {
    return res.status(400).json({
      success: false,
      message: "tillId and a non-zero numeric amount are required",
    });
  }

  const till = await Till.findById(tillId);
  if (!till) {
    return res.status(404).json({ success: false, message: "Till not found" });
  }

  if (till.status !== "OPEN") {
    return res.status(400).json({
      success: false,
      message: "Float can only be adjusted on an open till",
    });
  }

  till.openingBalance = safeNumber(till.openingBalance, 0) + safeAmount;
  till.floatAdjustments.push({
    amount: safeAmount,
    reason: reason || "",
    staffId: staffId || req.user?.id || null,
    createdAt: new Date(),
  });
  await till.save();

  const openReport = await EndOfDayReport.findOne({
    tillId: till._id,
    closedAt: null,
  });

  if (openReport) {
    openReport.openingBalance = safeNumber(openReport.openingBalance, 0) + safeAmount;
    const note = `Float adjusted by ${safeAmount} (${reason || "No reason"})`;
    openReport.closingNotes = openReport.closingNotes
      ? `${openReport.closingNotes}\n${note}`
      : note;
    openReport.updatedAt = new Date();
    await openReport.save();
  }

  return res.status(200).json({
    success: true,
    message: "Float adjusted successfully",
    till,
    reportUpdated: Boolean(openReport),
  });
}
