/**
 * Re-works every product's stored margin to the definition the app now uses:
 *
 *   margin % = (sale price - VAT - cost price) / (sale price - VAT) x 100
 *
 * Products saved before this held a mark-up on cost instead — the same profit divided by the cost
 * price, which always reads higher. Cost and sale prices are NEVER changed; only the margin field.
 *
 * Usage (from the inventory app folder, with MONGODB_URI in .env or .env.local):
 *   node scripts/recalculate-margins.js           # dry run: shows what would change
 *   node scripts/recalculate-margins.js --apply   # saves the changes
 */
require("dotenv").config({ path: ".env.local" });
require("dotenv").config();
const { MongoClient } = require("mongodb");

const apply = process.argv.includes("--apply");

function toNumber(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

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
    let scanned = 0;

    for await (const product of cursor) {
      scanned += 1;
      const nextMargin = marginPercent(
        toNumber(product.costPrice),
        toNumber(product.salePriceIncTax),
        toNumber(product.taxRate)
      );

      if (Math.abs(toNumber(product.margin) - nextMargin) <= 0.005 && typeof product.margin === "number") continue;

      if (ops.length < 10) {
        console.log(`- ${product.name}: margin ${product.margin ?? "-"} → ${nextMargin}`);
      }
      ops.push({ updateOne: { filter: { _id: product._id }, update: { $set: { margin: nextMargin } } } });
    }

    console.log(`\nScanned ${scanned} product(s). ${ops.length} need a new margin.`);

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
