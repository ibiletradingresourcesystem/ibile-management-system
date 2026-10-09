/**
 * API: /api/market/list/low-stock
 *
 * POST { marketId? } — adds low-stock products from market vendors now, also for a market that has
 * automatic adding turned off. Products a supplier vendor has on order are still left out.
 */
import { refreshLowStock } from "@/lib/market";
import { marketRoute, sendError } from "@/lib/marketApi";

export default async function handler(req, res) {
  if (!(await marketRoute(req, res))) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const result = await refreshLowStock({ marketId: req.body?.marketId || null, force: true });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error);
  }
}
