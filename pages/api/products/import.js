/**
 * API: POST /api/products/import
 * Bulk-imports products from parsed spreadsheet data.
 * Auto-creates categories that don't exist.
 * Assigns all products to the specified location.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Product from "@/models/Product";
import { Category } from "@/models/Category";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  const { products, location } = req.body || {};

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: "No products provided" });
  }

  if (products.length > 500) {
    return res.status(400).json({ error: "Maximum 500 products per import" });
  }

  try {
    // 1. Collect unique category names and ensure they exist
    const categoryNames = [...new Set(
      products
        .map((p) => String(p.category || "").trim())
        .filter(Boolean)
    )];

    const existingCategories = await Category.find({
      name: { $in: categoryNames },
    }).lean();

    const existingCategorySet = new Set(existingCategories.map((c) => c.name));
    const missingCategories = categoryNames.filter((n) => !existingCategorySet.has(n));

    // Create missing categories
    if (missingCategories.length > 0) {
      const toCreate = missingCategories.map((name) => ({
        name,
        locations: location ? [location] : [],
        isStockManaged: true,
      }));
      await Category.insertMany(toCreate, { ordered: false }).catch(() => {});
    }

    // 2. Check for existing products (by barcode or exact name) to skip duplicates
    const barcodes = products
      .map((p) => String(p.barcode || "").trim())
      .filter(Boolean);
    const names = products.map((p) => String(p.name || "").trim()).filter(Boolean);

    const existingByBarcode = barcodes.length > 0
      ? await Product.find({ barcode: { $in: barcodes } }).select("barcode").lean()
      : [];
    const existingByName = await Product.find({ name: { $in: names } }).select("name").lean();

    const existingBarcodeSet = new Set(existingByBarcode.map((p) => p.barcode));
    const existingNameSet = new Set(existingByName.map((p) => p.name));

    // 3. Build product documents
    const toInsert = [];
    const skipped = [];

    for (const row of products) {
      const name = String(row.name || "").trim();
      if (!name) { skipped.push({ name: "(empty)", reason: "No name" }); continue; }

      const barcode = String(row.barcode || "").trim();

      // Skip if barcode exists already
      if (barcode && existingBarcodeSet.has(barcode)) {
        skipped.push({ name, reason: "Barcode already exists" });
        continue;
      }

      // Skip if exact name exists already
      if (existingNameSet.has(name)) {
        skipped.push({ name, reason: "Product name already exists" });
        continue;
      }

      const costPrice = Math.max(0, Number(row.costPrice) || 0);
      const salePriceIncTax = Math.max(0, Number(row.salePriceIncTax) || 0);
      const category = String(row.category || "").trim() || "Top Level";

      toInsert.push({
        name,
        description: String(row.description || "").trim(),
        costPrice,
        salePriceIncTax,
        barcode: barcode || undefined,
        category,
        locations: location ? [location] : [],
        showOnWeb: true,
        isStockManaged: true,
        isArchived: false,
        quantity: 0,
      });

      // Track to avoid duplicates within same batch
      if (barcode) existingBarcodeSet.add(barcode);
      existingNameSet.add(name);
    }

    // 4. Bulk insert
    let created = 0;
    if (toInsert.length > 0) {
      const result = await Product.insertMany(toInsert, { ordered: false }).catch((err) => {
        // Some might fail (duplicate key etc), count what succeeded
        return err.insertedDocs || [];
      });
      created = Array.isArray(result) ? result.length : toInsert.length;
    }

    return res.status(200).json({
      success: true,
      summary: {
        total: products.length,
        created,
        skipped: skipped.length,
        categoriesCreated: missingCategories.length,
      },
      skipped,
    });
  } catch (err) {
    console.error("Product import error:", err.message);
    return res.status(500).json({ error: err.message || "Import failed" });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: "4mb" } },
};
