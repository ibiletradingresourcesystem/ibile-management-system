/**
 * API: /api/products/bulk
 *
 * Archive, restore or permanently delete several products in one go — what the
 * archived list and the stock management page need when a whole batch of dead
 * products has to be cleared out one checkbox at a time.
 *
 * POST { ids: [...], action: "archive" | "restore" | "delete" }
 */
import { mongooseConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { authMiddleware, isStaff, isAdmin } from "@/lib/auth-middleware";
import { archiveFields, restoreFields } from "@/lib/productArchive";
import { deriveChildrenForParent } from "@/lib/syncPackQty";
import { deleteProductImages } from "@/lib/s3";
import { isValidObjectId } from "mongoose";

const MAX_IDS = 500;

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { ids, action, reason } = req.body || {};
  const validIds = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => isValidObjectId(id));

  if (validIds.length === 0) return res.status(400).json({ error: "Select at least one product" });
  if (validIds.length > MAX_IDS) return res.status(400).json({ error: `Too many products at once (limit ${MAX_IDS})` });
  if (!["archive", "restore", "delete"].includes(action)) {
    return res.status(400).json({ error: "Unknown action" });
  }
  // Permanent deletion is irreversible, so it stays an administrator's job.
  if (action === "delete" && !isAdmin(req)) {
    return res.status(403).json({ error: "Only an administrator can permanently delete products" });
  }

  await mongooseConnect();

  try {
    const products = await Product.find({ _id: { $in: validIds } })
      .select("_id name images showOnWeb archivedShowOnWeb isArchived packType")
      .lean();

    if (products.length === 0) return res.status(404).json({ error: "None of those products could be found" });

    if (action === "delete") {
      await Product.deleteMany({ _id: { $in: products.map((p) => p._id) } });
      // Image cleanup must not hold up the response, or fail the delete.
      const images = products.flatMap((product) => product.images || []);
      if (images.length > 0) {
        deleteProductImages(images).catch((err) =>
          console.error("[Products] image cleanup after bulk delete failed:", err.message)
        );
      }
      return res.status(200).json({
        success: true,
        count: products.length,
        message: `${products.length} product${products.length === 1 ? "" : "s"} permanently deleted`,
      });
    }

    // Archive and restore both depend on the product's own previous state, so each
    // one gets its own update rather than a single blanket $set.
    const operations = products.map((product) => {
      const fields = action === "archive" ? archiveFields(product, reason || "bulk-archive") : restoreFields(product);
      const set = { ...fields };
      const unset = {};
      for (const [key, value] of Object.entries(set)) {
        if (value === undefined) {
          delete set[key];
          unset[key] = "";
        }
      }
      return {
        updateOne: {
          filter: { _id: product._id },
          update: Object.keys(unset).length > 0 ? { $set: set, $unset: unset } : { $set: set },
        },
      };
    });

    await Product.bulkWrite(operations);

    // A pack's children take their stock from it, so they follow it in or out.
    for (const product of products.filter((p) => p.packType === "pack")) {
      try {
        await deriveChildrenForParent(product._id);
      } catch (err) {
        console.warn("deriveChildrenForParent failed after bulk change:", err.message);
      }
    }

    return res.status(200).json({
      success: true,
      count: products.length,
      message:
        action === "archive"
          ? `${products.length} product${products.length === 1 ? "" : "s"} archived and hidden from the till and the web shop`
          : `${products.length} product${products.length === 1 ? "" : "s"} restored`,
    });
  } catch (err) {
    console.error("Bulk product action failed:", err);
    return res.status(500).json({ error: err.message });
  }
}
