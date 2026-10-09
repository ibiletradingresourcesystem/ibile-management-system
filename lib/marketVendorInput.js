/**
 * A market vendor as the setup form sends it, made safe to save: names trimmed, the market and
 * section checked against each other, and one line per product.
 */
import mongoose from "mongoose";
import Market from "@/models/Market";
import MarketVendor from "@/models/MarketVendor";
import Product from "@/models/Product";
import { MarketError } from "@/lib/market";
import { sanitizePlainText } from "@/lib/textSanitizers";

const text = (value, max) => sanitizePlainText(value || "").trim().slice(0, max);
const money = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0;
};

export async function readVendorInput(body = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    out.name = text(body.name, 80);
    if (!out.name) throw new MarketError("Give the vendor a name, even just \"Vendor 1\"");
  }
  if (body.phone !== undefined) out.phone = text(body.phone, 40);
  if (body.note !== undefined) out.note = text(body.note, 200);
  if (typeof body.isActive === "boolean") out.isActive = body.isActive;

  if (!partial || body.market !== undefined || body.section !== undefined) {
    if (!mongoose.isValidObjectId(body.market)) throw new MarketError("Pick the market this vendor is in");
    const market = await Market.findById(body.market).lean();
    if (!market) throw new MarketError("That market was not found", 404);
    out.market = market._id;
    const section = body.section ? market.sections.find((s) => String(s._id) === String(body.section)) : null;
    out.section = section ? section._id : null;
  }

  if (Array.isArray(body.products)) {
    const ids = [...new Set(body.products.map((line) => String(line?.product || line?.productId || "")).filter(mongoose.isValidObjectId))];
    const products = await Product.find({ _id: { $in: ids } }).select("name").lean();
    const nameById = new Map(products.map((p) => [String(p._id), p.name]));
    const seen = new Set();
    out.products = [];
    for (const line of body.products) {
      const id = String(line?.product || line?.productId || "");
      if (!nameById.has(id) || seen.has(id)) continue;
      seen.add(id);
      const unitSize = Number(line.unitSize);
      out.products.push({
        product: id,
        productName: nameById.get(id),
        unit: text(line.unit, 30),
        unitSize: Number.isFinite(unitSize) && unitSize > 0 ? unitSize : 1,
        lastPrice: money(line.lastPrice),
        favourite: Boolean(line.favourite),
      });
    }
  }
  return out;
}

/** A product marked favourite here is no longer the favourite of any other market vendor. */
export async function clearOtherFavourites(vendor) {
  for (const line of vendor.products || []) {
    if (!line.favourite) continue;
    await MarketVendor.updateMany(
      { _id: { $ne: vendor._id }, "products.product": line.product },
      { $set: { "products.$[line].favourite": false } },
      { arrayFilters: [{ "line.product": line.product }] }
    );
  }
}
