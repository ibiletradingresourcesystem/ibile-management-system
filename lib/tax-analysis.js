/**
 * The tax dashboard, read off the same basis as the books.
 *
 * What changed, and why the figures here no longer disagree with
 * /accounting/reports:
 *
 *   revenue    is turnover, net of VAT. It used to be the VAT-inclusive total,
 *              which counted money held for the taxman as income
 *   VAT        is the slice inside the price, taken from what the POS charged.
 *              It used to be 7.5% added on top of a price that already had VAT
 *              in it, which overstated the liability
 *   CIT        is charged on assessable profit (turnover less cost of sales less
 *              expenses). It used to be charged on revenue less expenses, with
 *              the cost of the goods sold left out altogether
 *   sales      include credit sales and exclude voided ones. Credit sales were
 *              missing entirely and voids were counted as income
 *   refunds    reverse in the period the refund was given, as the books post it
 *   expenses   land on the date of the spend, not the date of data entry
 *
 * The arithmetic lives in lib/financial-basis.js, which the books import too.
 */
import { NHL_RATE, VAT_RATE, roundCurrency, summarizePeriod } from "@/lib/financial-basis";

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function getTaxBand(revenue) {
  if (revenue <= 25_000_000) return { band: "Small (Exempted)", rate: 0 };
  if (revenue <= 100_000_000) return { band: "Medium", rate: 20 };
  return { band: "Large", rate: 30 };
}

/**
 * Assessable profit: turnover less the cost of the goods sold less running
 * costs. With no cost figures recorded at all there is nothing to assess
 * against, so the old rule of thumb — 95% of turnover — still stands in.
 */
export function calculateTaxableIncome({ netRevenue = 0, costOfSales = 0, expenses = 0 } = {}) {
  if (costOfSales === 0 && expenses === 0) return roundCurrency(netRevenue * 0.95);
  return roundCurrency(netRevenue - costOfSales - expenses);
}

export function buildPeriodRange(period = "last-month", now = new Date()) {
  const end = endOfDay(now);
  let start;
  let label = "Last 30 Days";

  if (period === "this-year") {
    start = startOfDay(new Date(now.getFullYear(), 0, 1));
    label = `This Year (${now.getFullYear()})`;
  } else if (period === "last-year") {
    start = startOfDay(new Date(now.getFullYear() - 1, 0, 1));
    const lastYearEnd = endOfDay(new Date(now.getFullYear() - 1, 11, 31));
    return { start, end: lastYearEnd, label: `Last Year (${now.getFullYear() - 1})` };
  } else if (period === "this-quarter") {
    const quarter = Math.floor(now.getMonth() / 3);
    start = startOfDay(new Date(now.getFullYear(), quarter * 3, 1));
    label = `This Quarter (Q${quarter + 1} ${now.getFullYear()})`;
  } else if (period === "last-quarter") {
    const startDate = new Date(now);
    startDate.setMonth(startDate.getMonth() - 3);
    start = startOfDay(startDate);
    label = "Last Quarter (3 Months)";
  } else if (period === "this-month") {
    start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    label = `This Month (${now.toLocaleString("default", { month: "long", year: "numeric" })})`;
  } else {
    const last30 = new Date(now);
    last30.setDate(last30.getDate() - 30);
    start = startOfDay(last30);
    label = "Last 30 Days";
  }

  return { start, end, label };
}

export function computeTaxAnalysis({
  sales,
  refunds = [],
  transactions = [],
  expenses = [],
  productMap = {},
  categoryTreatments = {},
  voidedCount = 0,
  period = "last-month",
  generatedAt = new Date(),
  periodLabel = "",
  summary: providedSummary = null,
}) {
  // `transactions` is the old argument name, kept so an older caller still works.
  const summary =
    providedSummary ||
    summarizePeriod({
      sales: sales || transactions,
      refunds,
      expenses,
      productMap,
      categoryTreatments,
      voidedCount,
    });

  const taxBandInfo = getTaxBand(summary.netRevenue);
  const taxableIncome = calculateTaxableIncome({
    netRevenue: summary.netRevenue,
    costOfSales: summary.costOfSales,
    expenses: summary.expenses,
  });
  // A loss is not taxed; it is carried forward, which the books track, not this page.
  const assessableIncome = Math.max(taxableIncome, 0);
  const companyIncomeTax = roundCurrency((assessableIncome * taxBandInfo.rate) / 100);
  const vatOnSales = summary.vatPayable;
  const nhlAmount = roundCurrency((summary.netRevenue * NHL_RATE) / 100);

  const breakdown = summary.monthly.map((month) => {
    const monthTaxable = Math.max(
      calculateTaxableIncome({
        netRevenue: month.netRevenue,
        costOfSales: month.costOfSales,
        expenses: month.expenses,
      }),
      0
    );
    const monthBand = getTaxBand(month.netRevenue);
    return {
      month: month.month,
      monthKey: month.monthKey,
      // `income` stays the key the table reads; it is now turnover, net of VAT.
      income: month.netRevenue,
      grossIncome: month.grossRevenue,
      vatableIncome: month.vatableGross,
      cogs: month.costOfSales,
      expenses: month.expenses,
      stockPurchases: month.stockPurchases,
      refunds: month.refundNet,
      vat: month.vatPayable,
      cit: roundCurrency((monthTaxable * monthBand.rate) / 100),
      nhl: roundCurrency((month.netRevenue * NHL_RATE) / 100),
    };
  });

  return {
    // Turnover and profit, on the same basis as the profit and loss statement.
    totalRevenue: summary.netRevenue,
    grossRevenue: summary.grossRevenue,
    netRevenue: summary.netRevenue,
    vatCollected: summary.vat,
    totalExpenses: summary.expenses,
    /**
     * Stock bought in the period. Reported, never deducted here: it is inventory
     * until it sells, and it reaches profit through cost of goods sold.
     */
    stockPurchases: summary.stockPurchases,
    totalCOGS: summary.costOfSales,
    grossProfit: summary.grossProfit,
    netProfit: summary.netProfit,
    vatableRevenue: summary.vatableGross,
    refundsNet: summary.refundNet,
    refundsGross: summary.refundGross,

    band: taxBandInfo.band,
    citRate: taxBandInfo.rate,
    taxableIncome,
    companyIncomeTax,
    vatOnSales,
    vatRate: VAT_RATE,
    nhlAmount,
    nhlRate: NHL_RATE,
    totalTaxLiability: roundCurrency(companyIncomeTax + vatOnSales + nhlAmount),

    breakdown,
    counts: summary.counts,
    // Said out loud on the page, so nobody has to guess which rules produced these.
    basis: {
      revenue: "Turnover net of VAT, refunds reversed in the period they were given",
      sales: "Completed and credit sales; voided sales excluded",
      cost: "Cost recorded on the sale line, else the current product cost",
      expenses: "Running costs only, dated by when the spend was incurred",
      stockPurchases: "Held as inventory, charged to profit as cost of goods sold when it sells",
      incompleteCostLines: summary.missingCostLines,
    },
    period,
    periodLabel,
    generatedAt: generatedAt.toISOString(),
  };
}
