/**
 * Builds the product seed/import plan: what happens to each spreadsheet row.
 * Pure function (no database access) so the same plan drives the preview and the import.
 *
 * - New product            → created (VAT 7.5%, margin from cost & sale, qty seeded)
 * - Existing product       → only cost & sale price are updated when they differ; every other
 *                            detail stays the same. Qty is updated only when the user opts in.
 * - Disjointed barcodes    → a seeded product whose stored barcode was broken up by the
 *                            spreadsheet is repaired, and codes from the file are merged in
 *                            (unless fixBarcodes is off). No code is ever removed.
 * - Pack Qty / Parent cols → mother (pack) and child relationships, on new and existing products
 *                            alike. Children never hold stock; their qty comes from the parent,
 *                            so a child's Qty cell is ignored.
 * - "Parent: none"         → detaches a child from its pack (it starts at 0 stock, as the stock
 *                            stays with the pack).
 * - "Pack Qty: none" (0)   → turns a pack back into an ordinary product; its children detach too.
 *   A blank cell always means "leave this as it is", so re-importing an old file changes nothing.
 */
import { formatBarcodes, repairStoredBarcodes, splitStoredBarcodes } from "@/lib/barcodes";
import { getPackSize, getUnitsPerChild, isDerivedChild } from "@/lib/packUnits";
import { calculateMarginPercent, normalizeTaxRate, roundMoney, VAT_RATE } from "@/lib/pricing";

const PRICE_TOLERANCE = 0.005;
const QTY_TOLERANCE = 0.0001;
const MIN_MATCH_BARCODE_LENGTH = 5;
const MIN_LOOSE_PARENT_LENGTH = 4;

export function nameKey(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function barcodeKeys(barcodes) {
  return barcodes.map((code) => code.toLowerCase()).filter((code) => code.length >= MIN_MATCH_BARCODE_LENGTH);
}

function addToIndex(index, key, value) {
  if (!key) return;
  const list = index.get(key) || [];
  if (!list.includes(value)) list.push(value);
  index.set(key, list);
}

/** Resolve an existing product by name (active products first), then by a unique barcode. */
function findExisting({ byName, byBarcode }, name, barcodes) {
  const named = byName.get(nameKey(name)) || [];
  const activeNamed = named.filter((p) => !p.isArchived);
  if (activeNamed.length > 1) {
    return { error: `${activeNamed.length} existing products are named "${name}" — update them manually` };
  }
  if (activeNamed.length === 1 || named.length > 0) {
    return { product: activeNamed[0] || named[0], matchedBy: "name" };
  }

  const matches = new Set();
  for (const key of barcodeKeys(barcodes)) {
    (byBarcode.get(key) || []).forEach((p) => matches.add(p));
  }
  const active = [...matches].filter((p) => !p.isArchived);
  const candidates = active.length > 0 ? active : [...matches];
  if (candidates.length > 1) {
    return { error: `Barcode matches ${candidates.length} existing products (${candidates.map((p) => p.name).join(", ")})` };
  }
  if (candidates.length === 1) return { product: candidates[0], matchedBy: "barcode" };
  return {};
}

/**
 * @param {object} args
 * @param {object[]} args.rows              rows from normalizeImportRow
 * @param {object[]} args.existingProducts  lean products (name barcode costPrice salePriceIncTax taxRate quantity
 *                                          packType qtyPerPack isChildProduct parentProduct unitsPerChild
 *                                          isArchived isStockManaged)
 * @param {object}   args.options           { canSeedQty, updateExistingQty, fixBarcodes }
 */
export function buildImportPlan({ rows = [], existingProducts = [], options = {} }) {
  const { canSeedQty = false, updateExistingQty = false, fixBarcodes = true } = options;

  const byName = new Map();
  const byBarcode = new Map();
  const byId = new Map();
  const childrenByParent = new Map(); // parentId -> active child products

  for (const product of existingProducts) {
    const id = String(product._id);
    byId.set(id, product);
    addToIndex(byName, nameKey(product.name), product);
    barcodeKeys(splitStoredBarcodes(product.barcode)).forEach((key) => addToIndex(byBarcode, key, product));
    if (isDerivedChild(product) && !product.isArchived) {
      const parentId = String(product.parentProduct);
      childrenByParent.set(parentId, [...(childrenByParent.get(parentId) || []), product]);
    }
  }
  const existingIndex = { byName, byBarcode };
  const childrenOf = (productId) => (productId ? childrenByParent.get(String(productId)) || [] : []);

  const entries = rows.map((row) => ({
    row,
    rowNumber: row.rowNumber,
    name: row.name,
    action: "create",
    product: null,
    matchedBy: null,
    parent: null, // { entry } for a parent row in this file, or { product } for an existing parent
    changes: [],
    warnings: [...(row.warnings || [])],
    error: null,
    set: null,
    doc: null,
  }));

  const fail = (entry, message) => {
    if (!entry.error) entry.error = message;
  };

  // 1. Names, duplicates within the file, and matches with existing products
  const firstRowByName = new Map();
  const entryByProductId = new Map();
  for (const entry of entries) {
    if (!entry.name) {
      fail(entry, "Missing product name");
      continue;
    }
    const key = nameKey(entry.name);
    if (firstRowByName.has(key)) {
      fail(entry, `Duplicate of row ${firstRowByName.get(key).rowNumber}`);
      continue;
    }
    firstRowByName.set(key, entry);

    const match = findExisting(existingIndex, entry.name, entry.row.barcodes);
    if (match.error) {
      fail(entry, match.error);
      continue;
    }
    if (match.product) {
      const productId = String(match.product._id);
      if (entryByProductId.has(productId)) {
        fail(entry, `Matches the same existing product as row ${entryByProductId.get(productId).rowNumber}`);
        continue;
      }
      entryByProductId.set(productId, entry);
      entry.product = match.product;
      entry.matchedBy = match.matchedBy;
      entry.action = "update";
      if (match.matchedBy === "barcode") {
        entry.warnings.push(`Matched existing product "${match.product.name}" by barcode`);
      }
      if (match.product.isArchived) entry.warnings.push("Existing product is archived");
    }
  }

  // Barcodes shared by more than one row in the file
  const rowsByBarcode = new Map();
  for (const entry of entries) {
    if (entry.error) continue;
    barcodeKeys(entry.row.barcodes).forEach((key) => addToIndex(rowsByBarcode, key, entry));
  }
  for (const [code, sharing] of rowsByBarcode) {
    if (sharing.length < 2) continue;
    for (const entry of sharing) {
      const others = sharing.filter((other) => other !== entry).map((other) => other.rowNumber).join(", ");
      entry.warnings.push(`Barcode ${code} is also on row ${others}`);
    }
  }

  const fileByName = firstRowByName;
  const findParentInFile = (ref) => {
    const byNameMatch = fileByName.get(nameKey(ref));
    if (byNameMatch) return byNameMatch;
    const byCode = rowsByBarcode.get(String(ref).toLowerCase()) || [];
    return byCode.length === 1 ? byCode[0] : null;
  };

  /**
   * The product a "Parent" cell points at. An exact name or barcode first, then a single active
   * product whose name contains the text — so "Indomie Carton" still finds "Indomie Carton 40s".
   * Ambiguous text is an error rather than a guess, and the match is shown in the preview.
   */
  const resolveParentProduct = (ref, entry) => {
    const exact = findExisting(existingIndex, ref, [ref]);
    if (exact.error || exact.product) return exact;

    const key = nameKey(ref);
    if (key.length < MIN_LOOSE_PARENT_LENGTH) return {};

    const loose = [];
    for (const [name, products] of byName) {
      if (name === key || !name.includes(key)) continue;
      products.filter((product) => !product.isArchived).forEach((product) => loose.push(product));
    }

    if (loose.length === 1) {
      entry.warnings.push(`Parent "${ref}" matched "${loose[0].name}"`);
      return { product: loose[0], matchedBy: "partial name" };
    }
    if (loose.length > 1) {
      return { error: `matches ${loose.length} products (${loose.map((product) => product.name).slice(0, 3).join(", ")})` };
    }
    return {};
  };

  const isPackRow = (entry) => entry.row.packQty !== null && entry.row.packQty > 1;
  /** "Pack Qty: none" on a product that is a pack today — it goes back to being an ordinary product. */
  const isDemoteRow = (entry) => Boolean(entry.row.demotePack && entry.product?.packType === "pack");

  // 2. Pack (mother) rows
  for (const entry of entries) {
    if (entry.error) continue;
    if (entry.row.packQty !== null && entry.row.packQty <= 1) {
      entry.warnings.push("Pack Qty must be 2 or more to make a pack — ignored");
    }
    if (!isPackRow(entry)) continue;

    if (entry.row.parentRef) {
      fail(entry, "A product can't be both a pack (Pack Qty) and a child (Parent)");
      continue;
    }
    if (entry.product && isDerivedChild(entry.product) && !entry.row.unlinkParent) {
      fail(entry, 'This product is linked as a child in the system — put "none" in Parent to detach it first');
      continue;
    }
    const largestChild = Math.max(0, ...childrenOf(entry.product?._id).map(getUnitsPerChild));
    if (entry.row.packQty < largestChild) {
      fail(entry, `Pack Qty ${entry.row.packQty} is less than an existing child's units (${largestChild})`);
    }
  }

  // 3. Child rows → resolve their parent
  for (const entry of entries) {
    if (entry.error || !entry.row.parentRef) continue;
    const ref = entry.row.parentRef;

    let parentLabel;
    let packSize = null;
    let parentEntry = findParentInFile(ref);
    let resolved = null;
    if (!parentEntry) {
      // The parent may be named the way it is in the system while its row in the file differs
      resolved = resolveParentProduct(ref, entry);
      if (resolved.product) parentEntry = entryByProductId.get(String(resolved.product._id)) || null;
    }

    if (parentEntry) {
      if (parentEntry === entry) {
        fail(entry, "A product can't be its own parent");
        continue;
      }
      if (parentEntry.error) {
        fail(entry, `Parent "${parentEntry.name}" (row ${parentEntry.rowNumber}) has an error`);
        continue;
      }
      if (parentEntry.row.parentRef) {
        fail(entry, `Parent "${parentEntry.name}" (row ${parentEntry.rowNumber}) is itself a child`);
        continue;
      }
      if (isDemoteRow(parentEntry)) {
        fail(entry, `Parent "${parentEntry.name}" (row ${parentEntry.rowNumber}) is being turned into a non-pack`);
        continue;
      }
      parentLabel = parentEntry.name;
      if (isPackRow(parentEntry)) packSize = parentEntry.row.packQty;
      else if (parentEntry.product?.packType === "pack") packSize = getPackSize(parentEntry.product);
      entry.parent = { entry: parentEntry };
    } else {
      if (resolved.error || !resolved.product) {
        fail(entry, resolved.error ? `Parent "${ref}": ${resolved.error}` : `Parent "${ref}" not found in the file or in the system`);
        continue;
      }
      const parentProduct = resolved.product;
      if (parentProduct.isArchived) {
        fail(entry, `Parent "${parentProduct.name}" is archived`);
        continue;
      }
      if (isDerivedChild(parentProduct)) {
        fail(entry, `Parent "${parentProduct.name}" is itself a child product`);
        continue;
      }
      parentLabel = parentProduct.name;
      if (parentProduct.packType === "pack") packSize = getPackSize(parentProduct);
      entry.parent = { product: parentProduct };
    }

    const parentId = entry.parent.product ? String(entry.parent.product._id) : entry.parent.entry.product?._id;
    if (entry.product && parentId && String(parentId) === String(entry.product._id)) {
      fail(entry, "A product can't be its own parent");
      continue;
    }
    if (!packSize || packSize <= 1) {
      fail(entry, `Parent "${parentLabel}" isn't a pack — give it a Pack Qty`);
      continue;
    }

    if (entry.row.unitsPerChild === null) {
      entry.warnings.push("Units not set — assumed 1");
    }
    const units = entry.row.unitsPerChild ?? 1;
    if (units > packSize) {
      fail(entry, `Units (${units}) can't be more than the parent's Pack Qty (${packSize})`);
      continue;
    }
    if (entry.product && childrenOf(entry.product._id).length > 0) {
      fail(entry, `"${entry.product.name}" already has child products, so it can't become a child`);
      continue;
    }

    entry.parent.label = parentLabel;
    entry.parent.units = units;
  }

  // 4. What to create or change
  for (const entry of entries) {
    if (entry.error) {
      entry.action = "error";
      continue;
    }
    const { row } = entry;
    const isChild = Boolean(entry.parent);
    const isPack = isPackRow(entry);
    const unlinking = Boolean(entry.product && row.unlinkParent && isDerivedChild(entry.product));
    const takesStockFromParent = isChild || (entry.product && isDerivedChild(entry.product) && !unlinking);

    if (row.quantity !== null) {
      if (takesStockFromParent) entry.warnings.push("Child stock comes from its parent pack — Qty ignored");
      else if (!canSeedQty) entry.warnings.push("You do not have permission to seed stock — Qty ignored");
    }
    const qtyAllowed = row.quantity !== null && !takesStockFromParent && canSeedQty;

    if (!entry.product) {
      const costPrice = row.costPrice ?? 0;
      const salePriceIncTax = row.salePriceIncTax ?? 0;
      if (row.costPrice === null) entry.warnings.push("No cost price — saved as 0");
      if (row.salePriceIncTax === null) entry.warnings.push("No sale price — saved as 0");

      entry.doc = {
        name: row.name,
        description: row.description || row.name,
        costPrice,
        salePriceIncTax,
        taxRate: VAT_RATE,
        margin: roundMoney(calculateMarginPercent(costPrice, salePriceIncTax, VAT_RATE)),
        barcode: formatBarcodes(row.barcodes) || undefined,
        categoryName: row.category,
        quantity: qtyAllowed ? row.quantity : 0,
        packType: isPack ? "pack" : "unit",
        qtyPerPack: isPack ? row.packQty : 1,
        unitsPerChild: isChild ? entry.parent.units : 1,
        isChildProduct: isChild,
      };

      entry.changes.push({ field: "Cost", to: costPrice }, { field: "Sale", to: salePriceIncTax });
      if (qtyAllowed) entry.changes.push({ field: "Qty", to: row.quantity });
      if (isPack) entry.changes.push({ field: "Pack of", to: row.packQty });
      if (isChild) entry.changes.push({ field: "Child of", to: `${entry.parent.label} (${entry.parent.units} units)` });
      continue;
    }

    // Existing product: prices, opted-in qty, and explicit pack/child columns only
    const product = entry.product;
    const set = {};

    if (row.costPrice !== null && Math.abs(row.costPrice - (Number(product.costPrice) || 0)) > PRICE_TOLERANCE) {
      set.costPrice = row.costPrice;
      entry.changes.push({ field: "Cost", from: Number(product.costPrice) || 0, to: row.costPrice });
    }
    if (
      row.salePriceIncTax !== null &&
      Math.abs(row.salePriceIncTax - (Number(product.salePriceIncTax) || 0)) > PRICE_TOLERANCE
    ) {
      set.salePriceIncTax = row.salePriceIncTax;
      entry.changes.push({ field: "Sale", from: Number(product.salePriceIncTax) || 0, to: row.salePriceIncTax });
    }
    if ("costPrice" in set || "salePriceIncTax" in set) {
      const taxRate = normalizeTaxRate(product.taxRate);
      set.margin = roundMoney(
        calculateMarginPercent(set.costPrice ?? product.costPrice, set.salePriceIncTax ?? product.salePriceIncTax, taxRate)
      );
      if (Number(product.taxRate) !== taxRate) set.taxRate = taxRate;
    }

    // Repair a barcode a spreadsheet broke apart and merge in the codes from the file.
    // Nothing is ever removed, and a code already used by another product is left alone.
    if (fixBarcodes) {
      const takenElsewhere = [];
      const extraCodes = row.barcodes.filter((code) => {
        const owner = (byBarcode.get(code.toLowerCase()) || []).find((p) => String(p._id) !== String(product._id));
        if (owner) takenElsewhere.push(`Barcode ${code} already belongs to "${owner.name}" — not added`);
        return !owner;
      });

      const repaired = repairStoredBarcodes(product.barcode, extraCodes);
      entry.warnings.push(...takenElsewhere, ...repaired.warnings);

      if (repaired.changed) {
        set.barcode = repaired.barcode;
        entry.changes.push({
          field: "Barcode",
          from: String(product.barcode ?? "").trim() || "none",
          to: repaired.barcode,
        });
      }
    }

    if (qtyAllowed && !unlinking) {
      if (!updateExistingQty) {
        entry.qtyNotApplied = true;
      } else if (product.isStockManaged === false) {
        entry.warnings.push("Product is not stock-managed — Qty ignored");
      } else if (Math.abs(row.quantity - (Number(product.quantity) || 0)) > QTY_TOLERANCE) {
        set.quantity = row.quantity;
        entry.changes.push({ field: "Qty", from: Number(product.quantity) || 0, to: row.quantity });
      }
    }

    if (isPack && (product.packType !== "pack" || getPackSize(product) !== row.packQty)) {
      set.packType = "pack";
      set.qtyPerPack = row.packQty;
      entry.changes.push({
        field: "Pack of",
        from: product.packType === "pack" ? getPackSize(product) : "not a pack",
        to: row.packQty,
      });
    }

    if (isChild) {
      const targetId = entry.parent.product ? String(entry.parent.product._id) : String(entry.parent.entry.product?._id || "");
      const sameParent = isDerivedChild(product) && String(product.parentProduct) === targetId;
      if (!sameParent || getUnitsPerChild(product) !== entry.parent.units) {
        set.isChildProduct = true;
        set.unitsPerChild = entry.parent.units;
        set.packType = "unit";
        set.qtyPerPack = 1;
        entry.linkToParent = true;
        const currentParent = isDerivedChild(product) ? byId.get(String(product.parentProduct))?.name : null;
        entry.changes.push({
          field: "Child of",
          from: currentParent ? `${currentParent} (${getUnitsPerChild(product)} units)` : "none",
          to: `${entry.parent.label} (${entry.parent.units} units)`,
        });
        if (!isDerivedChild(product) && Number(product.quantity) > 0) {
          entry.warnings.push(`Its own stock (${product.quantity}) will be replaced by stock from the parent pack`);
        }
      }
    }

    // "Parent: none" — detach a child. Its stock stays with the pack, so it starts at 0 unless the
    // file gives it a Qty and stock updates are on (the same rule as the Unlink button on a product).
    if (unlinking) {
      const oldParent = byId.get(String(product.parentProduct))?.name || "its pack";
      set.isChildProduct = false;
      set.unitsPerChild = 1;
      entry.unset = { ...(entry.unset || {}), parentProduct: "" };
      entry.changes.push({
        field: "Child of",
        from: `${oldParent} (${getUnitsPerChild(product)} units)`,
        to: "none",
      });

      const keepsQty = qtyAllowed && updateExistingQty && product.isStockManaged !== false;
      if (qtyAllowed && !updateExistingQty) entry.qtyNotApplied = true;
      const nextQty = keepsQty ? row.quantity : 0;
      if (Math.abs(nextQty - (Number(product.quantity) || 0)) > QTY_TOLERANCE) {
        set.quantity = nextQty;
        entry.changes.push({ field: "Qty", from: Number(product.quantity) || 0, to: nextQty });
      }
      if (!keepsQty) entry.warnings.push("A detached product starts at 0 stock — the stock stays with the pack");
    }

    // "Pack Qty: none" — the pack becomes an ordinary product again and its children detach with it
    if (isDemoteRow(entry)) {
      set.packType = "unit";
      set.qtyPerPack = 1;
      entry.changes.push({ field: "Pack of", from: getPackSize(product), to: "not a pack" });

      // A child that has its own row here (re-linked or detached) is left to that row
      const detaching = childrenOf(product._id).filter((child) => {
        const ownRow = entryByProductId.get(String(child._id));
        return !(ownRow && !ownRow.error && (ownRow.parent || ownRow.row.unlinkParent));
      });
      if (detaching.length > 0) {
        entry.unlinkChildIds = detaching.map((child) => String(child._id));
        entry.changes.push({ field: "Children detached", to: detaching.length });
        entry.warnings.push(
          `${detaching.length} child product(s) detach and start at 0 stock: ${detaching.map((child) => child.name).join(", ")}`
        );
      }
    }

    entry.set = set;
    entry.action = entry.changes.length > 0 ? "update" : "unchanged";
  }

  const count = (action) => entries.filter((entry) => entry.action === action).length;
  const categoriesToCreate = [
    ...new Set(entries.filter((e) => e.action === "create" && e.doc.categoryName).map((e) => e.doc.categoryName)),
  ];

  return {
    entries,
    summary: {
      total: entries.length,
      create: count("create"),
      update: count("update"),
      unchanged: count("unchanged"),
      errors: count("error"),
      withWarnings: entries.filter((e) => e.warnings.length > 0).length,
      qtyNotApplied: entries.filter((e) => e.qtyNotApplied).length,
    },
    categoriesToCreate,
  };
}
