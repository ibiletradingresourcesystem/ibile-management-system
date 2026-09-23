/**
 * API: /api/stock-orders/merge
 *
 * Several orders to the same vendor become one, so the vendor gets a single order and
 * the delivery is received once. Lines for the same product are added together.
 *
 * POST { ids: [...] }  — merge these orders (grouped by vendor; a vendor with only
 *                        one order among them is left alone)
 * POST { all: true }   — merge every order still on order, grouped by vendor
 */
import { mongooseConnect } from "@/lib/mongodb";
import StockOrder, { isOnOrder } from "@/models/StockOrder";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { isValidObjectId } from "mongoose";
import { generateOrderRef, sumTotals } from "@/lib/purchaseOrders";

/** Merge one vendor's orders into a single set of lines. */
export function mergeOrderGroup(orders) {
  // Newest first, so the newest price for a product is the one that stands.
  const byNewest = [...orders].sort(
    (a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0)
  );

  const lines = new Map(); // product name (lowercased) -> merged line
  const repricedProducts = new Set();

  for (const order of byNewest) {
    for (const product of order.products || []) {
      const name = String(product.name || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const quantity = Number(product.quantity) || 0;
      const price = Number(product.price) || 0;

      const existing = lines.get(key);
      if (!existing) {
        lines.set(key, { productId: product.productId, name, quantity, price });
        continue;
      }
      existing.quantity += quantity;
      if (!existing.productId && product.productId) existing.productId = product.productId;
      // The newest price wins, but a difference is worth saying out loud. Named as the
      // merged line is named, so the warning matches what ends up on the order.
      if (price && existing.price && price !== existing.price) repricedProducts.add(existing.name);
    }
  }

  const products = [...lines.values()].map((line) => ({
    ...line,
    total: line.quantity * line.price,
  }));

  return { products, grandTotal: sumTotals(products), repricedProducts: [...repricedProducts] };
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  await mongooseConnect();

  try {
    const { ids, all } = req.body || {};

    let orders;
    if (Array.isArray(ids) && ids.length > 0) {
      const valid = ids.filter((id) => isValidObjectId(id));
      if (valid.length < 2) return res.status(400).json({ error: "Pick at least two orders to merge" });
      orders = await StockOrder.find({ _id: { $in: valid } }).lean();
    } else if (all) {
      orders = await StockOrder.find({}).lean();
    } else {
      return res.status(400).json({ error: "Select orders to merge, or ask to merge them all" });
    }

    const pending = orders.filter(isOnOrder);
    if (pending.length < 2) {
      return res.status(400).json({ error: "There are not two orders on order to merge" });
    }

    // Group by vendor: orders to different vendors are different deliveries.
    const groups = new Map();
    for (const order of pending) {
      const key = String(order.vendor || order.supplier || "unknown");
      groups.set(key, [...(groups.get(key) || []), order]);
    }

    const created = [];
    const warnings = [];
    let mergedCount = 0;

    for (const group of groups.values()) {
      if (group.length < 2) continue; // nothing to merge for this vendor

      const newest = group[0];
      const { products, grandTotal, repricedProducts } = mergeOrderGroup(group);
      if (products.length === 0) continue;

      const merged = await StockOrder.create({
        orderRef: generateOrderRef("SO"),
        date: new Date(),
        vendor: newest.vendor,
        supplier: newest.supplier,
        contact: newest.contact,
        location: group.every((order) => order.location === newest.location) ? newest.location : "All locations (merged)",
        mainProduct: newest.mainProduct,
        products,
        grandTotal,
        staff: req.user?.id || newest.staff || null,
        staffName: req.user?.name || "",
        notes: `Merged from ${group.length} orders`,
        stage: "Submitted",
        mergedFrom: group.map((order) => order._id),
        paymentMade: group.reduce((sum, order) => sum + (Number(order.paymentMade) || 0), 0),
        payBeforeSupply: group.some((order) => order.payBeforeSupply),
      });

      await StockOrder.deleteMany({ _id: { $in: group.map((order) => order._id) } });

      created.push(merged);
      mergedCount += group.length;
      if (repricedProducts.length > 0) {
        warnings.push(
          `${newest.supplier || "Vendor"}: ${repricedProducts.join(", ")} had different prices — the newest was used`
        );
      }
    }

    if (created.length === 0) {
      return res.status(200).json({
        success: true,
        mergedCount: 0,
        created: 0,
        message: "Nothing to merge — each vendor had only one order",
      });
    }

    return res.status(200).json({
      success: true,
      mergedCount,
      created: created.length,
      warnings,
      message: `Merged ${mergedCount} orders into ${created.length} (one per vendor)`,
    });
  } catch (err) {
    console.error("Stock order merge failed:", err);
    return res.status(500).json({ error: err.message });
  }
}
