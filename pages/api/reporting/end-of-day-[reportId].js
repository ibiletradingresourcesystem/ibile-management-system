import { mongooseConnect } from '../../../lib/mongodb';
import EndOfDayReport from '../../../models/EndOfDayReport';
import { buildLocationCache, resolveLocationName } from '../../../lib/serverLocationHelper';
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { normalizeEndOfDayReport } from "@/lib/end-of-day-report-normalize";


export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await mongooseConnect();
    const { reportId } = req.query;

    if (!reportId) {
      return res.status(400).json({ message: "Report ID is required" });
    }

    console.log("📊 Fetching EndOfDay report:", reportId);

    const report = await EndOfDayReport.findById(reportId)
      .populate("storeId", "storeName")
      .populate("staffId", "name")
      .populate("tillId")
      .lean();

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    // Resolve location name from ID
    const locationCache = await buildLocationCache();
    const locationName = await resolveLocationName(report.locationId, locationCache, report.storeId);

    console.log("✅ Report fetched successfully");

    const normalizedReport = normalizeEndOfDayReport({
      ...report,
      locationId: String(report.locationId), // Ensure it's a string
      locationName: locationName, // Add resolved location name
    });

    return res.status(200).json({
      success: true,
      report: normalizedReport,
    });
  } catch (error) {
    console.error("❌ Error fetching EndOfDay report:", error.message);
    return res.status(500).json({
      message: "Failed to fetch EndOfDay report",
      error: error.message,
    });
  }
}
