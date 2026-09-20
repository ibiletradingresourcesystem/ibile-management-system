/**
 * Product seed/import file parsing, shared by the import page (reading the file) and
 * the import API (normalising each row).
 *
 * Columns (header names are matched loosely, see HEADER_ALIASES):
 *   Name*, Description, Cost, Sale, Barcode, Category,
 *   Qty       – stock quantity (packs for a pack product)
 *   Pack Qty  – makes the row a mother/pack product holding this many units (e.g. 24).
 *               "none" (or 0) turns an existing pack back into an ordinary product.
 *   Parent    – name or barcode of the mother/pack product this row is a child of.
 *               "none" detaches an existing child from its pack.
 *   Units     – units of the parent's pack in one of this child (e.g. 6, 2 or 1)
 */
import { looksLikeBarcode, normalizeBarcodes } from "@/lib/barcodes";
import { sanitizeMultilineText, sanitizePlainText } from "@/lib/textSanitizers";

export const IMPORT_TEMPLATE_HEADERS = [
  "Name", "Description", "Cost", "Sale", "Barcode", "Category", "Qty", "Pack Qty", "Parent", "Units",
];

const HEADER_ALIASES = {
  name: ["name", "product name", "product", "item", "item name", "product title", "title"],
  description: ["description", "desc", "details", "product description"],
  costPrice: ["cost", "cost price", "costprice", "buying price", "purchase price", "unit cost"],
  salePriceIncTax: ["sale", "sale price", "saleprice", "sales price", "selling price", "salepriceinctax", "price", "retail price"],
  barcode: ["barcode", "barcodes", "bar code", "bar codes", "code", "sku", "upc", "ean"],
  category: ["category", "cat", "product category", "group", "department"],
  quantity: ["qty", "quantity", "stock", "stock qty", "stock quantity", "opening stock", "on hand", "qty on hand", "current stock", "stock level"],
  packQty: ["pack qty", "qty per pack", "pack size", "units per pack", "packqty", "qtyperpack", "pack quantity"],
  parent: ["parent", "parent product", "mother", "mother product", "parent name", "parent barcode", "pack product"],
  unitsPerChild: ["units", "units per child", "unitsperchild", "child units", "units in child", "unit qty", "units per item"],
};

/**
 * Words that mean "no parent" in the Parent column and "not a pack" in Pack Qty. They are how a
 * sheet undoes a link, so re-importing an old file (where the cell is simply blank) changes nothing.
 */
const CLEAR_WORDS = new Set([
  "none", "no", "no parent", "not a parent", "not a pack", "nil", "null", "remove", "removed",
  "unlink", "unlinked", "clear", "detach", "standalone", "single", "unit", "-", "--", "n/a", "na",
]);

export function isClearWord(value) {
  return CLEAR_WORDS.has(String(value ?? "").toLowerCase().replace(/s+/g, " ").trim());
}

export function normalizeHeader(header) {
  const text = String(header ?? "")
    .toLowerCase()
    .replace(/[_\-.*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = Object.entries(HEADER_ALIASES).find(([, aliases]) => aliases.includes(text));
  return match ? match[0] : null;
}

function detectDelimiter(text) {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of text) {
    if (ch === "\n" && !inQuotes) break;
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  const [delimiter, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return count > 0 ? delimiter : ",";
}

/**
 * Quote-aware CSV/TSV parser. Quoted cells may contain delimiters and line breaks
 * (e.g. several barcodes entered on separate lines of one Excel cell).
 */
export function parseDelimitedText(input) {
  const text = String(input ?? "").replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const table = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.trim() === "") {
      inQuotes = true;
      field = "";
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      table.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    table.push(row);
  }

  return table
    .map((cells) => cells.map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ""));
}

function cellToString(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value === "number") return Number.isInteger(value) ? value.toFixed(0) : String(value);
  return String(value).trim();
}

/**
 * An unquoted "code1, code2" in a CSV spills the second code into the next columns.
 * Pull barcode-looking cells that follow the barcode column back into it.
 */
function mergeBarcodeOverflow(values, keys) {
  while (values.length > keys.length && values[values.length - 1] === "") values.pop();

  const barcodeIndex = keys.indexOf("barcode");
  const extra = values.length - keys.length;
  if (barcodeIndex < 0 || extra <= 0) return;

  let taken = 0;
  while (taken < extra && looksLikeBarcode(values[barcodeIndex + 1 + taken])) taken += 1;
  if (taken === 0) return;

  const merged = values.slice(barcodeIndex, barcodeIndex + taken + 1).filter(Boolean).join(", ");
  values.splice(barcodeIndex, taken + 1, merged);
}

/**
 * Converts a sheet (array of rows, first row = headers) into raw row objects.
 * @returns {{ rows: object[], columns: string[], unknownHeaders: string[] }}
 */
export function rowsFromTable(table) {
  if (!Array.isArray(table) || table.length < 2) {
    return { rows: [], columns: [], unknownHeaders: [] };
  }

  const headers = table[0].map(cellToString);
  const keys = headers.map(normalizeHeader);
  const rows = [];

  for (let i = 1; i < table.length; i += 1) {
    const values = (table[i] || []).map(cellToString);
    mergeBarcodeOverflow(values, keys);

    const row = { _row: i + 1 };
    keys.forEach((key, index) => {
      if (key && values[index]) row[key] = values[index];
    });
    if (Object.keys(row).length > 1) rows.push(row);
  }

  return {
    rows,
    columns: [...new Set(keys.filter(Boolean))],
    unknownHeaders: headers.filter((header, index) => header && !keys[index]),
  };
}

/** "₦1,350.00" → 1350; blank → null; unreadable → NaN */
export function parseImportNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const text = String(value).replace(/ngn|₦|\$|,|\s/gi, "");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Cleans one raw row for planning. Invalid numbers become null with a warning.
 */
export function normalizeImportRow(raw = {}, index = 0) {
  const warnings = [];

  const readNumber = (key, label, { min = 0, integer = false } = {}) => {
    const n = parseImportNumber(raw[key]);
    if (n === null) return null;
    if (Number.isNaN(n)) {
      warnings.push(`${label} "${raw[key]}" is not a number — ignored`);
      return null;
    }
    if (n < min || (integer && !Number.isInteger(n))) {
      warnings.push(`${label} ${n} is not valid — ignored`);
      return null;
    }
    return n;
  };

  const { barcodes, warnings: barcodeWarnings } = normalizeBarcodes(raw.barcode);
  warnings.push(...barcodeWarnings);

  // "Parent: none" detaches a child, "Pack Qty: none" (or 0) turns a pack back into a plain product
  const parentText = sanitizePlainText(raw.parent);
  const unlinkParent = isClearWord(parentText);
  const demotePack = isClearWord(raw.packQty) || parseImportNumber(raw.packQty) === 0;

  return {
    rowNumber: Number(raw._row) || index + 2,
    name: sanitizePlainText(raw.name),
    description: sanitizeMultilineText(raw.description),
    costPrice: readNumber("costPrice", "Cost"),
    salePriceIncTax: readNumber("salePriceIncTax", "Sale price"),
    barcodes,
    category: sanitizePlainText(raw.category),
    quantity: readNumber("quantity", "Qty"),
    packQty: demotePack ? null : readNumber("packQty", "Pack Qty", { min: 1, integer: true }),
    demotePack,
    parentRef: unlinkParent ? "" : parentText,
    unlinkParent,
    unitsPerChild: readNumber("unitsPerChild", "Units", { min: 1, integer: true }),
    warnings,
  };
}

/**
 * Buckets a skip reason so a preview can say "48 duplicate rows, 3 missing names, 2 bad parents"
 * instead of listing fifty individually worded sentences. The reasons are written for a person to
 * read, so they are matched on their distinctive wording rather than on an error code.
 *
 * @param {string} message the `error` on a row that was not imported
 * @returns {{ key: string, label: string, hint: string }}
 */
export function classifySkipReason(message) {
  const text = String(message || "").toLowerCase();
  const bucket = (key, label, hint) => ({ key, label, hint });

  if (!text) return bucket("unknown", "No reason recorded", "Check the row in the table below.");

  if (text.startsWith("duplicate of row")) {
    return bucket(
      "duplicate-row",
      "The same product appears twice in the file",
      "Only the first row is used. Delete the repeats, or merge them into one row."
    );
  }
  if (text.includes("matches the same existing product")) {
    return bucket(
      "same-product",
      "Two rows point at one product",
      "Two differently named rows matched the same product in the system. Keep one."
    );
  }
  if (text.includes("missing product name")) {
    return bucket("no-name", "No product name", "The Name cell is empty. Every row needs a name.");
  }
  if (text.includes("existing products are named")) {
    return bucket(
      "ambiguous-name",
      "Several products share this name",
      "The system holds more than one product under this name, so the file cannot tell them apart. Rename them, or update those products by hand."
    );
  }
  if (text.includes("barcode matches")) {
    return bucket(
      "ambiguous-barcode",
      "The barcode is on several products",
      "The code in the file belongs to more than one product. Fix the duplicate codes first."
    );
  }
  if (text.includes("already uses that")) {
    return bucket(
      "duplicate-in-system",
      "A value is already taken by another product",
      "Usually a barcode. Change it in the file, or clear it and add it on the product itself."
    );
  }
  if (text.includes("isn't a pack")) {
    return bucket(
      "parent-not-pack",
      "The parent is not a pack",
      "Give the mother row a Pack Qty of 2 or more so it can hold children."
    );
  }
  if (text.includes("linked as a child")) {
    return bucket(
      "child-becoming-pack",
      "A child cannot become a pack",
      'Put "none" in the Parent column on the same row to detach it first.'
    );
  }
  if (text.includes("can't be both") || text.includes("own parent") || text.includes("already has child products")) {
    return bucket(
      "bad-hierarchy",
      "The mother and child columns conflict",
      "A row cannot be a pack and a child at once, be its own parent, or become a child while it already has children."
    );
  }
  // These two are anchored on how the message opens, because each also mentions the other
  // column ("Units … more than the parent's Pack Qty") and would otherwise be miscounted.
  if (text.startsWith("pack qty ")) {
    return bucket(
      "pack-size-problem",
      "The Pack Qty value does not fit",
      "Pack Qty must be 2 or more, and at least as large as the biggest existing child."
    );
  }
  if (text.startsWith("units (")) {
    return bucket(
      "units-problem",
      "The Units value does not fit the pack",
      "Units must be 1 or more and no larger than the mother's Pack Qty."
    );
  }
  if (text.includes("parent")) {
    return bucket(
      "parent-problem",
      "The Parent cell could not be used",
      "The mother product is missing, archived, ambiguous, or is itself a child. Check the Parent column."
    );
  }
  if (text.includes("rejected by the product rules") || text.includes("wrong type")) {
    return bucket(
      "rejected",
      "Rejected by the product rules",
      "A cell holds a value the product record will not accept. The row detail names the field."
    );
  }
  if (text.includes("could not be saved")) {
    return bucket(
      "not-saved",
      "The database refused the row",
      "Usually a duplicate name or barcode. The row detail carries the exact reason."
    );
  }

  return bucket("other", "Other", "See the reason on the row in the table below.");
}
