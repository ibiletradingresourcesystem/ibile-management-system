/**
 * Market list items in walking order: market, then section (in the order set up), then vendor —
 * and at the end of each market, products still waiting for a vendor and things not in the system.
 */
const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));

export function groupMarketItems(items = [], markets = []) {
  const marketOrder = new Map(markets.map((market, index) => [String(market._id), index]));
  const blocks = new Map();

  const blockFor = (item) => {
    const key = item.market || "none";
    if (!blocks.has(key)) {
      blocks.set(key, {
        key,
        name: item.marketName || (item.market ? "Market" : "Any market"),
        order: item.market ? marketOrder.get(String(item.market)) ?? 999 : 1000,
        sections: new Map(),
        noVendor: [],
        others: [],
      });
    }
    return blocks.get(key);
  };

  for (const item of items) {
    const block = blockFor(item);
    if (!item.product) {
      block.others.push(item);
    } else if (!item.vendor) {
      block.noVendor.push(item);
    } else {
      const sectionKey = item.section || "none";
      if (!block.sections.has(sectionKey)) {
        block.sections.set(sectionKey, {
          key: sectionKey,
          name: item.sectionName || "No section",
          order: item.section ? item.sectionOrder ?? 999 : 1000,
          vendors: new Map(),
        });
      }
      const section = block.sections.get(sectionKey);
      if (!section.vendors.has(item.vendor)) section.vendors.set(item.vendor, { key: item.vendor, name: item.vendorName || "Vendor", items: [] });
      section.vendors.get(item.vendor).items.push(item);
    }
  }

  return [...blocks.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
    .map((block) => ({
      ...block,
      sections: [...block.sections.values()]
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
        .map((section) => ({
          ...section,
          vendors: [...section.vendors.values()].sort(byName).map((vendor) => ({ ...vendor, items: vendor.items.sort(byName) })),
        })),
      noVendor: block.noVendor.sort(byName),
      others: block.others.sort(byName),
    }));
}

/** "2 baskets", "1", "1.5 kg" */
export function quantityLabel(item) {
  const quantity = Number(item.quantity || 0);
  const text = String(parseFloat(quantity.toFixed(2)));
  return item.unit ? `${text} ${item.unit}` : text;
}

/** Market vendors that list this product first, then everyone else in the same market, then the rest. */
export function vendorChoices(item, vendors = []) {
  const active = vendors.filter((vendor) => vendor.isActive !== false);
  const sells = (vendor) => (vendor.products || []).some((line) => String(line.product) === String(item.product));
  const listing = item.product ? active.filter(sells).sort(byName) : [];
  const listed = new Set(listing.map((vendor) => String(vendor._id)));
  const rest = active.filter((vendor) => !listed.has(String(vendor._id))).sort((a, b) => {
    const sameA = item.market && String(a.market) === String(item.market) ? 0 : 1;
    const sameB = item.market && String(b.market) === String(item.market) ? 0 : 1;
    return sameA - sameB || byName(a, b);
  });
  return { listing, rest };
}

/** Is this vendor the product's favourite (the one it goes to by itself)? */
export function isFavourite(vendor, productId) {
  return Boolean((vendor?.products || []).find((line) => String(line.product) === String(productId))?.favourite);
}
