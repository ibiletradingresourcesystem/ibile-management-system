/**
 * API: /api/market/list/[itemId] — one thing to buy, on the next list or on a generated one
 *
 * PUT { quantity?, unit?, note?, name? (other items), vendorId? + rememberVendor?, productId?, status? }
 *   - vendorId: buy it from this vendor; with rememberVendor (or when it had none) the product
 *     goes to them on every list from now on
 *   - productId: an "other" item that has been made a product in the system
 *   - status: "bought", "unavailable" or "pending", ticked at the market
 * DELETE — off the list. A low-stock item is only hidden, so it is not added straight back.
 */
import mongoose from "mongoose";
import MarketListItem from "@/models/MarketListItem";
import MarketVendor from "@/models/MarketVendor";
import Product from "@/models/Product";
import { describeItems, linkProductToVendor, MarketError, productsOnSupplierOrder, vendorsByProduct } from "@/lib/market";
import { marketRoute, sendError } from "@/lib/marketApi";
import { sanitizePlainText } from "@/lib/textSanitizers";

const text = (value, max) => sanitizePlainText(value || "").trim().slice(0, max);

export default async function handler(req, res) {
  if (!(await marketRoute(req, res))) return;
  const { itemId } = req.query;
  if (!mongoose.isValidObjectId(itemId)) return res.status(404).json({ error: "That item is no longer on the list" });

  try {
    let item = await MarketListItem.findById(itemId);
    if (!item) return res.status(404).json({ error: "That item is no longer on the list" });

    if (req.method === "DELETE") {
      if (item.open && item.source === "low-stock") {
        item.dismissed = true;
        await item.save();
      } else {
        await item.deleteOne();
      }
      return res.status(200).json({ success: true });
    }

    if (req.method !== "PUT") return res.status(405).json({ error: "Method not allowed" });
    const body = req.body || {};

    if (body.quantity !== undefined) {
      const quantity = Number(body.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new MarketError("Enter a quantity above 0");
      item.quantity = Math.round(quantity * 100) / 100;
      // A person changed it: the low-stock check no longer takes it off
      item.source = "staff";
    }
    if (body.unit !== undefined) item.unit = text(body.unit, 30);
    if (body.note !== undefined) item.note = text(body.note, 200);
    if (body.name !== undefined && !item.product) {
      const name = text(body.name, 120);
      if (!name) throw new MarketError("Type what to buy");
      item.name = name;
    }
    if (body.status !== undefined) {
      if (!["pending", "bought", "unavailable"].includes(body.status)) throw new MarketError("Unknown status");
      item.status = body.status;
    }

    if (body.vendorId !== undefined) {
      if (!body.vendorId) {
        item.vendor = null;
      } else {
        if (!mongoose.isValidObjectId(body.vendorId)) throw new MarketError("That market vendor was not found", 404);
        const vendor = await MarketVendor.findById(body.vendorId).select("market products").lean();
        if (!vendor) throw new MarketError("That market vendor was not found", 404);
        const hadVendor = Boolean(item.vendor);
        item.vendor = vendor._id;
        item.market = vendor.market;
        if (item.product) {
          await linkProductToVendor({
            vendorId: vendor._id,
            productId: item.product,
            productName: item.name,
            unit: item.unit,
            favourite: Boolean(body.rememberVendor) || !hadVendor,
          });
        }
      }
    }

    if (body.productId !== undefined && !item.product) {
      if (!mongoose.isValidObjectId(body.productId)) throw new MarketError("That product was not found", 404);
      const product = await Product.findById(body.productId).select("name").lean();
      if (!product) throw new MarketError("That product was not found", 404);
      item.name = product.name;
      if (item.vendor) {
        await linkProductToVendor({ vendorId: item.vendor, productId: product._id, productName: product.name, unit: item.unit, favourite: true });
      }
      const duplicate = item.open ? await MarketListItem.findOne({ open: true, product: product._id, _id: { $ne: item._id } }) : null;
      if (duplicate) {
        // Already on the next list as a product: one line, with both quantities
        duplicate.quantity = Math.round((duplicate.quantity + item.quantity) * 100) / 100;
        duplicate.dismissed = false;
        duplicate.source = "staff";
        await duplicate.save();
        await item.deleteOne();
        item = duplicate;
      } else {
        item.product = product._id;
        // A product that already has a market vendor goes under them
        if (!item.vendor) {
          const placement = vendorsByProduct(await MarketVendor.find({ isActive: { $ne: false } }).lean()).get(String(product._id));
          if (placement) {
            item.vendor = placement.vendor._id;
            item.market = placement.vendor.market;
          }
        }
      }
    }

    await item.save();
    const [described] = await describeItems([item.toObject()], { onOrder: item.open ? await productsOnSupplierOrder() : null });
    return res.status(200).json({ success: true, item: described });
  } catch (error) {
    return sendError(res, error);
  }
}
