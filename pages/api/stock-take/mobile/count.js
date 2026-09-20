/**
 * API: GET/PUT /api/stock-take/mobile/count
 *
 * The mobile counter used to pull every line of the stock take in one response.
 * On a full count that is thousands of products on a phone, over whatever
 * connection the shop floor has. Nothing needs them all at once: the counter
 * scans one barcode and enters one quantity.
 *
 * GET now answers three narrow questions instead:
 *   ?id=…                    → header and progress totals, no items
 *   ?id=…&barcode=…          → the one item carrying that barcode
 *   ?id=…&search=…           → a short list of name/barcode matches
 *   ?id=…&itemId=…           → one item by id, to refresh after saving
 *
 * PUT submits counted quantities, unchanged.
 */
import { mongooseConnect } from "@/lib/mongodb";
import StockTake from "@/models/StockTake";
import { verifyToken } from "@/lib/jwt";

const MOBILE_SCOPE = "stock-take-mobile";

/** Most matches anyone needs to choose from on a phone screen. */
const SEARCH_LIMIT = 12;

/** The signed token issued by /api/stock-take/mobile/auth. */
function parseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const session = verifyToken(authHeader.slice(7));
  return session && session.scope === MOBILE_SCOPE ? session : null;
}

/** Only the fields the counting screen shows. */
function publicItem(item) {
  if (!item) return null;
  return {
    _id: item._id,
    productId: item.productId,
    productName: item.productName,
    barcode: item.barcode || "",
    category: item.category || "",
    systemQty: item.systemQty,
    countedQty: item.countedQty,
    variance: item.variance,
    status: item.status,
    countType: item.countType || "standard",
    countedBy: item.countedBy || "",
    countedAt: item.countedAt || null,
  };
}

/** A product can carry several barcodes in one field, comma or space separated. */
function barcodeMatches(item, wanted) {
  if (!item.barcode) return false;
  return String(item.barcode)
    .split(/[,;\s|]+/)
    .some((code) => code.trim().toLowerCase() === wanted);
}

function buildProgress(items) {
  const total = items.length;
  let counted = 0;
  let variances = 0;
  for (const item of items) {
    if (item.countedQty !== null && item.countedQty !== undefined) {
      counted += 1;
      if (Number(item.variance || 0) !== 0) variances += 1;
    }
  }
  return { total, counted, pending: total - counted, variances };
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

      const items = Array.isArray(stockTake.items) ? stockTake.items : [];
      const header = {
        _id: stockTake._id,
        reference: stockTake.reference,
        title: stockTake.title,
        locationName: stockTake.locationName,
        status: stockTake.status,
      };
      const progress = buildProgress(items);

      const { barcode, search, itemId } = req.query;

      // ── One item by barcode ───────────────────────────────────
      if (barcode) {
        const wanted = String(barcode).trim().toLowerCase();
        const matches = items.filter((item) => barcodeMatches(item, wanted));

        if (matches.length === 0) {
          return res.status(200).json({
            success: true,
            found: false,
            barcode: String(barcode).trim(),
            stockTake: header,
            progress,
          });
        }

        // The same barcode can appear twice when a product is counted both as
        // sealed packs and as loose units. Send both so the counter chooses.
        return res.status(200).json({
          success: true,
          found: true,
          barcode: String(barcode).trim(),
          items: matches.map(publicItem),
          stockTake: header,
          progress,
        });
      }

      // ── One item by id ────────────────────────────────────────
      if (itemId) {
        const match = items.find((item) => String(item._id) === String(itemId));
        if (!match) {
          return res.status(404).json({ error: "Item not found on this stock take" });
        }
        return res.status(200).json({
          success: true,
          found: true,
          items: [publicItem(match)],
          stockTake: header,
          progress,
        });
      }

      // ── Short search list ─────────────────────────────────────
      if (search !== undefined) {
        const term = String(search).trim().toLowerCase();
        if (term.length < 2) {
          return res.status(200).json({
            success: true,
            items: [],
            truncated: false,
            stockTake: header,
            progress,
          });
        }

        const matches = [];
        for (const item of items) {
          const name = String(item.productName || "").toLowerCase();
          const code = String(item.barcode || "").toLowerCase();
          if (name.includes(term) || code.includes(term)) {
            matches.push(item);
            // Stop early: there is no point scanning the rest of a large count
            // once the phone already has more rows than it will show.
            if (matches.length > SEARCH_LIMIT) break;
          }
        }

        return res.status(200).json({
          success: true,
          items: matches.slice(0, SEARCH_LIMIT).map(publicItem),
          truncated: matches.length > SEARCH_LIMIT,
          stockTake: header,
          progress,
        });
      }

      // ── Header and progress only ──────────────────────────────
      return res.status(200).json({
        success: true,
        stockTake: header,
        progress,
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
      const saved = [];

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
        saved.push(publicItem(item));
      }

      if (updated > 0) {
        await stockTake.save();
      }

      // Return the saved rows and fresh totals so the phone does not need a
      // second round trip to refresh its progress bar.
      return res.status(200).json({
        success: true,
        updated,
        items: saved,
        progress: buildProgress(stockTake.items || []),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
