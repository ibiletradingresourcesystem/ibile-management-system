/**
 * API: /api/market/vendors/[id]
 *
 * PUT — any of the fields POST takes; `products` replaces the whole list.
 * DELETE — the vendor goes; what was on the next list under them stays, waiting for another vendor.
 */
import mongoose from "mongoose";
import MarketVendor from "@/models/MarketVendor";
import MarketListItem from "@/models/MarketListItem";
import { marketRoute, sendError } from "@/lib/marketApi";
import { readVendorInput, clearOtherFavourites } from "@/lib/marketVendorInput";

export default async function handler(req, res) {
  if (!(await marketRoute(req, res, { setup: true }))) return;
  const { id } = req.query;
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: "That market vendor was not found" });

  try {
    const vendor = await MarketVendor.findById(id);
    if (!vendor) return res.status(404).json({ error: "That market vendor was not found" });

    if (req.method === "PUT") {
      const input = await readVendorInput(req.body, { partial: true });
      const movedMarket = input.market && String(input.market) !== String(vendor.market);
      vendor.set(input);
      await vendor.save();
      await clearOtherFavourites(vendor);
      // Items on the next list under this vendor go with them to their new market
      if (movedMarket) await MarketListItem.updateMany({ open: true, vendor: vendor._id }, { $set: { market: vendor.market } });
      return res.status(200).json({ success: true, vendor });
    }

    if (req.method === "DELETE") {
      await MarketListItem.updateMany({ open: true, vendor: vendor._id }, { $set: { vendor: null } });
      await vendor.deleteOne();
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
