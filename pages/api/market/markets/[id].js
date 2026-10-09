/**
 * API: /api/market/markets/[id]
 *
 * PUT { name?, autoAddLowStock?, sections?: [{ _id?, name }] } — sections are sent as the whole
 *     list in order; one left out is removed, and its vendors move to "No section".
 * DELETE — only a market with no vendors left.
 */
import mongoose from "mongoose";
import Market from "@/models/Market";
import MarketVendor from "@/models/MarketVendor";
import MarketListItem from "@/models/MarketListItem";
import { marketRoute, sendError } from "@/lib/marketApi";
import { sanitizePlainText } from "@/lib/textSanitizers";

export default async function handler(req, res) {
  if (!(await marketRoute(req, res, { setup: true }))) return;
  const { id } = req.query;
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ error: "That market was not found" });

  try {
    const market = await Market.findById(id);
    if (!market) return res.status(404).json({ error: "That market was not found" });

    if (req.method === "PUT") {
      const body = req.body || {};
      if (body.name !== undefined) {
        const name = sanitizePlainText(body.name).trim().slice(0, 80);
        if (!name) return res.status(400).json({ error: "Give the market a name" });
        market.name = name;
      }
      if (typeof body.autoAddLowStock === "boolean") market.autoAddLowStock = body.autoAddLowStock;

      if (Array.isArray(body.sections)) {
        const kept = new Set();
        const sections = [];
        body.sections.forEach((section, order) => {
          const name = sanitizePlainText(section?.name || "").trim().slice(0, 80);
          if (!name) return;
          const sectionId = mongoose.isValidObjectId(section?._id) && market.sections.some((s) => String(s._id) === String(section._id))
            ? new mongoose.Types.ObjectId(String(section._id))
            : new mongoose.Types.ObjectId();
          kept.add(String(sectionId));
          sections.push({ _id: sectionId, name, order });
        });
        const removed = market.sections.filter((s) => !kept.has(String(s._id))).map((s) => s._id);
        market.sections = sections;
        if (removed.length) {
          await MarketVendor.updateMany({ market: market._id, section: { $in: removed } }, { $set: { section: null } });
        }
      }
      await market.save();
      return res.status(200).json({ success: true, market });
    }

    if (req.method === "DELETE") {
      const vendors = await MarketVendor.countDocuments({ market: market._id });
      if (vendors > 0) {
        return res.status(400).json({ error: `${market.name} still has ${vendors} vendor${vendors === 1 ? "" : "s"}. Move or delete them first.` });
      }
      // Anything on the next list for this market stays on it, for no particular market
      await MarketListItem.updateMany({ open: true, market: market._id }, { $set: { market: null } });
      await market.deleteOne();
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return sendError(res, error);
  }
}
