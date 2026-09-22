import { mongooseConnect, withRetry } from "@/lib/mongodb";
import Product from "@/models/Product";
import { Category } from "@/models/Category";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { syncVendorAssignmentsForProduct } from "@/lib/vendorProductSync";
import { deleteProductImages } from "@/lib/s3";
import { deriveChildrenForParent } from "@/lib/syncPackQty";
import { resolveChildCost, syncChildCostsForParent } from "@/lib/childPricing";
import { deriveChildQuantity, getUnitsPerChild, isDerivedChild } from "@/lib/packUnits";
import { calculateMarginPercent, normalizeTaxRate, roundMoney, VAT_RATE } from "@/lib/pricing";
import { repairStoredBarcodes, suffixBarcodes } from "@/lib/barcodes";
import {
  sanitizeMultilineText,
  sanitizePlainText,
  sanitizeProperties,
  sanitizeStringArray,
} from "@/lib/textSanitizers";

const CHILD_FILTER = { isChildProduct: true, packType: { $ne: "pack" } };

// Expired promotions and expiry flags only need sweeping periodically, not on every request
const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000;
let lastMaintenanceRun = 0;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Derive child product quantities from their parent in-place.
 * Child qty = parent.qty × qtyPerPack ÷ unitsPerChild (always computed, never independent).
 */
async function deriveChildQuantities(products) {
  const children = products.filter(isDerivedChild);
  if (children.length === 0) return;

  const parentIds = [...new Set(children.map((p) => String(p.parentProduct)))];
  const parents = await Product.find({ _id: { $in: parentIds } })
    .select("_id quantity qtyPerPack")
    .lean();
  const parentMap = new Map(parents.map((p) => [String(p._id), p]));

  for (const child of children) {
    const parent = parentMap.get(String(child.parentProduct));
    if (parent) {
      child.quantity = deriveChildQuantity(parent.quantity, parent, child);
    }
  }
}

/**
 * Values for the auto-generated "<pack name> (Unit)" child, priced as a share of the pack.
 */
function buildAutoUnitChildPricing(pack, childSalePriceInput, unitsPerChild = 1) {
  const qtyPerPack = Number(pack.qtyPerPack) || 1;
  const taxRate = normalizeTaxRate(pack.taxRate);
  const costPrice = roundMoney(((Number(pack.costPrice) || 0) / qtyPerPack) * unitsPerChild);
  const salePriceIncTax = roundMoney(
    Number(childSalePriceInput) || ((Number(pack.salePriceIncTax) || 0) / qtyPerPack) * unitsPerChild
  );
  return {
    costPrice,
    taxRate,
    salePriceIncTax,
    costFromParent: true,
    margin: roundMoney(calculateMarginPercent(costPrice, salePriceIncTax, taxRate)),
  };
}

/* =====================
   AUTO-DISABLE EXPIRED PROMOTIONS
===================== */
async function disableExpiredPromotions() {
  const now = new Date();

  await Product.updateMany(
    {
      isPromotion: true,
      promoEnd: { $lt: now },
    },
    {
      $set: {
        isPromotion: false,
        promoPrice: null,
        promoStart: null,
        promoEnd: null,
      },
    }
  );
}

/* =====================
   AUTO-MARK EXPIRED PRODUCTS
===================== */
async function markExpiredProducts() {
  const now = new Date();

  await Product.updateMany(
    {
      expiryDate: { $lt: now },
      isExpired: false,
    },
    {
      $set: { isExpired: true },
    }
  );
}

async function resolveStockManagedFromCategory(categoryIdOrName, requestedValue) {
  if (!categoryIdOrName) {
    return typeof requestedValue === "boolean" ? requestedValue : true;
  }

  try {
    const category = await Category.findById(categoryIdOrName).select("isStockManaged").lean();
    if (!category) return typeof requestedValue === "boolean" ? requestedValue : true;
    if (typeof requestedValue === "boolean") return requestedValue;
    if (typeof category.isStockManaged === "boolean") return category.isStockManaged;
  } catch {
    // Category lookup can fail for non-ObjectId values like "Top Level"
  }
  return typeof requestedValue === "boolean" ? requestedValue : true;
}

function sanitizeProductPayload(payload = {}) {
  const nextPayload = { ...payload };

  if (Object.prototype.hasOwnProperty.call(nextPayload, "name")) {
    nextPayload.name = sanitizePlainText(nextPayload.name);
  }
  if (Object.prototype.hasOwnProperty.call(nextPayload, "description")) {
    nextPayload.description = sanitizeMultilineText(nextPayload.description);
  }
  if (Object.prototype.hasOwnProperty.call(nextPayload, "barcode")) {
    // Tidy as well as sanitise: a code saved broken up ("5012 3456 78901") can never be scanned,
    // so it is re-joined here the same way the product import repairs seeded barcodes.
    nextPayload.barcode = repairStoredBarcodes(sanitizePlainText(nextPayload.barcode)).barcode;
  }
  if (Object.prototype.hasOwnProperty.call(nextPayload, "category")) {
    nextPayload.category = sanitizePlainText(nextPayload.category);
  }
  if (Object.prototype.hasOwnProperty.call(nextPayload, "properties")) {
    nextPayload.properties = sanitizeProperties(nextPayload.properties);
  }
  if (Object.prototype.hasOwnProperty.call(nextPayload, "locations")) {
    nextPayload.locations = sanitizeStringArray(nextPayload.locations);
  }

  // Parent/child links are managed only through /api/products/links — but whether a child takes
  // its cost from the pack is the child's own setting, so it is saved with the product
  delete nextPayload.isChildProduct;
  delete nextPayload.parentProduct;
  delete nextPayload.unitsPerChild;
  if (hasOwn(nextPayload, "costFromParent")) {
    nextPayload.costFromParent = Boolean(nextPayload.costFromParent);
  }

  return nextPayload;
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  const { method } = req;
  await mongooseConnect();

  try {
    /* =====================
       GET PRODUCTS
    ===================== */
    if (method === "GET") {
      const {
        id,
        search,
        expired,
        minimal,
        page,
        limit: limitParam,
        archived,
        stockManaged,
        excludeChild,
        lookup,
      } = req.query;

      // Expiry/promotion sweeps touch the whole collection, so they run on a timer rather than on
      // every read — the products list is the most requested endpoint in the app.
      if (!minimal && lookup !== "true" && Date.now() - lastMaintenanceRun > MAINTENANCE_INTERVAL_MS) {
        lastMaintenanceRun = Date.now();
        await disableExpiredPromotions();
        await markExpiredProducts();
      }

      if (id) {
        const idFilter = {};
        if (archived === "true") idFilter.isArchived = true;
        if (archived === "false") idFilter.isArchived = false;
        if (archived !== "true" && archived !== "false") idFilter.isArchived = { $ne: true };

        const product = await Product.findOne({ _id: id, ...idFilter }).populate('vendors', 'companyName');
        if (!product) {
          return res.status(404).json({
            success: false,
            message: "Product not found",
          });
        }
        return res.json({ success: true, data: product });
      }

      const filter = {};
      if (archived === "true") filter.isArchived = true;
      else if (archived === "false") filter.isArchived = false;
      else filter.isArchived = { $ne: true };

      if (search) {
        const searchPattern = escapeRegex(search);
        filter.$or = [
          { name: { $regex: searchPattern, $options: "i" } },
          { barcode: { $regex: searchPattern, $options: "i" } },
        ];
      }

      // Lookup mode for the parent/child product picker - small result set with link status
      // Optional: category (id or "Top Level"), packsOnly=true (possible parents), limit (max 200)
      if (lookup === "true") {
        if (req.query.category) filter.category = String(req.query.category);
        // Any pack can be a parent, a pack of 1 included (a set sold whole or as a part).
        if (req.query.packsOnly === "true") filter.packType = "pack";
        const lookupLimit = Math.min(200, Math.max(1, parseInt(limitParam) || 20));

        const [products, total] = await Promise.all([
          Product.find(filter)
            .select("name barcode category quantity costPrice salePriceIncTax packType qtyPerPack isChildProduct parentProduct unitsPerChild isStockManaged")
            .populate("parentProduct", "name")
            .sort({ name: 1 })
            .limit(lookupLimit)
            .lean(),
          Product.countDocuments(filter),
        ]);

        const childCounts = await Product.aggregate([
          {
            $match: {
              parentProduct: { $in: products.map((p) => p._id) },
              ...CHILD_FILTER,
              isArchived: { $ne: true },
            },
          },
          { $group: { _id: "$parentProduct", count: { $sum: 1 } } },
        ]);
        const childCountMap = new Map(childCounts.map((c) => [String(c._id), c.count]));

        return res.json({
          success: true,
          total,
          data: products.map((p) => ({ ...p, childCount: childCountMap.get(String(p._id)) || 0 })),
        });
      }

      if (expired === "true") filter.isExpired = true;
      if (expired === "false") filter.isExpired = false;
      if (stockManaged === "true") filter.isStockManaged = true;
      if (stockManaged === "false") filter.isStockManaged = false;
      if (excludeChild === "true") {
        const childCondition = [
          { isChildProduct: { $ne: true } },
          { isChildProduct: true, packType: "pack" },
        ];
        if (filter.$or) {
          // Combine search $or with excludeChild $or via $and
          const searchOr = filter.$or;
          delete filter.$or;
          filter.$and = [{ $or: searchOr }, { $or: childCondition }];
        } else {
          filter.$or = childCondition;
        }
      }

      // Just the low-stock badge count. Counted in the database over every product, rather than
      // downloading a page of products and counting them in the browser.
      if (req.query.lowStockCount === "true") {
        const count = await Product.countDocuments({
          ...filter,
          isStockManaged: true,
          minStock: { $gt: 0 },
          $expr: { $lt: [{ $ifNull: ["$quantity", 0] }, "$minStock"] },
        });
        res.setHeader("Cache-Control", "private, max-age=60");
        return res.json({ success: true, count });
      }

      // Minimal mode for stock management - only essential fields
      if (minimal === "true") {
        filter.isStockManaged = true;
        const products = await Product.find(filter)
          .select("name quantity minStock maxStock category barcode costPrice salePriceIncTax isStockManaged isChildProduct parentProduct packType qtyPerPack unitsPerChild childSalePrice locations showOnWeb")
          .sort({ name: 1 })
          .lean();
        await deriveChildQuantities(products);
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
        return res.json({ success: true, data: products });
      }

      // Names-only mode for dropdowns - returns all products without pagination
      if (req.query.names === "true") {
        const products = await Product.find(filter)
          .select("name costPrice salePriceIncTax packType qtyPerPack barcode")
          .sort({ name: 1 })
          .lean();
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
        return res.json({ success: true, data: products });
      }

      // Price tag studio - every product, only what a tag needs (no pagination cap). Never
      // cached: a tag printed from a price that changed a minute ago is a wrong tag.
      if (req.query.priceTags === "true") {
        const products = await Product.find(filter)
          .select("name barcode category salePriceIncTax quantity isStockManaged isChildProduct parentProduct packType qtyPerPack unitsPerChild")
          .sort({ name: 1 })
          .lean();
        // Children hold no stock of their own; give them the count their parent's stock
        // makes, so "in stock" means the same thing for both.
        await deriveChildQuantities(products);
        res.setHeader("Cache-Control", "private, no-store");
        return res.json({ success: true, data: products, total: products.length });
      }

      // Full list mode - returns all products with list-view fields (no pagination cap)
      if (req.query.listAll === "true") {
        const products = await Product.find(filter)
          .select("name barcode category costPrice taxRate margin salePriceIncTax quantity minStock maxStock locations isStockManaged isChildProduct parentProduct packType qtyPerPack unitsPerChild childSalePrice expiryDate isExpired showOnWeb description")
          .sort({ createdAt: -1 })
          .lean();
        await deriveChildQuantities(products);
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
        return res.json({ success: true, data: products, total: products.length });
      }

      // Pagination support
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(limitParam) || 100));
      const skip = (pageNum - 1) * limit;

      // Full query with pagination
      const [products, total] = await Promise.all([
        Product.find(filter)
          .select('+expiryDate')
          .populate('vendors', 'companyName')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Product.countDocuments(filter)
      ]);

      res.setHeader('X-Total-Count', total);
      res.setHeader('X-Page', pageNum);
      res.setHeader('X-Total-Pages', Math.ceil(total / limit));

      await deriveChildQuantities(products);
      
      res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
      return res.json({ success: true, data: products, total });
    }

    /* =====================
       CREATE PRODUCT
    ===================== */
    if (method === "POST") {
      const body = sanitizeProductPayload(req.body);
      const autoCreateUnitChild = body.autoCreateUnitChild !== false;
      delete body.autoCreateUnitChild;
      body.isArchived = false;
      body.archivedAt = null;
      body.archivedReason = "";

      body.taxRate = hasOwn(body, "taxRate") ? normalizeTaxRate(body.taxRate) : VAT_RATE;
      body.margin = roundMoney(calculateMarginPercent(body.costPrice, body.salePriceIncTax, body.taxRate));

      body.isStockManaged = await resolveStockManagedFromCategory(
        body.category,
        body.isStockManaged
      );
      if (!body.isStockManaged) body.quantity = 0;

      if (body.expiryDate) {
        body.expiryDate = new Date(body.expiryDate);
        body.isExpired = body.expiryDate < new Date();
      }

      const product = await Product.create(body);

      await syncVendorAssignmentsForProduct({
        product,
        previousVendorIds: [],
        nextVendorIds: body.vendors || [],
      });

      // Auto-create a single-unit child product when pack type is selected
      if (autoCreateUnitChild && product.packType === "pack" && Number(product.qtyPerPack) > 1) {
        await Product.create({
          name: `${product.name} (Unit)`,
          description: `${product.description || product.name} - Single unit from pack of ${product.qtyPerPack}`,
          ...buildAutoUnitChildPricing(product, body.childSalePrice),
          barcode: suffixBarcodes(product.barcode, "-U"),
          category: product.category || "Top Level",
          images: product.images || [],
          properties: product.properties || [],
          quantity: deriveChildQuantity(product.quantity, product, { unitsPerChild: 1 }),
          isStockManaged: product.isStockManaged !== false,
          minStock: 0,
          packType: "unit",
          qtyPerPack: 1,
          unitsPerChild: 1,
          isChildProduct: true,
          parentProduct: product._id,
          vendors: body.vendors || [],
          locations: product.locations || [],
          isArchived: false,
        });
      }

      return res.status(201).json({
        success: true,
        message: "Product created successfully",
        data: product,
      });
    }

    /* =====================
       UPDATE PRODUCT
    ===================== */
    if (method === "PUT") {
      const {
        _id,
        restore,
        isPromotion,
        promoStart,
        promoEnd,
        promoPrice,
        expiryDate,
      } = req.body;

      if (!_id) {
        return res.status(400).json({
          success: false,
          message: "Product ID required",
        });
      }

      const existingProduct = await Product.findById(_id)
        .select("name vendors packType qtyPerPack category productType isStockManaged images costPrice salePriceIncTax taxRate isChildProduct parentProduct")
        .lean();

      if (!existingProduct) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      /* 🔒 Promotion Validation */
      if (isPromotion) {
        if (!promoPrice || !promoStart || !promoEnd) {
          return res.status(400).json({
            success: false,
            message: "Promo price, start date, and end date are required",
          });
        }

        if (new Date(promoEnd) <= new Date(promoStart)) {
          return res.status(400).json({
            success: false,
            message: "Promo end date must be after start date",
          });
        }

        const overlap = await Product.findOne({
          _id,
          isPromotion: true,
          promoEnd: { $gte: new Date(promoStart) },
          promoStart: { $lte: new Date(promoEnd) },
        });

        if (overlap) {
          return res.status(400).json({
            success: false,
            message: "Promotion dates overlap with existing promotion",
          });
        }
      }

      const updateData = sanitizeProductPayload(req.body);
      const autoCreateUnitChild = updateData.autoCreateUnitChild !== false;
      delete updateData.autoCreateUnitChild;

      if (isDerivedChild(existingProduct)) {
        // A child's stock always comes from its parent
        delete updateData.quantity;
        if (updateData.packType === "pack") {
          return res.status(400).json({
            success: false,
            message: "This product is linked as a child of a pack. Unlink it from its parent before making it a pack.",
          });
        }
      }

      const packChanging =
        (hasOwn(updateData, "packType") && updateData.packType !== "pack") ||
        hasOwn(updateData, "qtyPerPack");
      if (existingProduct.packType === "pack" && packChanging) {
        const linkedChildren = await Product.find({
          parentProduct: _id,
          ...CHILD_FILTER,
          isArchived: { $ne: true },
        }).select("unitsPerChild").lean();

        if (linkedChildren.length > 0 && updateData.packType && updateData.packType !== "pack") {
          return res.status(400).json({
            success: false,
            message: `This pack has ${linkedChildren.length} linked child product(s). Unlink them before changing the pack type.`,
          });
        }

        const largestChildUnits = Math.max(0, ...linkedChildren.map(getUnitsPerChild));
        if (hasOwn(updateData, "qtyPerPack") && Number(updateData.qtyPerPack) < largestChildUnits) {
          return res.status(400).json({
            success: false,
            message: `Qty per pack can't be less than ${largestChildUnits} — a linked child holds ${largestChildUnits} units.`,
          });
        }
      }

      // A child that follows its pack gets its cost from the pack, whatever was sent
      const followsParent = hasOwn(updateData, "costFromParent")
        ? Boolean(updateData.costFromParent)
        : Boolean(existingProduct.costFromParent);

      if (followsParent && isDerivedChild(existingProduct)) {
        const derived = await resolveChildCost({ ...existingProduct, ...updateData, costFromParent: true });
        if (derived) updateData.costPrice = derived.costPrice;
      } else if (hasOwn(updateData, "costFromParent") && !followsParent) {
        updateData.costFromParent = false;
      }

      // Only one VAT rate exists; keep the stored margin consistent with cost, sale price and VAT
      if (["costPrice", "salePriceIncTax", "taxRate"].some((field) => hasOwn(updateData, field))) {
        const costPrice = hasOwn(updateData, "costPrice") ? updateData.costPrice : existingProduct.costPrice;
        const salePriceIncTax = hasOwn(updateData, "salePriceIncTax")
          ? updateData.salePriceIncTax
          : existingProduct.salePriceIncTax;
        updateData.taxRate = normalizeTaxRate(
          hasOwn(updateData, "taxRate") ? updateData.taxRate : existingProduct.taxRate
        );
        updateData.margin = roundMoney(calculateMarginPercent(costPrice, salePriceIncTax, updateData.taxRate));
      }

      if (restore) {
        updateData.isArchived = false;
        updateData.archivedAt = null;
        updateData.archivedReason = "";
      } else if (updateData.isArchived) {
        updateData.archivedAt = updateData.archivedAt || new Date();
      }

      if (
        Object.prototype.hasOwnProperty.call(updateData, "category") ||
        Object.prototype.hasOwnProperty.call(updateData, "isStockManaged")
      ) {
        updateData.isStockManaged = await resolveStockManagedFromCategory(
          Object.prototype.hasOwnProperty.call(updateData, "category")
            ? updateData.category
            : existingProduct.category,
          Object.prototype.hasOwnProperty.call(updateData, "isStockManaged")
            ? updateData.isStockManaged
            : existingProduct.isStockManaged
        );
        if (!updateData.isStockManaged) updateData.quantity = 0;
      }

      if (promoStart) updateData.promoStart = new Date(promoStart);
      if (promoEnd) updateData.promoEnd = new Date(promoEnd);

      if (expiryDate) {
        updateData.expiryDate = new Date(expiryDate);
        updateData.isExpired = new Date(expiryDate) < new Date();
      }

      const updated = await Product.findByIdAndUpdate(
        _id,
        updateData,
        { new: true }
      );

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      // Delete S3 images that were removed during this edit (best-effort)
      if (Array.isArray(existingProduct.images) && existingProduct.images.length > 0) {
        const updatedUrls = new Set(
          (Array.isArray(updated.images) ? updated.images : [])
            .flatMap((img) => [img?.full, img?.thumb])
            .filter(Boolean)
        );
        const removedImages = existingProduct.images.filter(
          (img) => !updatedUrls.has(img?.full) && !updatedUrls.has(img?.thumb)
        );
        if (removedImages.length > 0) {
          deleteProductImages(removedImages).catch((err) =>
            console.error("[Products] S3 image cleanup failed during edit:", err.message)
          );
        }
      }

      await syncVendorAssignmentsForProduct({
        product: updated,
        previousVendorIds: existingProduct.vendors || [],
        nextVendorIds: updated.vendors || [],
      });

      // Auto-create/update the single-unit child when pack type is set
      if (updated.packType === "pack" && Number(updated.qtyPerPack) > 1) {
        // Only the auto-generated "<pack name> (Unit)" child follows the pack's details.
        // Products linked as children from /api/products/links keep their own name and prices.
        const autoChild = await Product.findOne({
          parentProduct: updated._id,
          ...CHILD_FILTER,
          isArchived: { $ne: true },
          name: { $in: [...new Set([`${existingProduct.name} (Unit)`, `${updated.name} (Unit)`])] },
        }).select("_id unitsPerChild");

        if (autoChild) {
          await Product.findByIdAndUpdate(autoChild._id, {
            name: `${updated.name} (Unit)`,
            description: `${updated.description || updated.name} - Single unit from pack of ${updated.qtyPerPack}`,
            ...buildAutoUnitChildPricing(updated, updateData.childSalePrice, getUnitsPerChild(autoChild)),
            category: updated.category,
            images: updated.images || [],
            vendors: updated.vendors || [],
            locations: updated.locations || [],
          });
        } else {
          const previouslyQualifiedForChild =
            existingProduct.packType === "pack" && Number(existingProduct.qtyPerPack) > 1;

          if (!previouslyQualifiedForChild && autoCreateUnitChild) {
            await Product.create({
              name: `${updated.name} (Unit)`,
              description: `${updated.description || updated.name} - Single unit from pack of ${updated.qtyPerPack}`,
              ...buildAutoUnitChildPricing(updated, updateData.childSalePrice),
              barcode: suffixBarcodes(updated.barcode, "-U"),
              category: updated.category || "Top Level",
              images: updated.images || [],
              properties: updated.properties || [],
              quantity: deriveChildQuantity(updated.quantity, updated, { unitsPerChild: 1 }),
              isStockManaged: updated.isStockManaged !== false,
              minStock: 0,
              packType: "unit",
              qtyPerPack: 1,
              unitsPerChild: 1,
              isChildProduct: true,
              parentProduct: updated._id,
              vendors: updated.vendors || [],
              locations: updated.locations || [],
              isArchived: false,
            });
          }
        }
      }

      if (updated.packType === "pack") {
        await deriveChildrenForParent(updated._id);
        if (["costPrice", "qtyPerPack"].some((field) => hasOwn(updateData, field))) {
          await syncChildCostsForParent(updated._id);
        }
      }

      return res.json({
        success: true,
        message: "Product updated successfully",
        data: updated,
      });
    }

    /* =====================
       DELETE PRODUCT
    ===================== */
    if (method === "DELETE") {
      const { id, permanent } = req.query;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Product ID required",
        });
      }

      // Permanent delete - Admin only
      if (permanent === "true") {
        if (req.user?.role !== "admin") {
          return res.status(403).json({
            success: false,
            message: "Only Admin can permanently delete products",
          });
        }
        const removed = await Product.findByIdAndDelete(id);
        if (!removed) {
          return res.status(404).json({
            success: false,
            message: "Product not found",
          });
        }

        // Delete associated S3 images (best-effort, non-blocking)
        if (Array.isArray(removed.images) && removed.images.length > 0) {
          deleteProductImages(removed.images).catch((err) =>
            console.error("[Products] S3 image cleanup failed for deleted product:", err.message)
          );
        }

        return res.json({
          success: true,
          message: "Product permanently deleted",
        });
      }

      const deleted = await Product.findByIdAndUpdate(
        id,
        {
          isArchived: true,
          archivedAt: new Date(),
          archivedReason: "manual-delete",
          quantity: 0,
        },
        { new: true }
      );

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      if (deleted.packType === "pack") {
        await deriveChildrenForParent(deleted._id);
      }

      return res.json({
        success: true,
        message: "Product archived successfully",
      });
    }

    return res.status(405).json({
      success: false,
      message: `Method ${method} not allowed`,
    });
  } catch (error) {
    console.error("❌ Product API Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
}

