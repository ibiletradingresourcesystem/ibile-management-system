/**
 * API: /api/market/history/[id] — one generated market list
 *
 * GET  — the list and its items, with vendor, section and market names.
 * POST { action: "carry-over" } — what was not bought goes back on the next list.
 */
import mongoose from "mongoose";
import MarketList from "@/models/MarketList";
import MarketListItem from "@/models/MarketListItem";
import { carryOver, describeItems } from "@/lib/market";
import { actorName, marketRoute, sendError } from "@/lib/marketApi";

export default async function handler(req, res) {
  if (!(await marketRoute(req, res))) return;
  const { id } = req.query;
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: "That market list is no longer kept" });

  try {
    const list = await MarketList.findById(id).lean();
    if (!list) return res.status(404).json({ error: "That market list is no longer kept" });

    if (req.method === "GET") {
      const items = await MarketListItem.find({ list: list._id }).sort({ createdAt: 1 }).lean();
      return res.status(200).json({ success: true, list, items: await describeItems(items) });
    }

    if (req.method === "POST" && req.body?.action === "carry-over") {
      const carried = await carryOver({ listId: list._id, addedBy: actorName(req) });
      return res.status(200).json({ success: true, carried });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
