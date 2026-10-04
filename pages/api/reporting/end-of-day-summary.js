import { mongooseConnect } from "@/lib/mongodb";
import EndOfDayReport from "@/models/EndOfDayReport";
import { buildLocationCache, resolveLocationName } from "@/lib/serverLocationHelper";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { normalizeEndOfDayReports } from "@/lib/end-of-day-report-normalize";
import { Transaction } from "@/models/Transactions";
import { attachSellersToReports, summariseSellers } from "@/lib/endOfDaySellers";
import {
  addDays,
  currentTradingDay,
  TRADING_DAY_START_HOUR,
  tradingDayBounds,
  tradingDayKey,
} from "@/lib/tradingDay";

/** Sales are grouped by the shop's own day, not the server's. */
const REPORT_TIME_ZONE = "Africa/Lagos";

/**
 * GET /api/reporting/end-of-day-summary
 * Get end-of-day analytics - SIMPLIFIED DIRECT DB QUERIES
 * 
 * Query params:
 * - period: "day" | "week" | "month" | "year"
 * - locationId: (optional) specific location
 * - storeId: (optional) specific store
 */
export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    await mongooseConnect();
    console.log("✅ MongoDB Connected");

    const { period = "month", locationId, storeId } = req.query;

    // Build filter
    const filter = {};
    if (storeId) filter.storeId = storeId;
    if (locationId) filter.locationId = locationId;

    // Calculate date range. Days are trading days, 6am to 6am in the shop: a till closed at 1:30am
    // is the day before's, with the sales it holds. (Midnight on the server is 1am in the shop.)
    const now = new Date();
    const today = currentTradingDay(now);
    let dateGte = new Date();
    let dateLt = null; // For yesterday filter

    if (period === "today") {
      dateGte = tradingDayBounds(today).start;
    } else if (period === "yesterday") {
      ({ start: dateGte, end: dateLt } = tradingDayBounds(addDays(today, -1)));
    } else if (period === "day") {
      dateGte.setDate(dateGte.getDate() - 1);
    } else if (period === "week") {
      dateGte.setDate(dateGte.getDate() - 7);
    } else if (period === "thisWeek") {
      // From Sunday's trading day (Sun–Sat)
      const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
      dateGte = tradingDayBounds(addDays(today, -weekday)).start;
    } else if (period === "month") {
      dateGte.setMonth(dateGte.getMonth() - 1);
    } else if (period === "thisMonth") {
      dateGte = tradingDayBounds(`${today.slice(0, 7)}-01`).start;
    } else if (period === "year") {
      dateGte.setFullYear(dateGte.getFullYear() - 1);
    } else if (period === "thisYear") {
      dateGte = tradingDayBounds(`${today.slice(0, 4)}-01-01`).start;
    }

    filter.closedAt = dateLt ? { $gte: dateGte, $lt: dateLt } : { $gte: dateGte };

    console.log("📊 Filter:", JSON.stringify(filter, null, 2));
    console.log("📅 Date Range:", { from: dateGte, to: dateLt || now });

    // DIRECT QUERY - Simple find without complex population
    const reports = await EndOfDayReport.find(filter)
      .sort({ closedAt: -1 })
      .lean();

    console.log(`📋 Found ${reports.length} EOD reports`);

    if (reports.length === 0) {
      return res.status(200).json({
        success: true,
        summary: {
          period,
          totals: {
            reports: 0,
            sales: 0,
            transactions: 0,
            variance: 0,
            averageVariancePercentage: 0,
          },
          status: { reconciled: 0, varianceNoted: 0 },
          byLocation: [],
          byStaff: [],
          bySeller: [],
          tenderBreakdown: {},
          dailyData: [],
        },
        reports: [],
      });
    }

    // Build location cache using centralized helper
    const locationCache = await buildLocationCache();
    console.log(`✅ Location cache built with ${Object.keys(locationCache).length} entries`);

    // Enrich reports with location names using centralized helper
    const enrichedReports = await Promise.all(reports.map(async (report) => {
      // Use storeId for fallback lookup if needed
      const locationName = await resolveLocationName(report.locationId, locationCache, report.storeId);
      
      return {
        ...report,
        locationName: locationName,
      };
    }));

    const normalizedReports = normalizeEndOfDayReports(enrichedReports);

    const salesWindow = dateLt ? { $gte: dateGte, $lt: dateLt } : { $gte: dateGte };
    const locationNameFilter = locationId
      ? await resolveLocationName(locationId, locationCache, storeId)
      : "";

    const sellerRows = await Transaction.aggregate([
      {
        $match: {
          createdAt: salesWindow,
          status: "completed",
          subStatus: { $ne: "void" },
          ...(locationNameFilter && locationNameFilter !== "Unknown" ? { location: locationNameFilter } : {}),
        },
      },
      {
        $group: {
          _id: {
            // The trading day: a sale at 1am is the day before's, like the till it was rung on
            day: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: { $subtract: ["$createdAt", TRADING_DAY_START_HOUR * 60 * 60 * 1000] },
                timezone: REPORT_TIME_ZONE,
              },
            },
            location: { $ifNull: ["$location", "Unknown"] },
            staff: { $ifNull: ["$staffName", "Unknown"] },
          },
          transactions: { $sum: 1 },
          totalSales: { $sum: { $ifNull: ["$total", 0] } },
          firstSale: { $min: "$createdAt" },
          lastSale: { $max: "$createdAt" },
        },
      },
      { $sort: { totalSales: -1 } },
    ]);

    const bySeller = summariseSellers(sellerRows);
    attachSellersToReports(normalizedReports, sellerRows);

    console.log(`✅ Enriched ${normalizedReports.length} reports with location names`);

    // Calculate summary statistics
    const totalSales = normalizedReports.reduce((sum, r) => sum + (r.totalSales || 0), 0);
    const totalTransactions = normalizedReports.reduce((sum, r) => sum + (r.transactionCount || 0), 0);
    const totalVariance = normalizedReports.reduce((sum, r) => sum + (r.variance || 0), 0);
    const reconciled = normalizedReports.filter((r) => r.status === "RECONCILED").length;
    const varianceNoted = normalizedReports.filter((r) => r.status === "VARIANCE_NOTED").length;

    // Group by location
    const byLocation = {};
    normalizedReports.forEach((report) => {
      const locName = report.locationName || "Unknown";
      if (!byLocation[locName]) {
        byLocation[locName] = {
          location: locName,
          reports: 0,
          totalSales: 0,
          transactions: 0,
          variance: 0,
        };
      }
      byLocation[locName].reports += 1;
      byLocation[locName].totalSales += report.totalSales || 0;
      byLocation[locName].transactions += report.transactionCount || 0;
      byLocation[locName].variance += report.variance || 0;
    });

    // Group by staff
    const byStaff = {};
    normalizedReports.forEach((report) => {
      const staffName = report.staffName || "Unknown";
      if (!byStaff[staffName]) {
        byStaff[staffName] = {
          staff: staffName,
          reports: 0,
          totalSales: 0,
          transactions: 0,
          variance: 0,
        };
      }
      byStaff[staffName].reports += 1;
      byStaff[staffName].totalSales += report.totalSales || 0;
      byStaff[staffName].transactions += report.transactionCount || 0;
      byStaff[staffName].variance += report.variance || 0;
    });

    // Build tender breakdown
    const tenderSummary = {};
    normalizedReports.forEach((report) => {
      if (report.tenderBreakdown && typeof report.tenderBreakdown === "object") {
        Object.entries(report.tenderBreakdown).forEach(([tender, amount]) => {
          tenderSummary[tender] = (tenderSummary[tender] || 0) + amount;
        });
      }
    });

    // Aggregate by trading day
    const byDate = {};
    normalizedReports.forEach((report) => {
      const dateKey = report.tradingDay || tradingDayKey(report.closedAt);
      if (!byDate[dateKey]) {
        byDate[dateKey] = {
          date: dateKey,
          reports: 0,
          sales: 0,
          transactions: 0,
          variance: 0,
          reconciled: 0,
          varianceNoted: 0,
        };
      }
      byDate[dateKey].reports += 1;
      byDate[dateKey].sales += report.totalSales || 0;
      byDate[dateKey].transactions += report.transactionCount || 0;
      byDate[dateKey].variance += report.variance || 0;
      if (report.status === "RECONCILED") byDate[dateKey].reconciled += 1;
      if (report.status === "VARIANCE_NOTED") byDate[dateKey].varianceNoted += 1;
    });

    const dailyData = Object.values(byDate).sort((a, b) => new Date(a.date) - new Date(b.date));

    const summary = {
      period,
      dateRange: {
        from: dateGte,
        to: dateLt || now,
      },
      totals: {
        reports: normalizedReports.length,
        sales: totalSales,
        transactions: totalTransactions,
        variance: totalVariance,
        averageVariancePercentage:
          normalizedReports.length > 0
            ? (
                normalizedReports.reduce((sum, r) => sum + (r.variancePercentage || 0), 0) /
                normalizedReports.length
              ).toFixed(2)
            : 0,
      },
      status: {
        reconciled,
        varianceNoted,
      },
      byLocation: Object.values(byLocation),
      byStaff: Object.values(byStaff),
      // Who made the sales, which is not always who closed the till.
      bySeller,
      tenderBreakdown: tenderSummary,
      dailyData,
    };

    console.log(`✅ Generated summary with ${normalizedReports.length} reports`);

    return res.status(200).json({
      success: true,
      summary,
      reports: normalizedReports,
    });
  } catch (error) {
    console.error("❌ Error fetching EOD summary:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch end-of-day summary",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}
