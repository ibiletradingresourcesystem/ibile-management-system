/**
 * API: /api/market/markets
 *
 * POST { name, sections?: [name] } — a new market, with its sections if given.
 */
import Market from "@/models/Market";
import { marketRoute, sendError } from "@/lib/marketApi";
import { sanitizePlainText } from "@/lib/textSanitizers";

export default async function handler(req, res) {
  if (!(await marketRoute(req, res, { setup: true }))) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const name = sanitizePlainText(req.body?.name || "").trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: "Give the market a name" });
    const sections = (Array.isArray(req.body?.sections) ? req.body.sections : [])
      .map((section) => sanitizePlainText(typeof section === "string" ? section : section?.name || "").trim().slice(0, 80))
      .filter(Boolean)
      .map((sectionName, order) => ({ name: sectionName, order }));
    const count = await Market.countDocuments({});
    const market = await Market.create({ name, sections, order: count });
    return res.status(201).json({ success: true, market });
  } catch (error) {
    return sendError(res, error);
  }
}
