import { mongooseConnect } from "@/lib/mongodb";
import Transaction from "@/models/Transactions";
import Expense from "@/models/Expense";
import Product from "@/models/Product";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
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
    await mongooseConnect();

    const { period = "last-month" } = req.query;
    const now = new Date();
    const { start, end, label } = buildPeriodRange(period, now);
    const dateFilter = { createdAt: { $gte: start, $lte: end } };

    const [transactions, expenses, products] = await Promise.all([
      Transaction.find({ ...dateFilter, status: "completed" }).lean().exec(),
      Expense.find(dateFilter).lean().exec(),
      Product.find({}, { _id: 1, costPrice: 1, taxRate: 1 }).lean().exec(),
    ]);

    // Build product lookup map
    const productMap = {};
    for (const p of products) {
      productMap[String(p._id)] = { costPrice: p.costPrice || 0, taxRate: p.taxRate || 0 };
    }

    const summary = computeTaxAnalysis({
      transactions,
      expenses,
      productMap,
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
