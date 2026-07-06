import { isValidObjectId } from "mongoose";
import Product from "@/models/Product";
import Vendor from "@/models/Vendor";

function normalizeObjectId(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value?.toString === "function") return value.toString().trim();
  return "";
}

function uniqueObjectIds(values = []) {
  return [...new Set(values.map(normalizeObjectId).filter((value) => isValidObjectId(value)))];
}

function buildVendorProductEntry(product) {
  return {
    product: product._id,
    productName: String(product.name || "").trim(),
    price: Number(product.costPrice) || 0,
    packType: product.packType || "unit",
    qtyPerPack: Math.max(1, Number(product.qtyPerPack) || 1),
  };
}

export async function syncProductVendorAssignmentsForVendor({
  vendorId,
  previousProducts = [],
  nextProducts = [],
}) {
  const normalizedVendorId = normalizeObjectId(vendorId);
  if (!isValidObjectId(normalizedVendorId)) {
    return;
  }

  const previousProductIds = uniqueObjectIds(
    previousProducts.map((product) => product?.product || product)
  );
  const nextProductIds = uniqueObjectIds(
    nextProducts.map((product) => product?.product || product)
  );

  const removedProductIds = previousProductIds.filter(
    (productId) => !nextProductIds.includes(productId)
  );

  if (removedProductIds.length > 0) {
    await Product.updateMany(
      { _id: { $in: removedProductIds } },
      { $pull: { vendors: normalizedVendorId } }
    );
  }

  if (nextProductIds.length > 0) {
    await Product.updateMany(
      { _id: { $in: nextProductIds } },
      { $addToSet: { vendors: normalizedVendorId } }
    );
  }
}

export async function syncVendorAssignmentsForProduct({
  product,
  previousVendorIds = [],
  nextVendorIds = [],
}) {
  const productId = normalizeObjectId(product?._id || product);
  if (!isValidObjectId(productId)) {
    return;
  }

  const normalizedPreviousVendorIds = uniqueObjectIds(previousVendorIds);
  const normalizedNextVendorIds = uniqueObjectIds(nextVendorIds);
  const affectedVendorIds = [
    ...new Set([...normalizedPreviousVendorIds, ...normalizedNextVendorIds]),
  ];

  if (affectedVendorIds.length === 0) {
    return;
  }

  const vendorDocs = await Vendor.find({ _id: { $in: affectedVendorIds } });
  const nextEntry = buildVendorProductEntry(product);

  await Promise.all(
    vendorDocs.map(async (vendorDoc) => {
      const vendorId = normalizeObjectId(vendorDoc._id);
      const shouldContainProduct = normalizedNextVendorIds.includes(vendorId);
      const existingIndex = (vendorDoc.products || []).findIndex(
        (item) => normalizeObjectId(item?.product) === productId
      );

      let changed = false;

      if (shouldContainProduct) {
        if (existingIndex === -1) {
          vendorDoc.products.push(nextEntry);
          changed = true;
        } else {
          Object.assign(vendorDoc.products[existingIndex], nextEntry);
          changed = true;
        }
      } else if (existingIndex !== -1) {
        vendorDoc.products.splice(existingIndex, 1);
        changed = true;
      }

      if (changed) {
        vendorDoc.markModified("products");
        await vendorDoc.save();
      }
    })
  );
}