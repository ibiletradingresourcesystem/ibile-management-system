/**
 * Pack / child unit maths shared by stock updates, sales and reports.
 *
 * A parent (mother) product is a pack holding `qtyPerPack` base units, e.g. a pack of 24.
 * A parent can have many children, each holding `unitsPerChild` of those base units
 * (e.g. unit of 6, unit of 2, unit of 1). Children have no stock of their own:
 *   child.qty = parent.qty × parent.qtyPerPack ÷ child.unitsPerChild
 */

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function roundQty(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

export function isDerivedChild(product) {
  return Boolean(product?.isChildProduct && product?.parentProduct && product?.packType !== "pack");
}

export function getPackSize(parent) {
  return positiveNumber(parent?.qtyPerPack);
}

export function getUnitsPerChild(child) {
  return positiveNumber(child?.unitsPerChild);
}

/** Parent packs used up when `childQty` of a child is sold, refunded or moved. */
export function childQtyToParentQty(childQty, child, parent) {
  return ((Number(childQty) || 0) * getUnitsPerChild(child)) / getPackSize(parent);
}

/** Whole child items available from `parentQty` packs of the parent. */
export function deriveChildQuantity(parentQty, parent, child) {
  const childQty = roundQty(((Number(parentQty) || 0) * getPackSize(parent)) / getUnitsPerChild(child));
  return Math.trunc(childQty) || 0;
}

/* ─── Packs and loose units, for people ────────────────────────────
   A pack's stock is stored as a count of packs, and selling a single out of
   it leaves a fraction behind: 31 cans from cartons of 24 is stored as
   1.29166… packs. That is right for the arithmetic and unreadable on a
   screen, so anything shown to or typed by a person goes through these. */

/** A product sold as a pack of several base units, whose stock is kept in packs. */
export function isPackProduct(product) {
  return product?.packType === "pack" && getPackSize(product) > 1;
}

/**
 * Split a stored pack quantity into whole packs and the loose units left over.
 * Rounds to the nearest whole unit, so float drift (1.29167 × 24 = 31.00008)
 * never shows up as a stray fraction of a can.
 *
 * @returns {{ packs: number, units: number, totalUnits: number, packSize: number }}
 */
export function splitPackQuantity(quantity, packSize) {
  const size = positiveNumber(packSize);
  const totalUnits = Math.round((Number(quantity) || 0) * size);
  const sign = totalUnits < 0 ? -1 : 1;
  const whole = Math.abs(totalUnits);
  return {
    packs: sign * Math.floor(whole / size),
    units: sign * (whole % size),
    totalUnits,
    packSize: size,
  };
}

/** Whole packs plus loose units, back into the stored pack figure. */
export function combinePackQuantity(packs, units, packSize) {
  const size = positiveNumber(packSize);
  return (Number(packs) || 0) + (Number(units) || 0) / size;
}

/**
 * A quantity the way a person reads it: "3 packs · 7 units".
 * Products that are not packs, and packs with nothing loose, read as a plain count.
 */
export function formatPackQuantity(quantity, packSize) {
  const size = positiveNumber(packSize);
  if (size <= 1) {
    const n = Number(quantity) || 0;
    return Number.isInteger(n) ? String(n) : String(roundQty(n));
  }

  const { totalUnits } = splitPackQuantity(quantity, size);
  if (totalUnits === 0) return "0";

  // Oversold stock goes below zero; one sign on the whole reads better than two.
  const packs = Math.floor(Math.abs(totalUnits) / size);
  const units = Math.abs(totalUnits) % size;
  const parts = [];
  if (packs !== 0) parts.push(`${packs} pack${packs === 1 ? "" : "s"}`);
  if (units !== 0) parts.push(`${units} unit${units === 1 ? "" : "s"}`);
  const text = parts.join(" · ");
  return totalUnits < 0 ? `-(${text})` : text;
}
