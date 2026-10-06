/**
 * Personal income tax under the Nigeria Tax Act 2025, in force from 1 January 2026.
 *
 * Chargeable income is gross income less the allowable deductions — pension, NHF and health
 * insurance contributions, life assurance premiums, interest on a loan for the home you live in —
 * and less rent relief: 20% of the rent you pay, up to ₦500,000. It is then taxed in bands, the
 * first ₦800,000 at 0%.
 *
 * The Consolidated Relief Allowance (₦200,000 or 1% of gross, plus 20% of gross) went with the
 * Personal Income Tax Act. The calculator used to take it off as well as the new ₦800,000 band,
 * which understated the tax by around a fifth of the income; and two of the band widths were off,
 * so income between ₦10m and ₦12m was taxed at 21% instead of 18%.
 *
 * Nothing here touches the page, so the tests use it directly.
 */

/** Each band's width and rate, in order. */
export const PERSONAL_TAX_BANDS = [
  { width: 800_000, rate: 0, label: "First ₦800,000" },
  { width: 2_200_000, rate: 0.15, label: "Next ₦2,200,000 (up to ₦3m)" },
  { width: 9_000_000, rate: 0.18, label: "Next ₦9,000,000 (up to ₦12m)" },
  { width: 13_000_000, rate: 0.21, label: "Next ₦13,000,000 (up to ₦25m)" },
  { width: 25_000_000, rate: 0.23, label: "Next ₦25,000,000 (up to ₦50m)" },
  { width: Infinity, rate: 0.25, label: "Above ₦50,000,000" },
];

export const RENT_RELIEF_RATE = 0.2;
export const RENT_RELIEF_CAP = 500_000;

const amount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const round2 = (value) => Math.round(value * 100) / 100;

/** 20% of the year's rent, no more than ₦500,000. Nothing for a home you own. */
export function rentRelief(annualRent) {
  return round2(Math.min(amount(annualRent) * RENT_RELIEF_RATE, RENT_RELIEF_CAP));
}

/** Tax on a year's chargeable income, band by band. */
export function taxByBands(chargeableIncome) {
  let remaining = amount(chargeableIncome);
  let tax = 0;
  const bands = PERSONAL_TAX_BANDS.map((band) => {
    const taxable = Math.min(remaining, band.width);
    remaining -= taxable;
    const bandTax = taxable * band.rate;
    tax += bandTax;
    return { ...band, taxable: round2(taxable), tax: round2(bandTax) };
  });
  return { tax: round2(tax), bands };
}

/**
 * A year's personal income tax. Every figure is for the whole year.
 *
 * @param {Object} input
 * @param {number} input.grossIncome   salary and other income before anything comes off
 * @param {number} [input.pension]     pension contribution
 * @param {number} [input.deductions]  the other allowable deductions, added up
 * @param {number} [input.annualRent]  rent paid on the home you live in
 */
export function calculatePersonalTax({ grossIncome = 0, pension = 0, deductions = 0, annualRent = 0 } = {}) {
  const gross = amount(grossIncome);
  const pensionDeduction = amount(pension);
  const otherDeductions = amount(deductions);
  const relief = rentRelief(annualRent);
  const totalDeductions = round2(pensionDeduction + otherDeductions + relief);
  const chargeableIncome = round2(Math.max(0, gross - totalDeductions));
  const { tax, bands } = taxByBands(chargeableIncome);

  return {
    gross,
    pension: pensionDeduction,
    other: otherDeductions,
    rentRelief: relief,
    totalDeductions,
    taxableIncome: chargeableIncome,
    yearlyTax: tax,
    monthlyTax: round2(tax / 12),
    effectiveRate: gross > 0 ? (tax / gross) * 100 : 0,
    bandBreakdown: bands,
  };
}
