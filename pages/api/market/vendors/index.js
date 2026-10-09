/**
 * API: /api/market/vendors
 *
 * POST { name, phone?, note?, market, section?, products?: [{ product, unit, unitSize, lastPrice, favourite }] }
 */
import MarketVendor from "@/models/MarketVendor";
import { marketRoute, sendError } from "@/lib/marketApi";
import { readVendorInput, clearOtherFavourites } from "@/lib/marketVendorInput";

export default async function handler(req, res) {
  if (!(await marketRoute(req, res, { setup: true }))) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const input = await readVendorInput(req.body);
    const vendor = await MarketVendor.create({ products: [], ...input });
    await clearOtherFavourites(vendor);
    return res.status(201).json({ success: true, vendor });
  } catch (error) {
    return sendError(res, error);
  }
}
