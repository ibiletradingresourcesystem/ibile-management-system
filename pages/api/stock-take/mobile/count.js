/**
 * API: GET/PUT /api/stock-take/mobile/count
 * GET: Returns stock take details + items for the mobile counter
 * PUT: Submits counted quantities from the mobile counter
 */
import { mongooseConnect } from "@/lib/mongodb";
import StockTake from "@/models/StockTake";
import { verifyToken } from "@/lib/jwt";

const MOBILE_SCOPE = "stock-take-mobile";

/** The signed token issued by /api/stock-take/mobile/auth. */
function parseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const session = verifyToken(authHeader.slice(7));
  return session && session.scope === MOBILE_SCOPE ? session : null;
}

export default async function handler(req, res) {
  await mongooseConnect();

  const session = parseToken(req.headers.authorization);
  if (!session || !session.staffId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const stockTakeId = req.query.id || session.stockTakeId;
  if (!stockTakeId) {
    return res.status(400).json({ error: "Stock take ID is required" });
  }
  // A sign-in for one count can't be reused on another
  if (session.stockTakeId && String(session.stockTakeId) !== String(stockTakeId)) {
    return res.status(403).json({ error: "This sign-in is for a different stock take" });
  }

  if (req.method === "GET") {
    try {
      const stockTake = await StockTake.findById(stockTakeId).lean();
      if (!stockTake) {
        return res.status(404).json({ error: "Stock take not found" });
      }

      if (!["draft", "in-progress"].includes(stockTake.status)) {
        return res.status(400).json({ error: "This stock take is no longer editable" });
      }

      return res.status(200).json({
        success: true,
        stockTake: {
          _id: stockTake._id,
          reference: stockTake.reference,
          title: stockTake.title,
          locationName: stockTake.locationName,
          status: stockTake.status,
          items: (stockTake.items || []).map((item) => ({
            _id: item._id,
            productId: item.productId,
            productName: item.productName,
            barcode: item.barcode || "",
            systemQty: item.systemQty,
            countedQty: item.countedQty,
            variance: item.variance,
            status: item.status,
            countType: item.countType || "standard",
          })),
        },
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "PUT") {
    try {
      const { counts } = req.body || {};
      // counts = [{ itemId, countedQty }]

      if (!Array.isArray(counts) || counts.length === 0) {
        return res.status(400).json({ error: "No counts provided" });
      }

      const stockTake = await StockTake.findById(stockTakeId);
      if (!stockTake) {
        return res.status(404).json({ error: "Stock take not found" });
      }

      if (!["draft", "in-progress"].includes(stockTake.status)) {
        return res.status(400).json({ error: "Stock take is no longer editable" });
      }

      // Update status to in-progress if still draft
      if (stockTake.status === "draft") {
        stockTake.status = "in-progress";
      }

      let updated = 0;
      for (const { itemId, countedQty } of counts) {
        const item = stockTake.items.id(itemId);
        if (!item) continue;

        const qty = Number(countedQty);
        if (!Number.isFinite(qty) || qty < 0) continue;

        item.countedQty = qty;
        item.variance = qty - item.systemQty;
        item.varianceValue = item.variance * (item.costPrice || 0);
        item.status = "counted";
        item.countedAt = new Date();
        item.countedBy = session.staffName || "Mobile Staff";
        item.reason = item.variance !== 0 ? "Stock Take" : "";
        updated++;
      }

      if (updated > 0) {
        await stockTake.save();
      }

      return res.status(200).json({ success: true, updated });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
