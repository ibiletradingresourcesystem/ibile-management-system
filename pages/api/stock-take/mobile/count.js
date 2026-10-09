/**
 * API: GET/PUT /api/stock-take/mobile/count
 *
 * The phone counter. It loads the count's list once and keeps it on the phone, so a scan is a
 * lookup on the phone rather than a trip to the server, and counting carries on through a weak
 * signal. Counts are sent as they are made, or queued on the phone and sent together.
 *
 * GET
 *   ?id=…&list=1[&since=…]   the whole list, compact; with `since` (the version the phone holds),
 *                             only { unchanged: true } when nothing has changed
 *   ?id=…                    header and progress only
 *   ?id=…&barcode=…          the line(s) carrying a barcode, for a product whose barcode was added
 *                             after the count was made (the phone checks its own list first)
 *   ?id=…&search=…           a short list of name/barcode matches
 *   ?id=…&itemId=…           one line
 *
 * PUT { counts: [{ itemId, countedQty }] }   save counts (a correction is just another count)
 *     { counts: [{ itemId, clear: true }] }   take a count back off: the line is uncounted again
 *
 * The system quantity, and the difference from it, go to an admin only. Anyone else counts
 * blind: what is on the shelf, not what the system expects to be there.
 */
import { mongooseConnect } from "@/lib/mongodb";
import StockTake from "@/models/StockTake";
import Product from "@/models/Product";
import { parseMobileToken as parseToken, seesSystemQty } from "@/lib/stockTakeMobile";
import { recalcSummary } from "@/lib/stockTakeCounts";

/** Most matches anyone needs to choose from on a phone screen. */
const SEARCH_LIMIT = 12;

/** A line as the phone holds it. */
function publicItem(item, withSystem) {
  if (!item) return null;
  const line = {
    _id: item._id,
    productId: item.productId,
    productName: item.productName,
    barcode: item.barcode || "",
    category: item.category || "",
    countedQty: item.countedQty ?? null,
    status: item.status,
    countType: item.countType || "standard",
    qtyPerPack: item.qtyPerPack || 0,
    countedBy: item.countedBy || "",
    countedAt: item.countedAt || null,
  };
  if (withSystem) {
    line.systemQty = item.systemQty;
    line.variance = item.variance;
  }
  return line;
}

/**
 * A barcode as it is compared. A camera reads the same code in more than one form: a UPC-A
 * (12 digits) comes back from some phones as an EAN-13 with a 0 in front, and printed codes are
 * often stored with a dash. So dashes go, and a code of digits loses its leading zeros.
 */
function barcodeKey(code) {
  const text = String(code || "").trim().toLowerCase().replace(/-/g, "");
  return /^\d+$/.test(text) ? text.replace(/^0+/, "") || "0" : text;
}

/**
 * A product can carry several barcodes in one field, comma or space separated. A pack's
 * loose-units line carries the pack's code with "-LU" on the end; scanning the pack finds both.
 */
function barcodeMatches(item, wanted) {
  if (!item.barcode) return false;
  return String(item.barcode)
    .replace(/-LU$/i, "")
    .split(/[,;\s|]+/)
    .some((code) => code && barcodeKey(code) === wanted);
}

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Lines on the count for products that carry the barcode now. A count keeps each product's
 * barcode as it was when the count was made, so a barcode added to a product since then is
 * found here instead.
 */
async function linesByProductBarcode(items, wanted) {
  if (!wanted) return [];
  const products = await Product.find({ barcode: { $regex: escapeRegex(wanted), $options: "i" } })
    .select("_id barcode")
    .limit(25)
    .lean();
  const ids = new Set(products.filter((product) => barcodeMatches(product, wanted)).map((product) => String(product._id)));
  if (ids.size === 0) return [];
  return items.filter((item) => ids.has(String(item.productId)));
}

function buildProgress(items, withSystem) {
  const total = items.length;
  let counted = 0;
  let variances = 0;
  for (const item of items) {
    if (item.countedQty !== null && item.countedQty !== undefined) {
      counted += 1;
      if (Number(item.variance || 0) !== 0) variances += 1;
    }
  }
  const progress = { total, counted, pending: total - counted };
  // How many differ from the system says something about the system count
  if (withSystem) progress.variances = variances;
  return progress;
}

/** Changes whenever a count is saved, so a phone can ask "anything new since?" cheaply. */
const versionOf = (stockTake) => String(new Date(stockTake.updatedAt || stockTake.createdAt || 0).getTime());

export default async function handler(req, res) {
  await mongooseConnect();

  const session = parseToken(req.headers.authorization);
  if (!session || !session.staffId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const withSystem = seesSystemQty(session);

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
      const { barcode, search, itemId, list, since } = req.query;

      // Nothing new since the phone's copy: answer without loading the lines
      if (list && since) {
        const head = await StockTake.findById(stockTakeId).select("updatedAt createdAt status").lean();
        if (!head) return res.status(404).json({ error: "Stock take not found" });
        if (!["draft", "in-progress"].includes(head.status)) {
          return res.status(400).json({ error: "This stock take is no longer editable", closed: true });
        }
        if (versionOf(head) === String(since)) return res.status(200).json({ success: true, unchanged: true, version: String(since) });
      }

      const stockTake = await StockTake.findById(stockTakeId).lean();
      if (!stockTake) {
        return res.status(404).json({ error: "Stock take not found" });
      }

      if (!["draft", "in-progress"].includes(stockTake.status)) {
        return res.status(400).json({ error: "This stock take is no longer editable", closed: true });
      }

      const items = Array.isArray(stockTake.items) ? stockTake.items : [];
      const header = {
        _id: stockTake._id,
        reference: stockTake.reference,
        title: stockTake.title,
        locationName: stockTake.locationName,
        status: stockTake.status,
      };
      const progress = buildProgress(items, withSystem);
      const version = versionOf(stockTake);
      const role = { seesSystemQty: withSystem };

      // ── The whole list, for the phone to keep ────────────────
      if (list) {
        return res.status(200).json({
          success: true,
          stockTake: header,
          progress,
          version,
          ...role,
          items: items.map((item) => publicItem(item, withSystem)),
        });
      }

      // ── One item by barcode ───────────────────────────────────
      if (barcode) {
        const wanted = barcodeKey(barcode);
        let matches = items.filter((item) => barcodeMatches(item, wanted));
        if (matches.length === 0) matches = await linesByProductBarcode(items, wanted);

        if (matches.length === 0) {
          return res.status(200).json({
            success: true,
            found: false,
            barcode: String(barcode).trim(),
            stockTake: header,
            progress,
            version,
          });
        }

        // The same barcode can appear twice when a product is counted both as
        // sealed packs and as loose units. Send both so the counter chooses.
        return res.status(200).json({
          success: true,
          found: true,
          barcode: String(barcode).trim(),
          items: matches.map((item) => publicItem(item, withSystem)),
          stockTake: header,
          progress,
          version,
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
          items: [publicItem(match, withSystem)],
          stockTake: header,
          progress,
          version,
        });
      }

      // ── Short search list ─────────────────────────────────────
      if (search !== undefined) {
        const term = String(search).trim().toLowerCase();
        if (term.length < 2) {
          return res.status(200).json({ success: true, items: [], truncated: false, stockTake: header, progress, version });
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
          items: matches.slice(0, SEARCH_LIMIT).map((item) => publicItem(item, withSystem)),
          truncated: matches.length > SEARCH_LIMIT,
          stockTake: header,
          progress,
          version,
        });
      }

      // ── Header and progress only ──────────────────────────────
      return res.status(200).json({ success: true, stockTake: header, progress, version, ...role });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "PUT") {
    try {
      const { counts } = req.body || {};
      // counts = [{ itemId, countedQty }] or [{ itemId, clear: true }]

      if (!Array.isArray(counts) || counts.length === 0) {
        return res.status(400).json({ error: "No counts provided" });
      }

      const stockTake = await StockTake.findById(stockTakeId);
      if (!stockTake) {
        return res.status(404).json({ error: "Stock take not found" });
      }

      if (!["draft", "in-progress"].includes(stockTake.status)) {
        return res.status(400).json({ error: "Stock take is no longer editable", closed: true });
      }

      // Update status to in-progress if still draft
      if (stockTake.status === "draft") {
        stockTake.status = "in-progress";
      }

      let updated = 0;
      const saved = [];
      const rejected = [];

      // A line sent to the manager a moment ago (mobile/send.js) moved to the sent part: a count or
      // correction made on another phone meanwhile goes there, while the manager has not approved it
      const missing = counts.some((entry) => !stockTake.items.id(entry?.itemId));
      const sentParts = missing
        ? await StockTake.find({ sentFrom: stockTake._id, status: "completed", adjustmentApplied: { $ne: true } })
        : [];
      const changedParts = new Set();

      for (const entry of counts) {
        let item = stockTake.items.id(entry?.itemId);
        if (!item) {
          const part = sentParts.find((candidate) => candidate.items.id(entry?.itemId));
          if (part && entry.clear) {
            // A sent stock take has every line counted; taking one off is the manager's call
            rejected.push({ itemId: entry.itemId, reason: "Already sent to the manager — ask them to change it" });
            continue;
          }
          if (part) {
            item = part.items.id(entry.itemId);
            changedParts.add(part);
          }
        }
        if (!item) {
          rejected.push({ itemId: entry?.itemId, reason: "Not on this stock take" });
          continue;
        }

        if (entry.clear) {
          // A count made by mistake comes off again; the line is waiting to be counted
          item.countedQty = null;
          item.variance = 0;
          item.varianceValue = 0;
          item.status = "pending";
          item.countedAt = null;
          item.countedBy = "";
          item.reason = "";
          updated++;
          saved.push(publicItem(item, withSystem));
          continue;
        }

        const qty = Number(entry.countedQty);
        if (!Number.isFinite(qty) || qty < 0) {
          rejected.push({ itemId: entry.itemId, reason: "A count must be a number of zero or more" });
          continue;
        }

        item.countedQty = qty;
        item.variance = qty - item.systemQty;
        item.varianceValue = item.variance * (item.costPrice || 0);
        item.status = "counted";
        item.countedAt = new Date();
        item.countedBy = session.staffName || "Mobile Staff";
        item.reason = item.variance !== 0 ? "Stock Take" : "";
        updated++;
        saved.push(publicItem(item, withSystem));
      }

      if (updated > 0) {
        await stockTake.save();
        for (const part of changedParts) {
          recalcSummary(part);
          await part.save();
        }
      }

      // The saved lines and fresh totals, so the phone needs no second round trip
      return res.status(200).json({
        success: true,
        updated,
        items: saved,
        rejected,
        progress: buildProgress(stockTake.items || [], withSystem),
        version: versionOf(stockTake),
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
