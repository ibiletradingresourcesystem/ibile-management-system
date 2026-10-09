/**
 * API: /api/market/list/generate
 *
 * POST { marketId? } — closes the next list (for one market, with the items not tied to any market,
 * or for all) into a generated list to take to the market. Only the latest 4 are kept.
 */
import { generateList } from "@/lib/market";
import { actorName, marketRoute, sendError } from "@/lib/marketApi";

export default async function handler(req, res) {
  if (!(await marketRoute(req, res))) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const list = await generateList({ marketId: req.body?.marketId || null, generatedBy: actorName(req) });
    return res.status(201).json({ success: true, list });
  } catch (error) {
    return sendError(res, error);
  }
}
