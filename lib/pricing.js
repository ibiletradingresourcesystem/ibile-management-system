// The only VAT rate in use. A product either has VAT applied at this rate or none at all.
export const VAT_RATE = 7.5;

function toNumber(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

/** Any positive rate (including the retired 4.5%) means VAT applies at VAT_RATE; otherwise 0. */
export function normalizeTaxRate(value) {
  return toNumber(value) > 0 ? VAT_RATE : 0;
}

/**
 * The three figures a product is priced by, all against the sale price the customer pays:
 *
 *   margin % = (sale price - cost price) / sale price x 100
 *   mark-up % = (sale price - cost price) / cost price x 100
 *   VAT %     = VAT_RATE, the share of that sale price that is VAT
 *
 * Margin and mark-up are the same profit read against different things — the sale for margin,
 * the cost for mark-up — so mark-up always reads higher. Neither takes VAT off the sale price
 * first: the sale price is the one figure the till, the receipt and the product screen all show.
 */
export function calculateMarginPercent(costPrice, salePriceIncTax) {
  const cost = toNumber(costPrice);
  const sale = toNumber(salePriceIncTax);

  if (sale <= 0) return 0;
  if (cost <= 0) return 100;

  return ((sale - cost) / sale) * 100;
}

/** Same as calculateMarginPercent, for callers that want the longer name. */
export const calculateProfitMarginPercent = calculateMarginPercent;

/** The same profit read against cost instead of against the sale. */
export function calculateMarkupPercent(costPrice, salePriceIncTax) {
  const cost = toNumber(costPrice);
  const sale = toNumber(salePriceIncTax);

  if (cost <= 0) return 0;

  return ((sale - cost) / cost) * 100;
}

/**
 * The sale price a margin asks for — the reverse of calculateMarginPercent, so typing a margin
 * and typing a price always agree. A margin of 100% or more has no price that satisfies it (the
 * cost would have to be nothing), so it is held just under.
 */
export function calculateSalePriceIncTax(costPrice, marginPercent) {
  const cost = toNumber(costPrice);
  const margin = Math.min(toNumber(marginPercent), 99.99);

  const sale = cost / (1 - margin / 100);
  return Number.isFinite(sale) && sale >= 0 ? sale : 0;
}

/** Cash left on a sale before VAT is taken out of it: sale price less cost. */
export function calculateProfit(costPrice, salePriceIncTax) {
  const cost = toNumber(costPrice);
  const sale = toNumber(salePriceIncTax);

  if (sale <= 0) return 0;
  return sale - cost;
}

/**
 * Price build-up: cost + profit = sale price, with the VAT sitting inside that sale price rather
 * than on top of it.
 *
 *   profitAmount / marginPercent      the whole gap between cost and the sale price
 *   vatAmount                         the slice of that gap which is VAT, owed to the taxman
 *   profitAfterVat / marginAfterVat   what is left once the VAT is handed over
 */
export function getPriceBreakdown(costPrice, salePriceIncTax, taxRate) {
  const cost = toNumber(costPrice);
  const sale = toNumber(salePriceIncTax);
  const tax = toNumber(taxRate);

  const saleExTax = tax > 0 ? sale / (1 + tax / 100) : sale;
  const profitAmount = sale - cost;
  const profitAfterVat = saleExTax - cost;

  return {
    cost,
    sale,
    taxRate: tax,
    saleExTax,
    vatAmount: sale - saleExTax,
    profitAmount,
    profitAfterVat,
    marginAfterVatPercent: saleExTax > 0 ? (profitAfterVat / saleExTax) * 100 : 0,
    // Kept under the old name too, so nothing that reads the breakdown has to change at once
    marginAmount: profitAmount,
    marginPercent: calculateMarginPercent(cost, sale),
    markupPercent: calculateMarkupPercent(cost, sale),
    totalAddOns: profitAmount,
    totalAddOnsPercent: cost > 0 ? (profitAmount / cost) * 100 : 0,
  };
}
