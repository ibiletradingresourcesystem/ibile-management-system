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
 *                            so a child's Qty cell is ignored. A child's cost is worked out from
 *                            the mother's cost and pack size (linkChildCost), so the two can never
 *                            drift apart; its Cost cell is ignored.
 * - VAT                    → applyVatToAll puts every row in the file on the single VAT rate, so
 *                            new and previously seeded products agree.
 * - skipUnchangedCost      → an existing product whose Cost matches what is stored is left alone
 *                            entirely: no price write, no VAT, no barcode repair. Re-importing a
 *                            price list then only touches the products whose cost actually moved.
 * - "Parent: none"         → detaches a child from its pack (it starts at 0 stock, as the stock
 *                            stays with the pack).
 * - "Pack Qty: none" (0)   → turns a pack back into an ordinary product; its children detach too.
 *   A blank cell always means "leave this as it is", so re-importing an old file changes nothing.
 */
import { formatBarcodes, repairStoredBarcodes, splitStoredBarcodes } from "@/lib/barcodes";
import { getPackSize, getUnitsPerChild, isDerivedChild } from "@/lib/packUnits";
import { calculateMarginPercent, normalizeTaxRate, roundMoney, VAT_RATE } from "@/lib/pricing";

/**
 * A child's share of the pack's cost: a pack of 24 at 6,000 makes each unit 250, so a child
 * holding 6 of them costs 1,500. Mirrors deriveChildCostPrice in lib/childPricing.js, which
 * keeps children in step after the import.
 */
function childCostFromPack(packCost, packSize, unitsPerChild) {
  const size = Number(packSize) > 0 ? Number(packSize) : 1;
  const units = Number(unitsPerChild) > 0 ? Number(unitsPerChild) : 1;
  return roundMoney(((Number(packCost) || 0) / size) * units);
}

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
 * @param {object}   args.options           { canSeedQty, updateExistingQty, fixBarcodes,
 *                                            linkChildCost, applyVatToAll }
 */
export function buildImportPlan({ rows = [], existingProducts = [], options = {} }) {
  const {
    canSeedQty = false,
    updateExistingQty = false,
    fixBarcodes = true,
    linkChildCost = true,
    applyVatToAll = true,
    skipUnchangedCost = false,
  } = options;

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
        /*
         * A pack and the single inside it usually carry the same barcode, so a child row matched
         * by barcode alone lands on the pack its own Parent cell points at. That is not the same
         * product — it is the unit inside it — so the row is created rather than rejected.
         *
         * A match by name is still trusted: two rows genuinely naming one product is a real
         * mistake in the file.
         */
        if (entry.row.parentRef && match.matchedBy === "barcode") {
          entry.warnings.push(
            `Barcode matches the pack "${match.product.name}" — this row has a Parent, so it is created as the unit inside it`
          );
        } else {
          fail(entry, `Matches the same existing product as row ${entryByProductId.get(productId).rowNumber}`);
          continue;
        }
      } else {
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

    let parentCost = 0;
    if (parentEntry) {
      if (parentEntry === entry) {
        fail(entry, "A product can't be its own parent");
        continue;
      }
      if (parentEntry.error) {
        // Repeating the parent's own reason saves hunting for its row in a file of thousands.
        fail(
          entry,
          `Parent "${parentEntry.name}" (row ${parentEntry.rowNumber}) was rejected: ${parentEntry.error}`
        );
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
      // The pack's cost after this import: the file's figure when it gives one,
      // otherwise whatever the pack already holds.
      parentCost = parentEntry.row.costPrice ?? (Number(parentEntry.product?.costPrice) || 0);
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
      parentCost = Number(parentProduct.costPrice) || 0;
      entry.parent = { product: parentProduct };
    }

    const parentId = entry.parent.product ? String(entry.parent.product._id) : entry.parent.entry.product?._id;
    if (entry.product && parentId && String(parentId) === String(entry.product._id)) {
      fail(entry, "A product can't be its own parent");
      continue;
    }
    if (!packSize || packSize <= 1) {
      // Point at the row to edit. A blank Pack Qty is fine once the parent is a pack in the
      // system; it is only needed the first time, to say how many units one pack holds.
      fail(
        entry,
        parentEntry
          ? `Parent "${parentLabel}" is not a pack yet — put a Pack Qty on row ${parentEntry.rowNumber} saying how many units one pack holds`
          : `Parent "${parentLabel}" is not a pack yet — add a row for it with a Pack Qty saying how many units one pack holds`
      );
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
    entry.parent.packSize = packSize;
    entry.parent.costPrice = parentCost;
    entry.parent.derivedCost = childCostFromPack(parentCost, packSize, units);
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

    // A child that follows its pack takes the pack's cost, not the file's. The two are the same
    // figure read at different sizes, and letting a sheet set them apart is how a pack of 24 ends
    // up costing less than the single unit inside it.
    const costLinked = isChild && linkChildCost;
    if (costLinked) {
      entry.costFromParent = true;
      if (row.costPrice !== null && Math.abs(row.costPrice - entry.parent.derivedCost) > PRICE_TOLERANCE) {
        entry.warnings.push(
          `Cost ${row.costPrice} replaced by ${entry.parent.derivedCost}, this child's share of "${entry.parent.label}"`
        );
      }
      if (entry.parent.costPrice <= 0) {
        entry.warnings.push(`"${entry.parent.label}" has no cost price, so this child's cost is 0`);
      }
    }
    const effectiveCost = costLinked ? entry.parent.derivedCost : row.costPrice;

    // Linking is off, but this product already follows a pack. Its Cost cell will
    // not survive the next sync, so say so rather than letting it look applied.
    if (!costLinked && !unlinking && row.costPrice !== null && entry.product?.costFromParent) {
      entry.warnings.push("This product's cost follows its pack, so the Cost column will not hold");
    }

    if (!entry.product) {
      const costPrice = effectiveCost ?? 0;
      const salePriceIncTax = row.salePriceIncTax ?? 0;
      if (effectiveCost === null) entry.warnings.push("No cost price — saved as 0");
      if (row.salePriceIncTax === null) entry.warnings.push("No sale price — saved as 0");

      /*
       * A new product never takes a code another product already holds — two products sharing a
       * barcode makes every scan of it ambiguous at the till. This is the same rule the barcode
       * repair applies to existing products, and it matters most for a pack and the single inside
       * it, which spreadsheets routinely give the same code.
       */
      const ownCodes = row.barcodes.filter((code) => {
        const owner = (byBarcode.get(code.toLowerCase()) || [])[0];
        if (!owner) return true;
        entry.warnings.push(`Barcode ${code} already belongs to "${owner.name}" — created without it`);
        return false;
      });

      entry.doc = {
        name: row.name,
        description: row.description || row.name,
        costPrice,
        salePriceIncTax,
        taxRate: VAT_RATE,
        margin: roundMoney(calculateMarginPercent(costPrice, salePriceIncTax, VAT_RATE)),
        barcode: formatBarcodes(ownCodes) || undefined,
        categoryName: row.category,
        quantity: qtyAllowed ? row.quantity : 0,
        packType: isPack ? "pack" : "unit",
        qtyPerPack: isPack ? row.packQty : 1,
        unitsPerChild: isChild ? entry.parent.units : 1,
        isChildProduct: isChild,
        costFromParent: costLinked,
      };

      entry.changes.push({ field: "Cost", to: costPrice }, { field: "Sale", to: salePriceIncTax });
      if (costLinked) {
        entry.changes.push({
          field: "Cost linked to",
          to: `${entry.parent.label} (${entry.parent.costPrice} ÷ ${entry.parent.packSize} × ${entry.parent.units})`,
        });
      }
      if (qtyAllowed) entry.changes.push({ field: "Qty", to: row.quantity });
      if (isPack) entry.changes.push({ field: "Pack of", to: row.packQty });
      if (isChild) entry.changes.push({ field: "Child of", to: `${entry.parent.label} (${entry.parent.units} units)` });
      continue;
    }

    // Existing product: prices, opted-in qty, and explicit pack/child columns only
    const product = entry.product;
    const set = {};

    /*
     * "Leave it alone when the cost has not moved."
     *
     * A price list re-imported month after month is mostly rows that have not changed. Writing
     * them anyway churns every product's updatedAt and makes the preview a wall of updates that
     * hides the handful of real price moves.
     *
     * Two kinds of row are never skipped, because they carry an instruction rather than price
     * drift: a Parent or Pack Qty cell, and a stock Qty the user has opted in to applying.
     */
    const storedCost = Number(product.costPrice) || 0;
    const costUnchanged =
      effectiveCost === null || Math.abs(effectiveCost - storedCost) <= PRICE_TOLERANCE;
    const structuralRow = isChild || isPack || unlinking || isDemoteRow(entry);
    const qtyWouldChange =
      qtyAllowed &&
      updateExistingQty &&
      product.isStockManaged !== false &&
      Math.abs(row.quantity - (Number(product.quantity) || 0)) > QTY_TOLERANCE;

    if (skipUnchangedCost && costUnchanged && !structuralRow && !qtyWouldChange) {
      // Say what was passed over, so a sale price sitting in the file is not silently dropped.
      if (
        row.salePriceIncTax !== null &&
        Math.abs(row.salePriceIncTax - (Number(product.salePriceIncTax) || 0)) > PRICE_TOLERANCE
      ) {
        entry.warnings.push(
          `Sale price ${row.salePriceIncTax} not applied — the cost is unchanged and "only changed costs" is on`
        );
      }
      entry.costUnchangedSkip = true;
      entry.set = {};
      entry.action = "unchanged";
      continue;
    }

    if (effectiveCost !== null && Math.abs(effectiveCost - (Number(product.costPrice) || 0)) > PRICE_TOLERANCE) {
      set.costPrice = effectiveCost;
      entry.changes.push({ field: "Cost", from: Number(product.costPrice) || 0, to: effectiveCost });
    }
    if (costLinked && product.costFromParent !== true) {
      set.costFromParent = true;
      entry.changes.push({
        field: "Cost linked to",
        from: "own cost",
        to: `${entry.parent.label} (${entry.parent.costPrice} ÷ ${entry.parent.packSize} × ${entry.parent.units})`,
      });
    }
    if (
      row.salePriceIncTax !== null &&
      Math.abs(row.salePriceIncTax - (Number(product.salePriceIncTax) || 0)) > PRICE_TOLERANCE
    ) {
      set.salePriceIncTax = row.salePriceIncTax;
      entry.changes.push({ field: "Sale", from: Number(product.salePriceIncTax) || 0, to: row.salePriceIncTax });
    }
    // New products are seeded with VAT, so a previously seeded one sitting at 0% is the odd one
    // out on the same shelf. applyVatToAll brings the whole file onto the one rate.
    //
    // With the option off nothing about VAT is volunteered: a stale rate (the retired 4.5%) is
    // still tidied to the rate the rest of the app already reads it as, but only when the row was
    // being written anyway for a price change.
    const priceChanged = "costPrice" in set || "salePriceIncTax" in set;
    const targetTaxRate = applyVatToAll
      ? VAT_RATE
      : priceChanged
        ? normalizeTaxRate(product.taxRate)
        : Number(product.taxRate) || 0;

    if (Number(product.taxRate) !== targetTaxRate) {
      set.taxRate = targetTaxRate;
      entry.changes.push({
        field: "VAT",
        from: `${Number(product.taxRate) || 0}%`,
        to: `${targetTaxRate}%`,
      });
    }

    if (priceChanged) {
      set.margin = roundMoney(
        calculateMarginPercent(set.costPrice ?? product.costPrice, set.salePriceIncTax ?? product.salePriceIncTax)
      );
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
      // A detached product holds its own cost again, or the next pack sync would
      // pull it back to a pack it no longer belongs to.
      if (product.costFromParent) {
        set.costFromParent = false;
        entry.changes.push({ field: "Cost linked to", from: oldParent, to: "own cost" });
      }
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
      childCostLinked: entries.filter((e) => e.costFromParent).length,
      vatApplied: entries.filter((e) => e.changes.some((c) => c.field === "VAT")).length,
      costUnchangedSkipped: entries.filter((e) => e.costUnchangedSkip).length,
    },
    categoriesToCreate,
  };
}
