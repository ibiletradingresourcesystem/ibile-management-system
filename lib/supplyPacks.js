/**
 * Supply packs: how a vendor sells something the shop keeps in single units.
 *
 * A vendor supplies biscuits by the carton of 30, but the catalogue keeps biscuits as
 * one product counted in units. Rather than create a second "carton" product, the
 * vendor's own price list says one pack is 30 units. Ordering from that vendor is then
 * done in packs at the pack price, and receiving puts 30 units per pack into stock.
 *
 * It only changes what the vendor pages order and what the receive screen books in.
 * Nothing else in the system sees it: the product stays a plain unit product.
 *
 * A product that is already a pack in the catalogue is left alone — it is ordered in
 * its own packs, exactly as before.
 */

export const DEFAULT_SUPPLY_PACK_LABEL = "Pack";

/** The catalogue already treats this product as a pack of several units. */
export function isCataloguePack(product) {
  return product?.packType === "pack" && (Number(product?.qtyPerPack) || 1) > 1;
}

/**
 * Units of stock in one ordered pack, for this vendor's entry for this product.
 * 1 means the order is placed in the product's own stock unit.
 */
export function getSupplyPackSize(vendorProduct, catalogueProduct = null) {
  // A catalogue pack is ordered as itself; a vendor pack size on top would double-count.
  if (isCataloguePack(catalogueProduct || vendorProduct?.product)) return 1;
  const size = Number(vendorProduct?.supplyPackSize);
  return Number.isFinite(size) && size > 1 ? Math.floor(size) : 1;
}

export function getSupplyPackLabel(vendorProduct) {
  const label = String(vendorProduct?.supplyPackLabel || "").trim();
  return label || DEFAULT_SUPPLY_PACK_LABEL;
}

/** Sanitised pack size for storing: a whole number of 1 or more. */
export function normalizeSupplyPackSize(value) {
  const size = Math.floor(Number(value));
  return Number.isFinite(size) && size > 1 ? size : 1;
}

/**
 * What an ordered line means in stock: ordering 3 packs of 30 is 90 units, and a pack
 * price of 9,000 is 300 a unit.
 */
export function orderLineToStock({ quantity, price, supplyPackSize }) {
  const packs = Number(quantity) || 0;
  const packSize = normalizeSupplyPackSize(supplyPackSize);
  const packPrice = Number(price) || 0;
  return {
    packs,
    packSize,
    stockQuantity: packs * packSize,
    unitCost: packSize > 1 ? packPrice / packSize : packPrice,
    lineTotal: packs * packPrice,
  };
}

/** "1 pack = 30 units", for a label beside an input. */
export function describeSupplyPack(vendorProduct, catalogueProduct = null) {
  const size = getSupplyPackSize(vendorProduct, catalogueProduct);
  if (size <= 1) return "";
  return `1 ${getSupplyPackLabel(vendorProduct).toLowerCase()} = ${size} units`;
}
