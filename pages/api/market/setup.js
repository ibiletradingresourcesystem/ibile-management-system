/**
 * API: /api/market/setup
 *
 * GET — every market (with its sections) and every market vendor (with the products they sell).
 */
import Market from "@/models/Market";
import MarketVendor from "@/models/MarketVendor";
import { marketRoute, sendError } from "@/lib/marketApi";

export default async function handler(req, res) {
  if (!(await marketRoute(req, res))) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const [markets, vendors] = await Promise.all([
      Market.find({}).sort({ order: 1, name: 1 }).lean(),
      MarketVendor.find({}).sort({ name: 1 }).lean(),
    ]);
    return res.status(200).json({ success: true, markets, vendors });
  } catch (error) {
    return sendError(res, error);
  }
}
