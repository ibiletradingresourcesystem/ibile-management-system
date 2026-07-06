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

export function calculateTaxableIncome(revenue, expenses) {
  return expenses ? revenue - expenses : revenue * 0.95;
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
  transactions = [],
  expenses = [],
  productMap = {},
  period = "last-month",
  generatedAt = new Date(),
  periodLabel = "",
}) {
  const totalRevenue = transactions.reduce((sum, t) => sum + (Number(t.total) || 0), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  // Calculate VAT-able revenue and COGS from transaction items
  let vatableRevenue = 0;
  let totalCOGS = 0;

  for (const t of transactions) {
    const items = t.items || [];
    for (const item of items) {
      const qty = Number(item.qty || item.quantity) || 0;
      const price = Number(item.salePriceIncTax || item.price) || 0;
      const itemRevenue = price * qty;
      const productId = String(item.productId || "");
      const productInfo = productMap[productId];

      if (productInfo) {
        // VAT: only count revenue from products with taxRate > 0
        if (productInfo.taxRate > 0) {
          vatableRevenue += itemRevenue;
        }
        // COGS: cost price × quantity sold
        totalCOGS += (productInfo.costPrice || 0) * qty;
      }
    }
  }

  const taxBandInfo = getTaxBand(totalRevenue);
  const vatRate = 7.5;
  const nhlRate = 0.5;

  const taxableIncome = calculateTaxableIncome(totalRevenue, totalExpenses);
  const companyIncomeTax = (taxableIncome * taxBandInfo.rate) / 100;
  // VAT applies only to revenue from VAT-able products
  const vatOnSales = (vatableRevenue * vatRate) / 100;
  const nhlAmount = (totalRevenue * nhlRate) / 100;
  const totalTaxLiability = companyIncomeTax + vatOnSales + nhlAmount;

  // Net profit = Revenue - Cost of Goods Sold - Operating Expenses
  const grossProfit = totalRevenue - totalCOGS;
  const netProfit = grossProfit - totalExpenses;

  const monthlyData = {};

  for (const t of transactions) {
    const date = new Date(t.createdAt);
    const monthKey = date.toLocaleString("default", { month: "long", year: "numeric" });
    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        month: monthKey,
        income: 0,
        vatableIncome: 0,
        cogs: 0,
        expenses: 0,
        vat: 0,
        cit: 0,
        nhl: 0,
      };
    }
    monthlyData[monthKey].income += Number(t.total) || 0;

    // Per-item VAT-able and COGS for this transaction
    const items = t.items || [];
    for (const item of items) {
      const qty = Number(item.qty || item.quantity) || 0;
      const price = Number(item.salePriceIncTax || item.price) || 0;
      const itemRevenue = price * qty;
      const productId = String(item.productId || "");
      const productInfo = productMap[productId];

      if (productInfo) {
        if (productInfo.taxRate > 0) {
          monthlyData[monthKey].vatableIncome += itemRevenue;
        }
        monthlyData[monthKey].cogs += (productInfo.costPrice || 0) * qty;
      }
    }
  }

  for (const e of expenses) {
    const date = new Date(e.createdAt || e.expenseDate || generatedAt);
    const monthKey = date.toLocaleString("default", { month: "long", year: "numeric" });
    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        month: monthKey,
        income: 0,
        vatableIncome: 0,
        cogs: 0,
        expenses: 0,
        vat: 0,
        cit: 0,
        nhl: 0,
      };
    }
    monthlyData[monthKey].expenses += Number(e.amount) || 0;
  }

  const breakdown = Object.values(monthlyData)
    .map((item) => {
      const monthTaxableIncome = calculateTaxableIncome(item.income, item.expenses);
      const monthBand = getTaxBand(item.income);
      return {
        ...item,
        vat: (item.vatableIncome * vatRate) / 100,
        cit: (monthTaxableIncome * monthBand.rate) / 100,
        nhl: (item.income * nhlRate) / 100,
      };
    })
    .sort((a, b) => new Date(a.month) - new Date(b.month));

  return {
    totalRevenue,
    totalExpenses,
    totalCOGS,
    grossProfit,
    netProfit,
    vatableRevenue,
    band: taxBandInfo.band,
    citRate: taxBandInfo.rate,
    taxableIncome,
    companyIncomeTax,
    vatOnSales,
    vatRate,
    nhlAmount,
    nhlRate,
    totalTaxLiability,
    breakdown,
    period,
    periodLabel,
    generatedAt: generatedAt.toISOString(),
  };
}
