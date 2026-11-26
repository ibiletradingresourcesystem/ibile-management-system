/**
 * The old stored journal, on its way out.
 *
 * The books are now worked out from the records each time they are read (lib/accounting.js), so
 * the journalentries collection is no longer read or written by anything. This route lets an admin
 * see how much of it is left, download it as CSV for safe keeping, and then delete it, which frees
 * the space it takes in the database. The route can go once the collection is gone everywhere.
 *
 * GET                    → { entries, oldest, newest, sizeBytes, parts, partSize }
 * GET ?format=csv&part=N → one part of the export (PART_SIZE entries, oldest first), one row per line
 * DELETE { confirm: "DELETE" } → drops the journal and the sync state, and the journal's number counter
 *
 * Admin only (lib/apiAccess.js).
 */
import mongoose from "mongoose";
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isAdmin } from "@/lib/auth-middleware";

const JOURNAL = "journalentries";
const SYNC_STATE = "accountingsyncstates";
const COUNTERS = "counters";
const JOURNAL_COUNTER_ID = "journalEntry";

// A part stays well under the 4.5 MB a serverless response may carry
const PART_SIZE = 5000;

const CSV_COLUMNS = [
  "Entry number", "Date", "Status", "Source type", "Reference", "Description", "Location",
  "Account code", "Account name", "Debit", "Credit", "Line description", "Voided at", "Void reason",
];

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values) {
  return `${values.map(csvCell).join(",")}\r\n`;
}

async function collectionExists(db, name) {
  const found = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return found.length > 0;
}

async function storageSize(db, name) {
  try {
    const [stats] = await db.collection(name).aggregate([{ $collStats: { storageStats: {} } }]).toArray();
    const storage = stats?.storageStats || {};
    return (storage.storageSize || 0) + (storage.totalIndexSize || 0);
  } catch {
    return null; // Not every plan allows the stats; the count is enough to go on
  }
}

async function summary(db) {
  if (!(await collectionExists(db, JOURNAL))) {
    return { entries: 0, oldest: null, newest: null, sizeBytes: 0, parts: 0, partSize: PART_SIZE };
  }

  // The count from the collection's metadata and the dates off the date index: no scan, as this
  // runs each time an admin opens the chart of accounts
  const journal = db.collection(JOURNAL);
  const dateOnly = { projection: { _id: 0, date: 1 } };
  const [entries, oldest, newest, sizeBytes] = await Promise.all([
    journal.estimatedDocumentCount(),
    journal.findOne({ date: { $ne: null } }, { ...dateOnly, sort: { date: 1 } }),
    journal.findOne({ date: { $ne: null } }, { ...dateOnly, sort: { date: -1 } }),
    storageSize(db, JOURNAL),
  ]);

  return {
    entries,
    oldest: oldest?.date || null,
    newest: newest?.date || null,
    sizeBytes,
    parts: Math.ceil(entries / PART_SIZE),
    partSize: PART_SIZE,
  };
}

async function sendCsvPart(db, req, res) {
  const part = Math.max(1, parseInt(req.query.part, 10) || 1);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="journal-archive-part-${part}.csv"`);
  res.setHeader("Cache-Control", "no-store");

  if (part === 1) res.write(csvRow(CSV_COLUMNS));
  if (!(await collectionExists(db, JOURNAL))) return res.end();

  // Oldest first by id, so the parts follow on from each other without overlapping
  const cursor = db.collection(JOURNAL)
    .find({}, { projection: { syncHash: 0, __v: 0 } })
    .sort({ _id: 1 })
    .skip((part - 1) * PART_SIZE)
    .limit(PART_SIZE)
    .batchSize(500);

  let buffer = "";
  for await (const entry of cursor) {
    const lines = Array.isArray(entry.lines) && entry.lines.length > 0 ? entry.lines : [{}];
    for (const line of lines) {
      buffer += csvRow([
        entry.entryNumber, entry.date, entry.status, entry.referenceType, entry.reference, entry.description, entry.location,
        line.accountCode, line.accountName, line.debit, line.credit, line.description, entry.voidedAt, entry.voidReason,
      ]);
    }
    if (buffer.length > 64 * 1024) {
      res.write(buffer);
      buffer = "";
    }
  }
  res.end(buffer);
}

async function deleteJournal(db) {
  const dropped = [];
  for (const name of [JOURNAL, SYNC_STATE]) {
    if (await collectionExists(db, name)) {
      await db.collection(name).drop();
      dropped.push(name);
    }
  }
  // Only the journal's own number; other counters in the collection are left alone
  const counter = await db.collection(COUNTERS).deleteOne({ _id: JOURNAL_COUNTER_ID });
  return { dropped, counterRemoved: counter.deletedCount > 0 };
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isAdmin(req)) return res.status(403).json({ success: false, message: "Admin access required" });

  await mongooseConnect();
  const db = mongoose.connection.db;

  try {
    if (req.method === "GET") {
      if (req.query.format === "csv") return await sendCsvPart(db, req, res);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ success: true, ...(await summary(db)) });
    }

    if (req.method === "DELETE") {
      if (req.body?.confirm !== "DELETE") {
        return res.status(400).json({ success: false, message: 'Send { confirm: "DELETE" } to delete the old journal' });
      }
      const result = await deleteJournal(db);
      return res.status(200).json({ success: true, ...result, message: result.dropped.length ? "The old journal has been deleted" : "There was no old journal to delete" });
    }

    res.setHeader("Allow", ["GET", "DELETE"]);
    return res.status(405).json({ success: false, message: "Method not allowed" });
  } catch (error) {
    console.error("Journal archive error:", error);
    if (res.headersSent) return res.end();
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
}
