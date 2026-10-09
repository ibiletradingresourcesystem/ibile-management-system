/**
 * API: /api/market/history
 *
 * GET — the generated market lists kept (the latest 4), newest first, with how far each got.
 */
import MarketList from "@/models/MarketList";
import MarketListItem from "@/models/MarketListItem";
import { marketRoute, sendError } from "@/lib/marketApi";

export default async function handler(req, res) {
  if (!(await marketRoute(req, res))) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const lists = await MarketList.find({}).sort({ createdAt: -1, number: -1 }).lean();
    const counts = await MarketListItem.aggregate([
      { $match: { list: { $in: lists.map((list) => list._id) } } },
      { $group: { _id: { list: "$list", status: "$status" }, count: { $sum: 1 } } },
    ]);
    const tally = new Map();
    for (const { _id, count } of counts) {
      const key = String(_id.list);
      tally.set(key, { ...(tally.get(key) || {}), [_id.status]: count });
    }
    return res.status(200).json({
      success: true,
      lists: lists.map((list) => ({ ...list, counts: tally.get(String(list._id)) || {} })),
    });
  } catch (error) {
    return sendError(res, error);
  }
}
