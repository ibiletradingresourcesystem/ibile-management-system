function toNumber(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
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
