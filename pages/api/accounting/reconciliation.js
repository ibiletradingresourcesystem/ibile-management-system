/**
 * Do the books say the same thing as the till?
 *
 * The profit and loss statement is built from posted journal entries, while the
 * tax dashboard is built from the transactions themselves. Both are now read on
 * one basis (lib/financial-basis.js), so for any period the two should land on
 * the same figures — and where they do not, the reason is almost always a sale
 * that never got posted, or an entry standing for a sale that was later voided.
 * This endpoint puts the two side by side and names the gap.
 */
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { mongooseConnect } from "@/lib/mongodb";
import JournalEntry from "@/models/JournalEntry";
import Transaction from "@/models/Transactions";
import { roundCurrency, summarizePeriod } from "@/lib/financial-basis";
import { loadFinancialPeriod, voidedQuery } from "@/lib/financial-period-data";
import { buildPeriodRange } from "@/lib/tax-analysis";

const CODES = {
  INVENTORY: "1200",
  TAX: "2100",
  REVENUE: "4000",
  COGS: "5000",
  REFUND: "6200",
};

/** A naira of rounding either way is not a disagreement worth reporting. */
const TOLERANCE = 1;

function difference(source, posted) {
  const gap = roundCurrency(source - posted);
  return { source: roundCurrency(source), posted: roundCurrency(posted), difference: gap, agrees: Math.abs(gap) <= TOLERANCE };
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    await mongooseConnect();

    const { from, to, period = "last-month" } = req.query;
    const now = new Date();
    const range = buildPeriodRange(period, now);
    const start = from ? new Date(from) : range.start;
    const end = to ? new Date(to) : range.end;
    const periodLabel = from || to ? `${start.toLocaleDateString("en-NG")} to ${end.toLocaleDateString("en-NG")}` : range.label;

    const { sales, refunds, expenses, voidedCount, productMap, categoryTreatments } = await loadFinancialPeriod({ start, end });
    const summary = summarizePeriod({ sales, refunds, expenses, productMap, categoryTreatments, voidedCount });

    const entries = await JournalEntry.find(
      { status: "POSTED", date: { $gte: start, $lte: end } },
      { lines: 1, referenceType: 1, referenceId: 1 }
    ).lean();

    // What the books hold for this period, account by account.
    const postedByCode = {};
    for (const entry of entries) {
      for (const line of entry.lines || []) {
        const code = String(line.accountCode || "");
        if (!postedByCode[code]) postedByCode[code] = { debit: 0, credit: 0 };
        postedByCode[code].debit += Number(line.debit) || 0;
        postedByCode[code].credit += Number(line.credit) || 0;
      }
    }
    const creditBalance = (code) => {
      const bal = postedByCode[code] || { debit: 0, credit: 0 };
      return bal.credit - bal.debit;
    };
    const debitBalance = (code) => {
      const bal = postedByCode[code] || { debit: 0, credit: 0 };
      return bal.debit - bal.credit;
    };

    // Running costs are every expense account except cost of sales and refunds,
    // which the statement reports on their own lines.
    let postedExpenses = 0;
    for (const [code, bal] of Object.entries(postedByCode)) {
      if (!code.startsWith("6") || code === CODES.REFUND) continue;
      postedExpenses += bal.debit - bal.credit;
    }

    // Stock bought through an expense record should have gone to inventory, not
    // to an expense account, so it is checked against the inventory it created.
    let inventoryFromExpenses = 0;
    for (const entry of entries) {
      if (entry.referenceType !== "EXPENSE") continue;
      for (const line of entry.lines || []) {
        if (String(line.accountCode) !== CODES.INVENTORY) continue;
        inventoryFromExpenses += (Number(line.debit) || 0) - (Number(line.credit) || 0);
      }
    }

    // A sale with no posted entry is money the books have never seen.
    const saleIds = sales.map((tx) => String(tx._id));
    const postedSaleIds = new Set(
      entries
        .filter((entry) => ["SALE", "CREDIT_SALE"].includes(entry.referenceType) && entry.referenceId)
        .map((entry) => String(entry.referenceId))
    );
    const unpostedSales = sales.filter((tx) => !postedSaleIds.has(String(tx._id)));
    const unpostedValue = unpostedSales.reduce((sum, tx) => sum + (Number(tx.total) || 0), 0);

    // And an entry still standing for a voided sale is income that never existed.
    const voidedIds = (await Transaction.find(voidedQuery(start, end), { _id: 1 }).lean()).map((tx) => tx._id);
    const stalePostedVoids = voidedIds.length
      ? await JournalEntry.countDocuments({
          status: "POSTED",
          referenceType: { $in: ["SALE", "CREDIT_SALE"] },
          referenceId: { $in: voidedIds },
        })
      : 0;

    const lines = {
      revenue: difference(summary.netSales, creditBalance(CODES.REVENUE)),
      vat: difference(summary.vatPayable, creditBalance(CODES.TAX)),
      costOfSales: difference(summary.cogs - summary.refundCogs, debitBalance(CODES.COGS)),
      refunds: difference(summary.refundNet, debitBalance(CODES.REFUND)),
      expenses: difference(summary.expenses, postedExpenses),
      stockPurchases: difference(summary.stockPurchases, inventoryFromExpenses),
    };
    const agrees = Object.values(lines).every((line) => line.agrees);

    return res.status(200).json({
      success: true,
      period: { from: start.toISOString(), to: end.toISOString(), label: periodLabel },
      agrees,
      lines,
      issues: {
        unpostedSales: unpostedSales.length,
        unpostedSalesValue: roundCurrency(unpostedValue),
        stalePostedVoids,
        voidedSales: voidedCount,
        incompleteCostLines: summary.missingCostLines,
        stockPurchaseExpenses: summary.counts.stockPurchases,
      },
      counts: summary.counts,
      salesConsidered: saleIds.length,
      // What the tax dashboard quotes for the same period, so the two can be read together.
      taxView: {
        grossRevenue: summary.grossRevenue,
        netRevenue: summary.netRevenue,
        vatPayable: summary.vatPayable,
        costOfSales: summary.costOfSales,
        expenses: summary.expenses,
        stockPurchases: summary.stockPurchases,
        grossProfit: summary.grossProfit,
        netProfit: summary.netProfit,
      },
    });
  } catch (error) {
    console.error("Reconciliation error:", error);
    return res.status(500).json({ error: "Failed to reconcile", message: error?.message || "Unknown error" });
  }
}
