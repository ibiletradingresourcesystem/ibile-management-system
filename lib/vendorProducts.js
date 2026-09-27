/**
 * A vendor's price list, and the system products it points at.
 *
 * The link to a catalogue product is stored in `product`. Forms have sent it as
 * `productId`, which the schema does not have, so mongoose dropped it and the link
 * was lost on save — the vendor looked linked on screen while the saved record only
 * had a name. Everything that writes a vendor's price list goes through here, so
 * either spelling is accepted and the link survives.
 */
import { isValidObjectId } from "mongoose";
import { sanitizePlainText } from "@/lib/textSanitizers";

export const nameKey = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

/** The catalogue product a price-list row points at, whichever field carries it. */
export function vendorProductId(row) {
  const raw = row?.product?._id || row?.product || row?.productId || null;
  const id = raw ? String(raw) : "";
  return isValidObjectId(id) ? id : null;
}

/** Price-list rows ready to save: the link kept, the text cleaned, numbers numbers. */
export function normalizeVendorProducts(products = []) {
  return (Array.isArray(products) ? products : [])
    .map((row) => {
      const linkedId = vendorProductId(row);
      const normalized = {
        productName: sanitizePlainText(row?.productName || row?.name || ""),
        price: Number(row?.price) || 0,
      };
      if (linkedId) normalized.product = linkedId;
      if (row?.packType === "pack" || row?.packType === "unit") normalized.packType = row.packType;
      if (Number(row?.qtyPerPack) > 0) normalized.qtyPerPack = Number(row.qtyPerPack);
      if (Number(row?.supplyPackSize) > 1) normalized.supplyPackSize = Math.floor(Number(row.supplyPackSize));
      if (row?.supplyPackLabel) normalized.supplyPackLabel = sanitizePlainText(row.supplyPackLabel);
      return normalized;
    })
    .filter((row) => row.productName || row.product);
}

/**
 * The product this vendor already supplies under `name` — the link if there is one.
 * Used when an order is raised, so a product the vendor is linked to is never
 * created a second time because the typed name differs.
 */
export function findVendorProductLink(vendor, name) {
  const wanted = nameKey(name);
  if (!wanted) return null;
  const rows = Array.isArray(vendor?.products) ? vendor.products : [];
  const match =
    rows.find((row) => nameKey(row?.productName || row?.name) === wanted) ||
    rows.find((row) => {
      const rowName = nameKey(row?.productName || row?.name);
      return rowName && (rowName.includes(wanted) || wanted.includes(rowName));
    });
  return match ? vendorProductId(match) : null;
}
