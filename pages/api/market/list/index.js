/**
 * API: /api/market/list — the next market list
 *
 * GET  — its items (low-stock items brought up to date first), each with its vendor, section and
 *        market, and the supplier vendor that already has the product on order, if any.
 * POST { productId?, name?, quantity, unit?, note?, marketId?, vendorId? } — add to it: a product
 *        from the system, or (no productId) anything typed, as an "other" item.
 */
import MarketListItem from "@/models/MarketListItem";
import { addItem, describeItems, productsOnSupplierOrder, refreshLowStock } from "@/lib/market";
import { actorName, marketRoute, sendError } from "@/lib/marketApi";

export default async function handler(req, res) {
  if (!(await marketRoute(req, res))) return;

  try {
    if (req.method === "GET") {
      const lowStock = await refreshLowStock().catch((error) => {
        // The list still opens; low-stock items catch up next time
        console.error("Market low-stock refresh failed:", error);
        return null;
      });
      const [items, onOrder, removed] = await Promise.all([
        MarketListItem.find({ open: true, dismissed: false }).sort({ createdAt: 1 }).lean(),
        productsOnSupplierOrder(),
        MarketListItem.countDocuments({ open: true, dismissed: true }),
      ]);
      return res.status(200).json({ success: true, items: await describeItems(items, { onOrder }), removed, lowStock });
    }

    if (req.method === "POST") {
      const item = await addItem({ ...(req.body || {}), addedBy: actorName(req) });
      const [described] = await describeItems([item.toObject ? item.toObject() : item], { onOrder: await productsOnSupplierOrder() });
      return res.status(201).json({ success: true, item: described });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
