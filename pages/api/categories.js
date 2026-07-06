import { mongooseConnect } from "@/lib/mongodb";
import { Category } from "@/models/Category";
import Store from "@/models/Store";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { deleteProductImages } from "@/lib/s3";

// Simple in-memory cache for categories (cleared on mutations)
let categoriesCache = null;
let categoriesCacheTime = 0;
const CACHE_TTL = 60 * 1000; // 1 minute

function isRoomCategory(name = "") {
  const normalized = String(name).trim().toLowerCase();
  return normalized === "room" || normalized === "rooms";
}

function resolveStockManaged(name, requestedValue) {
  if (isRoomCategory(name)) return false;
  if (typeof requestedValue === "boolean") return requestedValue;
  return true;
}

function invalidateCache() {
  categoriesCache = null;
  categoriesCacheTime = 0;
}

// Sync Store location.categories when a category's locations change
async function syncStoreLocationCategories(categoryId, locationNames) {
  try {
    const store = await Store.findOne({});
    if (!store?.locations) return;
    let changed = false;
    for (const loc of store.locations) {
      const catIdStr = String(categoryId);
      const hasCategory = loc.categories?.some((c) => String(c) === catIdStr);
      const shouldHave = locationNames.includes(loc.name) || locationNames.length === 0;
      if (shouldHave && !hasCategory) {
        if (!loc.categories) loc.categories = [];
        loc.categories.push(categoryId);
        changed = true;
      } else if (!shouldHave && hasCategory) {
        loc.categories = loc.categories.filter((c) => String(c) !== catIdStr);
        changed = true;
      }
    }
    if (changed) await store.save();
  } catch (err) {
    console.error("Store location-category sync error:", err);
  }
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
    if (method === "GET") {
      const now = Date.now();
      if (categoriesCache && (now - categoriesCacheTime) < CACHE_TTL) {
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
        return res.json(categoriesCache);
      }
      const categories = await Category.find().populate("parent").lean();
      categoriesCache = categories;
      categoriesCacheTime = now;
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
      return res.json(categories);
    }

    if (method === "POST") {
      let { name, parentCategory, properties, images, icon, isStockManaged, locations } = req.body;
      if (!name)
        return res.status(400).json({ success: false, message: "Name is required" });

      // --- FIX: Normalize images ---
      images = (images || []).map(img => ({
        full: typeof img.full === "string" ? img.full : img.full?.webp || img.full?.jpeg || "",
        thumb: typeof img.thumb === "string" ? img.thumb : img.thumb?.webp || img.thumb?.jpeg || "",
      }));

      const category = await Category.create({
        name,
        parent: parentCategory || null,
        properties: properties || [],
        icon: String(icon || "").trim(),
        isStockManaged: resolveStockManaged(name, isStockManaged),
        locations: Array.isArray(locations) ? locations : [],
        images,
      });

      invalidateCache();
      const populatedCategory = await Category.findById(category._id).populate("parent");
      await syncStoreLocationCategories(category._id, Array.isArray(locations) ? locations : []);
      return res.json(populatedCategory);
    }

    if (method === "PUT") {
      let { _id, name, parentCategory, properties, images, icon, isStockManaged, locations } = req.body;
      if (!_id) return res.status(400).json({ success: false, message: "Category ID is required" });

      // Fetch existing category to detect removed images
      const existingCategory = await Category.findById(_id).select("images").lean();

      // --- FIX: Normalize images ---
      images = (images || []).map(img => ({
        full: typeof img.full === "string" ? img.full : img.full?.webp || img.full?.jpeg || "",
        thumb: typeof img.thumb === "string" ? img.thumb : img.thumb?.webp || img.thumb?.jpeg || "",
      }));

      const updatedCategory = await Category.findByIdAndUpdate(
        _id,
        {
          name,
          parent: parentCategory || null,
          properties: properties || [],
          icon: String(icon || "").trim(),
          isStockManaged: resolveStockManaged(name, isStockManaged),
          locations: Array.isArray(locations) ? locations : [],
          images,
        },
        { new: true }
      ).populate("parent");

      // Delete S3 images that were removed during this edit
      if (Array.isArray(existingCategory?.images) && existingCategory.images.length > 0) {
        const updatedUrls = new Set(
          images.flatMap((img) => [img?.full, img?.thumb]).filter(Boolean)
        );
        const removedImages = existingCategory.images.filter(
          (img) => !updatedUrls.has(img?.full) && !updatedUrls.has(img?.thumb)
        );
        if (removedImages.length > 0) {
          deleteProductImages(removedImages).catch((err) =>
            console.error("[Categories] S3 image cleanup failed during edit:", err.message)
          );
        }
      }

      invalidateCache();
      await syncStoreLocationCategories(_id, Array.isArray(locations) ? locations : []);
      return res.json(updatedCategory);
    }

    if (method === "DELETE") {
      const { id } = req.query;
      if (!id) return res.status(400).json({ success: false, message: "Category ID required" });

      const removedCategory = await Category.findByIdAndDelete(id);

      // Delete associated S3 images
      if (Array.isArray(removedCategory?.images) && removedCategory.images.length > 0) {
        deleteProductImages(removedCategory.images).catch((err) =>
          console.error("[Categories] S3 image cleanup failed for deleted category:", err.message)
        );
      }

      invalidateCache();
      return res.json({ success: true });
    }

    res.status(405).json({ success: false, message: "Method not allowed" });
  } catch (error) {
    console.error("Category API error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
}

