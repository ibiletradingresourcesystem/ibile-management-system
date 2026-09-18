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
 * Margin is what the sale keeps, as a share of the sale price with VAT taken out:
 *
 *   margin % = (sale price - VAT - cost) / (sale price - VAT) x 100
 *
 * The VAT in a sale price is collected for the taxman, so it is taken off before anything else.
 * Mark-up answers a different question — what is added on top of cost — and always reads higher
 * on the same product; calculateMarkupPercent gives that, for showing beside the price build-up.
 */
export function calculateMarginPercent(costPrice, salePriceIncTax, taxRate, applyTax = true) {
  const cost = toNumber(costPrice);
  const saleIncTax = toNumber(salePriceIncTax);
  const tax = toNumber(taxRate);

  if (saleIncTax <= 0) return 0;
  if (cost <= 0) return 100;

  const saleExTax = applyTax ? saleIncTax / (1 + tax / 100) : saleIncTax;
  if (saleExTax <= 0) return 0;

  return ((saleExTax - cost) / saleExTax) * 100;
}

/** Same as calculateMarginPercent, for callers that want the longer name. */
export const calculateProfitMarginPercent = calculateMarginPercent;

/** What is added on top of cost to reach the price before VAT — (sale - VAT - cost) / cost. */
export function calculateMarkupPercent(costPrice, salePriceIncTax, taxRate, applyTax = true) {
  const cost = toNumber(costPrice);
  const saleIncTax = toNumber(salePriceIncTax);
  const tax = toNumber(taxRate);

  if (cost <= 0) return 0;

  const saleExTax = applyTax ? saleIncTax / (1 + tax / 100) : saleIncTax;
  return ((saleExTax - cost) / cost) * 100;
}

/**
 * The sale price a margin asks for — the reverse of calculateMarginPercent, so typing a margin
 * and typing a price always agree. A margin of 100% or more has no price that satisfies it (the
 * cost would have to be nothing), so it is held just under.
 */
export function calculateSalePriceIncTax(costPrice, marginPercent, taxRate, applyTax = true) {
  const cost = toNumber(costPrice);
  const margin = Math.min(toNumber(marginPercent), 99.99);
  const tax = toNumber(taxRate);

  const saleExTax = cost / (1 - margin / 100);
  if (!Number.isFinite(saleExTax) || saleExTax < 0) return 0;

  return applyTax ? saleExTax * (1 + tax / 100) : saleExTax;
}

export function calculateProfit(costPrice, salePriceIncTax, taxRate, applyTax = true) {
  const cost = toNumber(costPrice);
  const saleIncTax = toNumber(salePriceIncTax);
  const tax = toNumber(taxRate);

  if (saleIncTax <= 0) return 0;
  const saleExTax = applyTax ? saleIncTax / (1 + tax / 100) : saleIncTax;
  return saleExTax - cost;
}

/**
 * Price build-up from cost to sale price:
 *   cost + margin = price before VAT, + VAT = sale price.
 * marginPercent is the share of the price before VAT that is kept as profit; markupPercent is
 * the same profit read against cost. Total add-ons = margin + VAT.
 */
export function getPriceBreakdown(costPrice, salePriceIncTax, taxRate) {
  const cost = toNumber(costPrice);
  const sale = toNumber(salePriceIncTax);
  const tax = toNumber(taxRate);

  const saleExTax = tax > 0 ? sale / (1 + tax / 100) : sale;
  const totalAddOns = sale - cost;

  return {
    cost,
    sale,
    taxRate: tax,
    saleExTax,
    vatAmount: sale - saleExTax,
    marginAmount: saleExTax - cost,
    marginPercent: calculateMarginPercent(cost, sale, tax),
    markupPercent: calculateMarkupPercent(cost, sale, tax),
    totalAddOns,
    totalAddOnsPercent: cost > 0 ? (totalAddOns / cost) * 100 : 0,
  };
}
