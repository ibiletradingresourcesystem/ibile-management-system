/**
 * One-off clean-up after retiring the 4.5% VAT rate. 7.5% is now the only rate.
 *
 *   - Products with any positive VAT rate other than 7.5 (e.g. 4.5) are set to 7.5
 *   - Stored margin is recalculated from cost, sale price and VAT (% on cost, before VAT)
 *   - Sale prices and cost prices are NEVER changed
 *
 * Usage (from the inventory app folder, with MONGODB_URI in .env or .env.local):
 *   node scripts/normalize-vat.js                          # dry run: shows what would change
 *   node scripts/normalize-vat.js --apply                  # saves the changes
 *   node scripts/normalize-vat.js --apply --vat-on-untaxed # also applies 7.5% VAT to products with none
 */
require("dotenv").config({ path: ".env.local" });
require("dotenv").config();
const { MongoClient } = require("mongodb");

const VAT_RATE = 7.5;
const apply = process.argv.includes("--apply");
const vatOnUntaxed = process.argv.includes("--vat-on-untaxed");

function toNumber(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

// margin % = (sale - VAT - cost) / (sale - VAT), the same sum the app uses
function marginPercent(cost, sale, taxRate) {
  if (sale <= 0) return 0;
  if (cost <= 0) return 100;
  const saleExTax = taxRate > 0 ? sale / (1 + taxRate / 100) : sale;
  if (saleExTax <= 0) return 0;
  return Math.round((((saleExTax - cost) / saleExTax) * 100 + Number.EPSILON) * 100) / 100;
}

async function run() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");

  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const products = client.db().collection("products");
    const cursor = products.find({}, { projection: { name: 1, costPrice: 1, salePriceIncTax: 1, taxRate: 1, margin: 1 } });

    const ops = [];
    const stats = { scanned: 0, rateChanged: 0, vatAdded: 0, marginChanged: 0 };

    for await (const product of cursor) {
      stats.scanned += 1;
      const currentRate = toNumber(product.taxRate);
      const nextRate = currentRate > 0 || vatOnUntaxed ? VAT_RATE : 0;
      const nextMargin = marginPercent(toNumber(product.costPrice), toNumber(product.salePriceIncTax), nextRate);

      const set = {};
      if (currentRate !== nextRate) {
        set.taxRate = nextRate;
        if (currentRate > 0) stats.rateChanged += 1;
        else stats.vatAdded += 1;
      }
      if (Math.abs(toNumber(product.margin) - nextMargin) > 0.005 || typeof product.margin !== "number") {
        set.margin = nextMargin;
        stats.marginChanged += 1;
      }

      if (Object.keys(set).length > 0) {
        if (ops.length < 10) {
          console.log(`- ${product.name}: VAT ${currentRate} → ${set.taxRate ?? currentRate}, margin ${product.margin ?? "-"} → ${set.margin ?? product.margin}`);
        }
        ops.push({ updateOne: { filter: { _id: product._id }, update: { $set: set } } });
      }
    }

    console.log("\nSummary:", stats, `\n${ops.length} product(s) need updating.`);

    if (!apply) {
      console.log("Dry run only — re-run with --apply to save.");
      return;
    }

    for (let i = 0; i < ops.length; i += 500) {
      await products.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
    console.log(`Saved ${ops.length} product(s).`);
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
