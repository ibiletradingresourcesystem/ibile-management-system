/**
 * API: POST /api/stock-take/mobile/send?id=…
 *
 * Sends a stock take to the manager from the phone — also part-way through. The counted lines go
 * for review now; the rest stay where they are, on the same link, to be counted later.
 *
 * - Everything counted: the stock take itself is completed (it moves to the manager's review).
 * - Some counted: the counted lines become a stock take of their own, completed and awaiting
 *   the manager (sentFrom points back here); this one keeps the lines not counted yet.
 *
 * A pack + each product goes only when both of its lines are counted, so a half-counted one is
 * never sent with its other half read as 0. Lines not counted are not sent and their stock is not
 * touched. Approving and applying stay with the manager, on the desktop.
 */
import mongoose from "mongoose";
import { mongooseConnect } from "@/lib/mongodb";
import StockTake from "@/models/StockTake";
import { parseMobileToken } from "@/lib/stockTakeMobile";
import { generateStockTakeRef, groupByProduct, isCounted, recalcSummary } from "@/lib/stockTakeCounts";

class SendError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const when = (date) =>
  date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  await mongooseConnect();

  const session = parseMobileToken(req.headers.authorization);
  if (!session?.staffId) return res.status(401).json({ error: "Not authenticated" });
  const stockTakeId = req.query.id || session.stockTakeId;
  if (!stockTakeId || !mongoose.isValidObjectId(stockTakeId)) return res.status(400).json({ error: "Stock take ID is required" });
  if (session.stockTakeId && String(session.stockTakeId) !== String(stockTakeId)) {
    return res.status(403).json({ error: "This sign-in is for a different stock take" });
  }
  const by = session.staffName || "Mobile Staff";

  const dbSession = await mongoose.startSession();
  try {
    let result = null;
    await dbSession.withTransaction(async () => {
      const stockTake = await StockTake.findById(stockTakeId).session(dbSession);
      if (!stockTake) throw new SendError("Stock take not found", 404);
      if (!["draft", "in-progress"].includes(stockTake.status)) {
        throw new SendError("This stock take has already been sent or closed", 400, { closed: true });
      }

      // Whole products only: every line of a product counted, or none of it goes
      const ready = new Set();
      let halfCounted = 0;
      for (const [productId, lines] of groupByProduct(stockTake.items || [])) {
        if (lines.every(isCounted)) ready.add(productId);
        else if (lines.some(isCounted)) halfCounted += 1;
      }
      const sending = stockTake.items.filter((item) => ready.has(String(item.productId)));
      const staying = stockTake.items.filter((item) => !ready.has(String(item.productId)));

      if (sending.length === 0) {
        throw new SendError(
          halfCounted
            ? `Nothing is ready to send: ${halfCounted} pack + each product${halfCounted === 1 ? " has" : "s have"} only one of its lines counted.`
            : "Nothing has been counted yet."
        );
      }

      const now = new Date();
      if (staying.length === 0) {
        stockTake.status = "completed";
        stockTake.completedAt = now;
        stockTake.sentBy = by;
        stockTake.sentAt = now;
        recalcSummary(stockTake);
        await stockTake.save({ session: dbSession });
        result = { whole: true, sent: sending.length, left: 0, reference: stockTake.reference, halfCounted: 0 };
        return;
      }

      const part = new StockTake({
        reference: generateStockTakeRef(),
        title: `${stockTake.title} (counted part)`,
        description:
          `Sent from a phone by ${by} on ${when(now)}: ${sending.length} of ${stockTake.items.length} lines counted. ` +
          `The other ${staying.length} stay on ${stockTake.reference} to be counted.`,
        locationId: stockTake.locationId,
        locationName: stockTake.locationName,
        type: stockTake.type,
        category: stockTake.category,
        items: sending.map((item) => item.toObject()),
        status: "completed",
        createdBy: stockTake.createdBy,
        startedAt: stockTake.startedAt || now,
        completedAt: now,
        sentFrom: stockTake._id,
        sentBy: by,
        sentAt: now,
      });
      recalcSummary(part);
      await part.save({ session: dbSession });

      stockTake.items = staying.map((item) => item.toObject());
      if (stockTake.status === "draft") stockTake.status = "in-progress";
      stockTake.sentParts.push({ stockTake: part._id, reference: part.reference, lines: sending.length, by, at: now });
      recalcSummary(stockTake);
      await stockTake.save({ session: dbSession });

      result = { whole: false, sent: sending.length, left: staying.length, reference: part.reference, halfCounted };
    });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    if (error instanceof SendError) return res.status(error.status).json({ error: error.message, ...error.extra });
    console.error("Stock take send failed:", error);
    return res.status(500).json({ error: "Could not send the stock take. Try again." });
  } finally {
    await dbSession.endSession();
  }
}
