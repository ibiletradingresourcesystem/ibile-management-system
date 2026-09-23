/**
 * API: /api/purchase-orders/seed-import
 *
 * Reads the file the expense app's "Download Data" button produces and seeds it here.
 * It replaces the old Sync Stock Orders, which could only work while both apps shared
 * one database and copied every stock movement in whether or not it belonged.
 *
 * Each record carries the id it had in the expense app, so importing the same file
 * twice adds nothing the second time.
 *
 * POST { data, preview: true }  — say what would happen, change nothing
 * POST { data }                 — import
 */
import { mongooseConnect } from "@/lib/mongodb";
import PurchaseOrder from "@/models/PurchaseOrder";
import Product from "@/models/Product";
import StockOrder from "@/models/StockOrder";
import Vendor from "@/models/Vendor";
import { authMiddleware, isAdmin } from "@/lib/auth-middleware";
import {
  derivePaymentStatus,
  generateOrderRef,
  normalizeOrderProducts,
  sumTotals,
} from "@/lib/purchaseOrders";

const SOURCE_APP = "ibile-expense-app";
const nameKey = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();

/** What the file must look like before anything is read out of it. */
export function validateExport(data) {
  if (!data || typeof data !== "object") return "That file is not an export file";
  if (data.source && data.source !== SOURCE_APP) return `That file came from "${data.source}", not the expense app`;
  if (!Array.isArray(data.vendors) && !Array.isArray(data.stockOrders)) {
    return "That file has no vendors and no stock orders in it";
  }
  if (data.version && Number(data.version) > 1) {
    return `That file is version ${data.version}; this app reads version 1. Update the inventory app.`;
  }
  return "";
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  // Seeding writes vendors and orders in bulk, so it is an administrator's job.
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { data, preview = false } = req.body || {};
  const invalid = validateExport(data);
  if (invalid) return res.status(400).json({ error: invalid });

  await mongooseConnect();

  try {
    const fileVendors = Array.isArray(data.vendors) ? data.vendors : [];
    const fileOrders = Array.isArray(data.stockOrders) ? data.stockOrders : [];

    /* ─── Vendors: matched by name, created when missing ───────────── */
    const existingVendors = await Vendor.find({}).select("_id companyName repPhone").lean();
    const vendorIdByName = new Map(existingVendors.map((vendor) => [nameKey(vendor.companyName), String(vendor._id)]));
    // The expense app's own vendor id, so an order can find its vendor.
    const vendorIdBySourceId = new Map();

    const vendorsToCreate = [];
    for (const vendor of fileVendors) {
      const key = nameKey(vendor.companyName);
      if (!key) continue;
      if (vendorIdByName.has(key)) {
        vendorIdBySourceId.set(String(vendor.sourceId), vendorIdByName.get(key));
        continue;
      }
      if (vendorsToCreate.some((pending) => nameKey(pending.companyName) === key)) continue;
      vendorsToCreate.push(vendor);
    }

    /* ─── Orders: received ones become purchase orders, the rest stay on order ─── */
    const sourceIds = fileOrders.map((order) => String(order.sourceId)).filter(Boolean);
    const [seededPurchaseOrders, seededStockOrders] = await Promise.all([
      PurchaseOrder.find({ sourceId: { $in: sourceIds } }).select("sourceId").lean(),
      StockOrder.find({ sourceId: { $in: sourceIds } }).select("sourceId").lean(),
    ]);
    const alreadySeeded = new Set([
      ...seededPurchaseOrders.map((order) => order.sourceId),
      ...seededStockOrders.map((order) => order.sourceId),
    ]);

    const newOrders = fileOrders.filter((order) => order.sourceId && !alreadySeeded.has(String(order.sourceId)));
    const skipped = fileOrders.length - newOrders.length;
    const toReceive = newOrders.filter((order) => order.received);
    const toOrder = newOrders.filter((order) => !order.received);

    const summary = {
      vendors: { inFile: fileVendors.length, toCreate: vendorsToCreate.length, matched: fileVendors.length - vendorsToCreate.length },
      orders: {
        inFile: fileOrders.length,
        alreadySeeded: skipped,
        purchaseOrders: toReceive.length,
        stockOrders: toOrder.length,
      },
      exportedAt: data.exportedAt || "",
    };

    if (preview) {
      return res.status(200).json({ success: true, preview: true, summary });
    }

    /* ─── Write ───────────────────────────────────────────────────── */
    if (vendorsToCreate.length > 0) {
      // A vendor's price list is carried over by product name: the two apps keep their
      // own product records, so an id from the file means nothing here.
      const productNames = [...new Set(vendorsToCreate.flatMap((v) => (v.products || []).map((p) => nameKey(p.name))))];
      const products = productNames.length > 0
        ? await Product.find({ isArchived: { $ne: true } }).select("_id name").lean()
        : [];
      const productIdByName = new Map(products.map((product) => [nameKey(product.name), product._id]));

      const created = await Vendor.insertMany(
        vendorsToCreate.map((vendor) => ({
          companyName: vendor.companyName,
          vendorRep: vendor.vendorRep || "",
          repPhone: vendor.repPhone || "",
          email: vendor.email || "",
          address: vendor.address || "",
          mainProduct: vendor.mainProduct || "",
          businessCategory: vendor.businessCategory || "",
          bankName: vendor.bankName || "",
          accountName: vendor.accountName || "",
          accountNumber: vendor.accountNumber || "",
          products: (vendor.products || [])
            .filter((entry) => entry?.name)
            .map((entry) => ({
              product: productIdByName.get(nameKey(entry.name)) || undefined,
              productName: entry.name,
              price: Number(entry.price) || 0,
            })),
        })),
        { ordered: false }
      );
      created.forEach((vendor) => vendorIdByName.set(nameKey(vendor.companyName), String(vendor._id)));
    }

    // Now every vendor in the file has an id here, whether matched or just created.
    for (const vendor of fileVendors) {
      const id = vendorIdByName.get(nameKey(vendor.companyName));
      if (id && vendor.sourceId) vendorIdBySourceId.set(String(vendor.sourceId), id);
    }

    const unmatchedOrders = [];
    const purchaseOrderDocs = [];
    const stockOrderDocs = [];

    for (const order of newOrders) {
      const vendorId =
        vendorIdBySourceId.get(String(order.vendorSourceId)) || vendorIdByName.get(nameKey(order.supplier)) || null;
      if (!vendorId) {
        unmatchedOrders.push(`${order.supplier || "Unknown vendor"} — ${new Date(order.date || Date.now()).toLocaleDateString()}`);
        continue;
      }

      const products = normalizeOrderProducts(order.products);
      const grandTotal = Number(order.grandTotal) || sumTotals(products);
      const paymentMade = Number(order.paymentMade) || 0;
      const payBeforeSupply = Boolean(order.payBeforeSupply);

      const common = {
        date: order.date || order.createdAt || new Date(),
        vendor: vendorId,
        contact: order.contact || "",
        location: order.location || "",
        products,
        grandTotal,
        paymentMade,
        paymentDate: order.paymentDate || "",
        balance: Math.max(0, grandTotal - paymentMade),
        payBeforeSupply,
        sourceApp: SOURCE_APP,
        sourceId: String(order.sourceId),
      };

      if (order.received) {
        purchaseOrderDocs.push({
          ...common,
          orderRef: generateOrderRef(),
          vendorName: order.supplier || "",
          status: derivePaymentStatus({ paymentMade, grandTotal, payBeforeSupply, receivedStatus: "Received" }),
          // Received in the expense app, so the goods are in: no stock movement is
          // raised here, or the stock would be counted twice.
          receivedStatus: "Received",
          receivedAt: order.date || order.createdAt || new Date(),
          notes: "Seeded from the expense app",
        });
      } else {
        stockOrderDocs.push({
          ...common,
          orderRef: generateOrderRef("SO"),
          supplier: order.supplier || "",
          mainProduct: order.mainProduct || "",
          status: derivePaymentStatus({ paymentMade, grandTotal, payBeforeSupply, receivedStatus: "Pending" }),
          stage: "Submitted",
          notes: "Seeded from the expense app",
        });
      }
    }

    const [createdPurchaseOrders, createdStockOrders] = await Promise.all([
      purchaseOrderDocs.length > 0 ? PurchaseOrder.insertMany(purchaseOrderDocs, { ordered: false }) : [],
      stockOrderDocs.length > 0 ? StockOrder.insertMany(stockOrderDocs, { ordered: false }) : [],
    ]);

    return res.status(200).json({
      success: true,
      summary: {
        ...summary,
        created: {
          vendors: vendorsToCreate.length,
          purchaseOrders: createdPurchaseOrders.length,
          stockOrders: createdStockOrders.length,
        },
        unmatchedOrders,
      },
      message:
        `Seeded ${createdPurchaseOrders.length} purchase order(s) and ${createdStockOrders.length} stock order(s)` +
        (vendorsToCreate.length > 0 ? `, and created ${vendorsToCreate.length} vendor(s)` : "") +
        (skipped > 0 ? `. ${skipped} were already seeded.` : "."),
    });
  } catch (err) {
    console.error("Seed import failed:", err);
    return res.status(500).json({ error: err.message });
  }
}

// A whole catalogue of vendors and orders is bigger than the 1MB default.
export const config = {
  api: { bodyParser: { sizeLimit: "25mb" } },
};
