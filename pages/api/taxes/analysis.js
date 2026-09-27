import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { loadFinancialPeriod } from "@/lib/financial-period-data";
import { buildPeriodRange, computeTaxAnalysis } from "@/lib/tax-analysis";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  try {
    const { period = "last-month" } = req.query;
    const now = new Date();
    const { start, end, label } = buildPeriodRange(period, now);
    const { sales, refunds, expenses, voidedCount, productMap, categoryTreatments } = await loadFinancialPeriod({ start, end });

    const summary = computeTaxAnalysis({
      sales,
      refunds,
      expenses,
      productMap,
      categoryTreatments,
      voidedCount,
      period,
      generatedAt: now,
      periodLabel: label,
    });

    return res.status(200).json(summary);
  } catch (error) {
    console.error("Tax analysis error:", error);
    return res.status(500).json({
      error: "Failed to generate tax analysis",
      message: error?.message || "Unknown error",
      type: error?.name || "Unknown",
    });
  }
}
