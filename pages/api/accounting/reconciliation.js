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
import { dayKeyOf, shopDaysBounds } from "@/lib/tradingDay";

const CODES = {
  INVENTORY: "1200",
  TAX: "2100",
  REVENUE: "4000",
  RETURNS: "4900",
  COGS: "5000",
};

const lagosDate = (date) => date.toLocaleDateString("en-NG", { timeZone: "Africa/Lagos" });

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
    // Whole days in Lagos, the last one included (the queries below read up to and including `end`)
    const fromKey = from ? dayKeyOf(from) : null;
    const toKey = to ? dayKeyOf(to) : null;
    const start = fromKey ? shopDaysBounds(fromKey).start : range.start;
    const end = toKey ? new Date(shopDaysBounds(toKey).end.getTime() - 1) : range.end;
    const periodLabel = fromKey || toKey ? `${lagosDate(start)} to ${lagosDate(end)}` : range.label;

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

    // Running costs are every expense account but cost of sales. Refunds no longer post among
    // them: they come off revenue.
    let postedExpenses = 0;
    for (const [code, bal] of Object.entries(postedByCode)) {
      if (!code.startsWith("6")) continue;
      postedExpenses += bal.debit - bal.credit;
    }

    // Refunds taken off revenue: through the returns account, or straight off sales on a chart
    // that has no returns account of its own
    let postedRefunds = 0;
    for (const entry of entries) {
      if (entry.referenceType !== "REFUND") continue;
      for (const line of entry.lines || []) {
        if (![CODES.REVENUE, CODES.RETURNS].includes(String(line.accountCode))) continue;
        postedRefunds += (Number(line.debit) || 0) - (Number(line.credit) || 0);
      }
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
      revenue: difference(summary.netRevenue, creditBalance(CODES.REVENUE) - debitBalance(CODES.RETURNS)),
      vat: difference(summary.vatPayable, creditBalance(CODES.TAX)),
      costOfSales: difference(summary.cogs - summary.refundCogs, debitBalance(CODES.COGS)),
      refunds: difference(summary.refundNet, postedRefunds),
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
