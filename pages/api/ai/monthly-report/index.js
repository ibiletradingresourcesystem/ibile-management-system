/**
 * API: /api/ai/monthly-report
 * 
 * GET - Retrieve the latest monthly AI insight (from cache)
 * POST - Regenerate monthly AI insight for a specific month (admin only)
 * 
 * Query: month (YYYY-MM format, defaults to current month)
 */
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff, isAdmin } from "@/lib/auth-middleware";
import AIInsight from "@/models/AIInsight";
import { generateMonthlyReportInsight } from "@/lib/ai/monthlyReportAI";
import { generateDashboardMetrics } from "@/lib/analytics/dashboardAnalytics";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const { month } = req.query;
      let reportPeriodQuery = {};

      if (month) {
        // Search by month label like "July 2026"
        const [year, monthNum] = month.split("-");
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        reportPeriodQuery.reportPeriod = `${months[Number(monthNum) - 1]} ${year}`;
      }

      const insight = await AIInsight.findOne({
        reportType: "monthly",
        ...reportPeriodQuery,
      })
        .sort({ generatedAt: -1 })
        .lean();

      if (!insight) {
        return res.status(200).json({ success: true, insight: null, message: "No monthly AI insight found" });
      }

      return res.status(200).json({
        success: true,
        insight: {
          executiveSummary: insight.summary,
          highlights: insight.data?.highlights || insight.highlights || [],
          risks: insight.data?.risks || [],
          opportunities: insight.data?.opportunities || insight.opportunities || [],
          recommendations: insight.data?.recommendations || { immediate: [], shortTerm: [], longTerm: [] },
          healthScore: insight.healthScore,
          growthOutlook: insight.data?.growthOutlook || "neutral",
          reportPeriod: insight.reportPeriod,
          generatedAt: insight.generatedAt,
          cached: true,
        },
        metrics: insight.metrics,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    if (!isAdmin(req)) return res.status(403).json({ error: "Only admins can regenerate monthly insights" });

    try {
      // Generate fresh metrics for the current/specified month
      const metrics = await generateDashboardMetrics("month");

      const aiMetrics = {
        reportPeriod: metrics.reportPeriod,
        totalSales: metrics.sales.totalSales,
        totalTransactions: metrics.sales.transactionCount,
        totalItemsSold: metrics.sales.totalItemsSold,
        totalExpenses: metrics.profit.totalExpenses,
        totalCOGS: metrics.profit.totalCOGS,
        grossProfit: metrics.profit.grossProfit,
        netProfit: metrics.profit.netProfit,
        grossMargin: metrics.profit.grossMargin,
        netMargin: metrics.profit.netMargin,
        stockValue: metrics.inventory.totalRetailValue,
        lowStockCount: metrics.stockHealth.lowStockCount,
        topProducts: metrics.topProducts.slice(0, 5),
        salesGrowth: metrics.growth.salesGrowth,
      };

      const insight = await generateMonthlyReportInsight(aiMetrics);

      if (!insight) {
        return res.status(200).json({ success: false, message: "AI insight generation failed" });
      }

      return res.status(200).json({ success: true, insight, regenerated: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
