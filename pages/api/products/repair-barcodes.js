/**
 * API: POST /api/products/repair-barcodes
 * One-click clean-up for products that were seeded with a disjointed barcode — one code broken
 * up by spaces ("5012 3456 78901"), several codes run together, Excel artefacts ("...901.0"),
 * stray quotes, or odd spacing. A scan only finds a product when the stored code matches, so a
 * broken code makes the product unscannable.
 *
 * Body: { dryRun }   dryRun (default true) reports what would change without saving.
 *
 * - No barcode is ever removed: a code that can't be repaired is kept and reported instead.
 * - A repair that would leave two products sharing a code is skipped and listed as a conflict,
 *   so scanning never becomes ambiguous — those are fixed by hand.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { authMiddleware, isAdmin } from "@/lib/auth-middleware";
import { repairStoredBarcodes } from "@/lib/barcodes";

const MAX_SAMPLES = 50;
const BULK_CHUNK = 500;

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Only an admin can repair barcodes" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  try {
    const dryRun = req.body?.dryRun !== false;
    const products = await Product.find({ barcode: { $nin: [null, ""] } })
      .select("name barcode isArchived")
      .lean();

    // 1. Repair every product on paper, and note which codes more than one product would hold
    const repairs = products.map((product) => ({ product, repaired: repairStoredBarcodes(product.barcode) }));
    const ownersByCode = new Map();
    for (const { product, repaired } of repairs) {
      for (const code of repaired.codes) {
        const key = code.toLowerCase();
        const owners = ownersByCode.get(key) || [];
        if (!owners.some((owner) => String(owner._id) === String(product._id))) owners.push(product);
        ownersByCode.set(key, owners);
      }
    }

    // 2. Apply the repairs that keep every code unique
    const ops = [];
    const samples = [];
    const conflicts = [];
    const unrecoverable = [];
    let conflictCount = 0;
    let unrecoverableCount = 0;

    for (const { product, repaired } of repairs) {
      for (const code of repaired.unrecoverable) {
        unrecoverableCount += 1;
        if (unrecoverable.length < MAX_SAMPLES) unrecoverable.push({ name: product.name, code });
      }

      if (!repaired.changed) continue;

      const shared = repaired.codes
        .map((code) => ({ code, owners: ownersByCode.get(code.toLowerCase()) || [] }))
        .find(({ owners }) => owners.length > 1);

      if (shared) {
        conflictCount += 1;
        if (conflicts.length < MAX_SAMPLES) {
          conflicts.push({
            name: product.name,
            code: shared.code,
            conflictsWith: shared.owners
              .filter((owner) => String(owner._id) !== String(product._id))
              .map((owner) => owner.name)
              .join(", "),
          });
        }
        continue;
      }

      if (samples.length < MAX_SAMPLES) {
        samples.push({
          name: product.name,
          from: String(product.barcode ?? "").trim(),
          to: repaired.barcode,
          archived: Boolean(product.isArchived),
          warnings: repaired.warnings,
        });
      }

      ops.push({ updateOne: { filter: { _id: product._id }, update: { $set: { barcode: repaired.barcode } } } });
    }

    if (!dryRun && ops.length > 0) {
      for (let i = 0; i < ops.length; i += BULK_CHUNK) {
        await Product.bulkWrite(ops.slice(i, i + BULK_CHUNK), { ordered: false });
      }
    }

    return res.status(200).json({
      success: true,
      dryRun,
      summary: {
        scanned: products.length,
        broken: ops.length + conflictCount,
        [dryRun ? "toFix" : "fixed"]: ops.length,
        conflicts: conflictCount,
        unrecoverable: unrecoverableCount,
      },
      samples,
      conflicts,
      unrecoverable,
    });
  } catch (err) {
    console.error("Barcode repair error:", err.message);
    return res.status(500).json({ error: err.message || "Barcode repair failed" });
  }
}

export const config = { maxDuration: 60 };
