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
 *   CIT band   is decided on a year's turnover. A month's turnover against the
 *              yearly thresholds put nearly every business in the exempt band
 *   periods    are days in Lagos, not on the server's clock (UTC), which moved a
 *              sale made just after midnight into the day — or month — before
 *
 * The arithmetic lives in lib/financial-basis.js, which the books import too.
 */
import { VAT_RATE, roundCurrency, summarizePeriod, toNumber } from "@/lib/financial-basis";
import { addDays, dayKeyOf, daysBetween, shopDaysBounds } from "@/lib/tradingDay";

/** A "YYYY-MM-DD" moved by whole months, keeping the day where the month has one. */
function addMonths(key, months) {
  const [year, month, day] = key.split("-").map(Number);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

const monthName = (key) =>
  new Date(`${key.slice(0, 7)}-15T12:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Turnover for a year at the period's rate. The CIT band is set by a year's turnover; a period
 * shorter than a year is scaled up to one, a year or more is taken as it is.
 */
export function annualiseTurnover(turnover, days) {
  const amount = toNumber(turnover);
  if (!days || days >= 365) return roundCurrency(amount);
  return roundCurrency((amount * 365) / days);
}

/**
 * Company income tax rules, newest first, by the day they apply from.
 *
 * Nigeria Tax Act 2025, in force from 1 January 2026: a small company — turnover of ₦100m or less
 * (and fixed assets of ₦250m or less) — pays no CIT and no development levy. Every other company
 * pays CIT at 30% and a 4% development levy on assessable profit. The 20% medium band is gone.
 *
 * Before that, the Finance Act rules: up to ₦25m exempt, ₦25m to ₦100m at 20%, above at 30%, and a
 * minimum tax of 0.5% of turnover for a medium or large company whose CIT came to less than that.
 * The reforms removed the minimum tax. The levies the development levy replaced are not worked out
 * for those years.
 *
 * There is no "National Health Insurance Levy" on turnover. The page used to charge one at 0.5%
 * on every period, on top of everything else; the health insurance law (NHIA Act 2022) is paid out
 * of salaries, not turnover, and the 0.5% of turnover it was standing for was the minimum tax.
 */
export const TAX_REGIMES = [
  {
    from: "2026-01-01",
    law: "Nigeria Tax Act 2025",
    bands: [
      { upTo: 100_000_000, band: "Small (Exempted)", rate: 0, developmentLevyRate: 0, minimumTaxRate: 0 },
      { upTo: Infinity, band: "Standard", rate: 30, developmentLevyRate: 4, minimumTaxRate: 0 },
    ],
  },
  {
    from: "0000-01-01",
    law: "Finance Act 2023",
    bands: [
      { upTo: 25_000_000, band: "Small (Exempted)", rate: 0, developmentLevyRate: 0, minimumTaxRate: 0 },
      { upTo: 100_000_000, band: "Medium", rate: 20, developmentLevyRate: 0, minimumTaxRate: 0.5 },
      { upTo: Infinity, band: "Large", rate: 30, developmentLevyRate: 0, minimumTaxRate: 0.5 },
    ],
  },
];

/** The rules in force on a day ("YYYY-MM-DD"). */
export function taxRegimeFor(day = dayKeyOf(new Date())) {
  return TAX_REGIMES.find((regime) => regime.from <= day) || TAX_REGIMES[TAX_REGIMES.length - 1];
}

/** The band a year's turnover falls in, under the rules in force on `day`. */
export function getTaxBand(revenue, day = dayKeyOf(new Date())) {
  const regime = taxRegimeFor(day);
  const band = regime.bands.find((entry) => revenue <= entry.upTo) || regime.bands[regime.bands.length - 1];
  return {
    band: band.band,
    rate: band.rate,
    developmentLevyRate: band.developmentLevyRate,
    minimumTaxRate: band.minimumTaxRate,
    law: regime.law,
  };
}

/**
 * CIT on a period's profit, or the minimum tax on its turnover where that rule applies and comes to
 * more (a company making little or no profit still paid something under the Finance Act).
 */
function companyTaxFor({ assessable, turnover, band }) {
  const onProfit = roundCurrency((assessable * band.rate) / 100);
  const minimum = roundCurrency((Math.max(toNumber(turnover), 0) * (band.minimumTaxRate || 0)) / 100);
  return { tax: Math.max(onProfit, minimum), onProfit, minimum, minimumApplies: minimum > onProfit };
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

/**
 * The period a report covers, in whole days in Lagos: `start` is the shop's midnight on the first
 * day and `end` the last moment of the last one. `days` is how many days that is.
 */
export function buildPeriodRange(period = "last-month", now = new Date()) {
  const today = dayKeyOf(now);
  const year = Number(today.slice(0, 4));
  let from = addDays(today, -29);
  let to = today;
  let label = "Last 30 Days";

  if (period === "this-year") {
    from = `${year}-01-01`;
    label = `This Year (${year})`;
  } else if (period === "last-year") {
    from = `${year - 1}-01-01`;
    to = `${year - 1}-12-31`;
    label = `Last Year (${year - 1})`;
  } else if (period === "this-quarter") {
    const quarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
    from = `${year}-${String(quarter * 3 + 1).padStart(2, "0")}-01`;
    label = `This Quarter (Q${quarter + 1} ${year})`;
  } else if (period === "last-quarter") {
    from = addMonths(today, -3);
    label = "Last Quarter (3 Months)";
  } else if (period === "this-month") {
    from = `${today.slice(0, 7)}-01`;
    label = `This Month (${monthName(today)})`;
  }

  const bounds = shopDaysBounds(from, to);
  // Every query reads up to and including `end`
  return { start: bounds.start, end: new Date(bounds.end.getTime() - 1), label, from, to, days: daysBetween(from, to) + 1 };
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
  periodDays = 0,
  /** The last day of the period: it decides which year's rules apply. */
  periodTo = null,
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

  // The band goes by a year's turnover; the rate then applies to this period's profit
  const annualTurnover = annualiseTurnover(summary.netRevenue, periodDays);
  const taxBandInfo = getTaxBand(annualTurnover, periodTo || dayKeyOf(generatedAt));
  const taxableIncome = calculateTaxableIncome({
    netRevenue: summary.netRevenue,
    costOfSales: summary.costOfSales,
    expenses: summary.expenses,
  });
  // A loss is not taxed; it is carried forward, which the books track, not this page.
  const assessableIncome = Math.max(taxableIncome, 0);
  const companyTax = companyTaxFor({ assessable: assessableIncome, turnover: summary.netRevenue, band: taxBandInfo });
  const companyIncomeTax = companyTax.tax;
  // On the same assessable profit, for companies that are not small
  const developmentLevy = roundCurrency((assessableIncome * taxBandInfo.developmentLevyRate) / 100);
  const vatOnSales = summary.vatPayable;

  const breakdown = summary.monthly.map((month) => {
    const monthTaxable = Math.max(
      calculateTaxableIncome({
        netRevenue: month.netRevenue,
        costOfSales: month.costOfSales,
        expenses: month.expenses,
      }),
      0
    );
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
      // At the period's band: a single month's turnover is not what decides it
      cit: companyTaxFor({ assessable: monthTaxable, turnover: month.netRevenue, band: taxBandInfo }).tax,
      developmentLevy: roundCurrency((monthTaxable * taxBandInfo.developmentLevyRate) / 100),
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
    /** The law whose rules these are: the one in force on the period's last day. */
    taxLaw: taxBandInfo.law,
    developmentLevy,
    developmentLevyRate: taxBandInfo.developmentLevyRate,
    /** The turnover the band was decided on: this period's, scaled to a year. */
    annualTurnover,
    periodDays,
    taxableIncome,
    companyIncomeTax,
    /** CIT on profit alone, and the Finance Act's minimum tax, which applies when it is more. */
    citOnProfit: companyTax.onProfit,
    minimumTax: companyTax.minimum,
    minimumTaxRate: taxBandInfo.minimumTaxRate,
    minimumTaxApplied: companyTax.minimumApplies,
    vatOnSales,
    vatRate: VAT_RATE,
    totalTaxLiability: roundCurrency(companyIncomeTax + developmentLevy + vatOnSales),

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
