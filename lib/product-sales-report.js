import { getAllocatedLineItems } from "@/lib/sales-report-utils";

function normalizeProductId(productId) {
  if (typeof productId === "string" && productId.trim()) {
    return productId.trim();
  }

  if (productId && typeof productId.toString === "function") {
    const stringValue = productId.toString().trim();
    return stringValue || null;
  }

  return null;
}

function getItemIdentity(item = {}) {
  const productId = normalizeProductId(item.productId);
  if (productId) {
    return { key: `product:${productId}`, productId };
  }

  const normalizedName = String(item.name || "").trim().toLowerCase();
  if (normalizedName) {
    return { key: `name:${normalizedName}`, productId: null };
  }

  return { key: null, productId: null };
}

export function aggregateProductSales(transactions = []) {
  const productMap = new Map();

  (Array.isArray(transactions) ? transactions : []).forEach((transaction) => {
    getAllocatedLineItems(transaction).forEach(({ item, quantity, netLineTotal }) => {
      const { key, productId } = getItemIdentity(item);
      if (!key) return;

      const nextName = String(item?.name || "").trim() || "Unknown";
      const existing = productMap.get(key);

      if (existing) {
        existing.unitsSold += quantity;
        existing.totalSales += netLineTotal;

        if ((!existing.name || existing.name === "Unknown") && nextName) {
          existing.name = nextName;
        }

        if (!existing.productId && productId) {
          existing.productId = productId;
        }

        return;
      }

      productMap.set(key, {
        key,
        productId,
        name: nextName,
        unitsSold: quantity,
        totalSales: netLineTotal,
      });
    });
  });

  return Array.from(productMap.values()).sort((a, b) => b.totalSales - a.totalSales);
}