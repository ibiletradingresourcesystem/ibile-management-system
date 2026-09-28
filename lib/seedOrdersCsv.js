/**
 * The CSV route into Seed Data.
 *
 * Seeding was only possible from the expense app export, which leaves anyone
 * without that app with no way to bring a stock of orders in. A spreadsheet is
 * the thing every shop already has, so the template here takes the same records
 * the export carries — vendors and their orders — in one flat sheet, and turns
 * it into the very same payload /api/purchase-orders/seed-import already reads.
 *
 * One row is one product line. Rows that share an Order Ref are one order, and
 * only the first of them needs the order-level columns filled in.
 */
import { parseDelimitedText } from "@/lib/productImport";

/** What the file is stamped with, so a seeded order says where it came from. */
export const CSV_SOURCE = "csv-template";

export const SEED_TEMPLATE_HEADERS = [
  "Order Ref",
  "Date",
  "Supplier",
  "Supplier Phone",
  "Contact",
  "Location",
  "Received",
  "Pay Before Supply",
  "Payment Made",
  "Payment Date",
  "Product",
  "Quantity",
  "Unit Price",
  "Units Per Pack",
];

/**
 * Two orders worth of example rows: one already received, which becomes a
 * purchase order, and one still on order, which joins Submitted Stock Orders.
 */
export const SEED_TEMPLATE_ROWS = [
  ["ORD-001", "12/03/2026", "Dangote Distributions", "08031234567", "Mr Adeyemi", "Main Shop", "Yes", "No", "450000", "12/03/2026", "Dangote Sugar 1kg", "100", "1200", "1"],
  ["ORD-001", "", "", "", "", "", "", "", "", "", "Dangote Salt 500g", "200", "450", "1"],
  ["ORD-002", "20/03/2026", "Ibile Foods Ltd", "08129876543", "Mrs Bello", "Main Shop", "No", "Yes", "150000", "18/03/2026", "Sachet Water (Bag of 20)", "50", "3000", "20"],
  ["ORD-002", "", "", "", "", "", "", "", "", "", "Biscuit Carton (30 units)", "10", "9000", "30"],
];

/** What each column is for, shown beside the download button. */
export const SEED_COLUMN_HELP = [
  ["Order Ref", "Required. Your own reference. Rows sharing one ref are one order, and re-importing the same ref adds nothing."],
  ["Date", "Order date, as 12/03/2026 or 2026-03-12. Blank means today."],
  ["Supplier", "Required. Matched to a vendor by name; a vendor is created when there is no match."],
  ["Supplier Phone", "Optional. Only used when the vendor has to be created."],
  ["Contact / Location", "Optional. The person dealt with, and where the goods are going."],
  ["Received", "Yes for goods already in — it becomes a purchase order marked received. No keeps it in Submitted Stock Orders."],
  ["Pay Before Supply", "Yes when the vendor is paid up front, so a paid order that is not yet delivered reads as Credit."],
  ["Payment Made", "How much of the order has been paid. Blank means nothing yet."],
  ["Product", "Required. The line as the vendor bills it."],
  ["Quantity / Unit Price", "What was ordered, and the price of one of whatever the quantity counts."],
  ["Units Per Pack", "Units of stock inside one ordered pack, e.g. 20 for a bag of sachet water. 1 or blank for plain units."],
];

const HEADER_KEYS = {
  orderRef: ["order ref", "orderref", "ref", "order reference", "order id", "order no", "order number", "invoice", "invoice no"],
  date: ["date", "order date", "order_date", "date ordered"],
  supplier: ["supplier", "vendor", "company", "company name", "vendor name", "supplier name"],
  supplierPhone: ["supplier phone", "phone", "vendor phone", "rep phone", "telephone", "mobile", "contact phone"],
  contact: ["contact", "contact person", "rep", "vendor rep", "attention"],
  location: ["location", "branch", "shop", "store", "outlet"],
  received: ["received", "delivered", "is received", "goods received", "received?"],
  payBeforeSupply: ["pay before supply", "paybeforesupply", "prepaid", "pay first", "advance payment", "pay before"],
  paymentMade: ["payment made", "paid", "amount paid", "paymentmade", "payment"],
  paymentDate: ["payment date", "paid on", "paymentdate", "date paid"],
  product: ["product", "item", "description", "product name", "item name", "goods"],
  quantity: ["quantity", "qty", "units ordered", "order qty", "count"],
  unitPrice: ["unit price", "price", "cost", "rate", "unit cost", "cost price"],
  unitsPerPack: ["units per pack", "pack size", "units in pack", "pack qty", "unitsperpack", "qty per pack"],
};

const YES_WORDS = new Set(["yes", "y", "true", "1", "received", "done", "delivered", "paid", "x"]);

const normalizeKey = (header) =>
  String(header ?? "")
    .replace(/﻿/g, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Which of our fields a sheet column is, or null when it is one we do not use. */
function fieldForHeader(header) {
  const key = normalizeKey(header);
  if (!key) return null;
  for (const [field, aliases] of Object.entries(HEADER_KEYS)) {
    if (aliases.includes(key)) return field;
  }
  return null;
}

export function isTruthyCell(value) {
  return YES_WORDS.has(String(value ?? "").trim().toLowerCase());
}

/** A money or quantity cell, with the naira sign, thousands commas and spaces taken off. */
export function toAmount(value) {
  const cleaned = String(value ?? "").replace(/[^\d.-]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

/**
 * A date from its parts, or null. Date() happily rolls 33/13 over into a real day
 * two years out, so the parts are checked before they are trusted.
 */
function buildDate(year, month, day) {
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;
  // 31 February would roll into March, so the day has to survive the round trip.
  return parsed.getMonth() === month - 1 && parsed.getDate() === day ? parsed : null;
}

/**
 * A date cell. Day first, because that is how the shop writes it; an ISO date is
 * taken as it stands. Anything unreadable comes back null so the caller can say so.
 */
export function toDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    return buildDate(Number(year), Number(month), Number(day));
  }

  const dayFirst = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dayFirst) {
    let [, day, month, year] = dayFirst;
    // A month over twelve means the sheet was written month-first after all.
    if (Number(month) > 12 && Number(day) <= 12) [day, month] = [month, day];
    const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year);
    return buildDate(fullYear, Number(month), Number(day));
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const nameKey = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * How a complaint names the line it is about. Blank lines are dropped before the
 * rows are counted, so the row number alone can sit a line or two off what the
 * spreadsheet shows — the order and product are what make it findable.
 */
function describeRow(rowNumber, row) {
  const parts = [row.orderRef, row.product].filter(Boolean).join(", ");
  return parts ? `Row ${rowNumber} (${parts})` : `Row ${rowNumber}`;
}

/** The template as CSV text, ready to be downloaded. */
export function buildSeedTemplateCsv() {
  const quote = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [SEED_TEMPLATE_HEADERS, ...SEED_TEMPLATE_ROWS].map((row) => row.map(quote).join(","));
  return `${lines.join("\n")}\n`;
}

/**
 * Turn a filled-in template into the payload the seed import reads.
 *
 * Returns the payload, whatever could not be used and why, and a count of the
 * orders and vendors found, so the modal can show all three before anything is
 * sent to the server.
 */
export function seedDataFromCsv(text) {
  const table = parseDelimitedText(text);
  if (!Array.isArray(table) || table.length < 2) {
    return { data: null, issues: ["That file has no rows under its header."], counts: { orders: 0, vendors: 0, lines: 0 } };
  }

  const fields = table[0].map(fieldForHeader);
  if (!fields.includes("supplier") || !fields.includes("product")) {
    return {
      data: null,
      issues: ["That file has no Supplier or no Product column. Use the template as it comes, keeping the header row."],
      counts: { orders: 0, vendors: 0, lines: 0 },
    };
  }

  const issues = [];
  const orders = new Map();
  const vendors = new Map();
  let lines = 0;

  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index] || [];
    if (cells.every((cell) => String(cell ?? "").trim() === "")) continue;

    const rowNumber = index + 1;
    const row = {};
    fields.forEach((field, column) => {
      if (field) row[field] = String(cells[column] ?? "").trim();
    });

    const ref = row.orderRef || "";
    if (!ref) {
      issues.push(`${describeRow(rowNumber, row)}: no Order Ref, so there is nothing to group this line under.`);
      continue;
    }
    if (!row.supplier && !orders.has(nameKey(ref))) {
      issues.push(`${describeRow(rowNumber, row)}: no Supplier, and no earlier row for ${ref} carries one.`);
      continue;
    }
    if (!row.product) {
      issues.push(`${describeRow(rowNumber, row)}: no Product, so the line was skipped.`);
      continue;
    }

    const refKey = nameKey(ref);
    if (!orders.has(refKey)) {
      const date = row.date ? toDate(row.date) : null;
      if (row.date && !date) issues.push(`${describeRow(rowNumber, row)}: could not read the date "${row.date}", so today was used.`);
      const paymentDate = row.paymentDate ? toDate(row.paymentDate) : null;
      if (row.paymentDate && !paymentDate) issues.push(`${describeRow(rowNumber, row)}: could not read the payment date "${row.paymentDate}".`);

      orders.set(refKey, {
        sourceId: `csv:${ref}`,
        orderRefInFile: ref,
        supplier: row.supplier,
        vendorSourceId: `csv-vendor:${nameKey(row.supplier)}`,
        date: (date || new Date()).toISOString(),
        contact: row.contact || "",
        location: row.location || "",
        received: isTruthyCell(row.received),
        payBeforeSupply: isTruthyCell(row.payBeforeSupply),
        paymentMade: toAmount(row.paymentMade),
        paymentDate: paymentDate ? paymentDate.toISOString() : "",
        mainProduct: row.product,
        products: [],
      });
    }

    const order = orders.get(refKey);
    // A later row may carry a detail the first one left blank.
    if (!order.contact && row.contact) order.contact = row.contact;
    if (!order.location && row.location) order.location = row.location;
    if (!order.paymentMade && row.paymentMade) order.paymentMade = toAmount(row.paymentMade);

    const quantity = toAmount(row.quantity);
    const price = toAmount(row.unitPrice);
    if (quantity <= 0) issues.push(`${describeRow(rowNumber, row)}: no quantity, so the line counts as zero.`);
    if (price <= 0) issues.push(`${describeRow(rowNumber, row)}: no unit price, so the line counts as zero.`);

    const unitsPerPack = toAmount(row.unitsPerPack);
    order.products.push({
      name: row.product,
      quantity,
      price,
      total: quantity * price,
      supplyPackSize: unitsPerPack > 1 ? unitsPerPack : 1,
    });
    lines += 1;

    /* ── The vendor, built from the orders it supplied ─────────────── */
    const vendorKey = nameKey(order.supplier);
    if (!vendors.has(vendorKey)) {
      vendors.set(vendorKey, {
        sourceId: `csv-vendor:${vendorKey}`,
        companyName: order.supplier,
        vendorRep: row.contact || "",
        repPhone: row.supplierPhone || "",
        mainProduct: row.product,
        products: [],
      });
    }
    const vendor = vendors.get(vendorKey);
    if (!vendor.repPhone && row.supplierPhone) vendor.repPhone = row.supplierPhone;
    if (!vendor.vendorRep && row.contact) vendor.vendorRep = row.contact;
    // The price list comes free with the orders: the last price seen for a line wins.
    const priced = vendor.products.find((entry) => nameKey(entry.name) === nameKey(row.product));
    if (priced) priced.price = price;
    else vendor.products.push({ name: row.product, price });
  }

  const stockOrders = [...orders.values()].map((order) => ({
    ...order,
    grandTotal: order.products.reduce((sum, line) => sum + line.total, 0),
  }));

  if (stockOrders.length === 0) {
    issues.unshift("Nothing in that file could be read as an order.");
    return { data: null, issues, counts: { orders: 0, vendors: 0, lines } };
  }

  return {
    data: {
      source: CSV_SOURCE,
      version: 1,
      exportedAt: new Date().toISOString(),
      vendors: [...vendors.values()],
      stockOrders,
    },
    issues,
    counts: { orders: stockOrders.length, vendors: vendors.size, lines },
  };
}
