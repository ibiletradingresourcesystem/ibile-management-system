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

export function calculateSalePriceIncTax(costPrice, marginPercent, taxRate, applyTax = true) {
  const cost = toNumber(costPrice);
  const margin = toNumber(marginPercent);
  const tax = toNumber(taxRate);

  const saleExTax = cost * (1 + margin / 100);
  const saleIncTax = applyTax ? saleExTax * (1 + tax / 100) : saleExTax;
  return saleIncTax;
}

export function calculateMarginPercent(costPrice, salePriceIncTax, taxRate, applyTax = true) {
  const cost = toNumber(costPrice);
  const saleIncTax = toNumber(salePriceIncTax);
  const tax = toNumber(taxRate);

  if (saleIncTax <= 0) return 0;
  if (cost <= 0) return 100;

  const saleExTax = applyTax ? saleIncTax / (1 + tax / 100) : saleIncTax;
  return ((saleExTax - cost) / cost) * 100;
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
 * Margin % is on cost (same as calculateMarginPercent). Total add-ons = margin + VAT.
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
    totalAddOns,
    totalAddOnsPercent: cost > 0 ? (totalAddOns / cost) * 100 : 0,
  };
}
