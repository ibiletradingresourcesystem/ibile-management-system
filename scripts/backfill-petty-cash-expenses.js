/**
 * One-off: create the missing expenses for petty cash orders that were marked Paid on the POS.
 *
 * Until the POS fix, "Mark Paid" on the POS changed the order to Paid without recording an expense,
 * and an older POS version saved expenses without dates (so they were hidden from date-based views).
 *
 *   - Paid orders with no expense → an expense is created exactly like lib/petty-cash-transactions.js
 *     syncPettyCashExpense() does, dated when the order was paid
 *   - Paid orders whose expense exists but is not linked → the link is saved on the order
 *   - Petty cash expenses with no createdAt/expenseDate → dated from the order's paid date
 *   Nothing is duplicated: expenses are matched by the order id.
 *
 * Usage (from the inventory app folder, with MONGODB_URI in .env or .env.local):
 *   node scripts/backfill-petty-cash-expenses.js           # dry run: lists what would change
 *   node scripts/backfill-petty-cash-expenses.js --apply   # saves the changes
 */
require("dotenv").config({ path: ".env.local" });
require("dotenv").config();
const { MongoClient, ObjectId } = require("mongodb");

const CATEGORY_NAME = "Supplies/Stock Purchase";
const SOURCE_TYPE = "petty-cash-transaction";
const apply = process.argv.includes("--apply");

function toObjectId(value) {
  const id = value && value._id ? value._id : value;
  return id && ObjectId.isValid(String(id)) ? new ObjectId(String(id)) : null;
}

function paidDate(transaction) {
  return transaction.paidAt || transaction.updatedAt || transaction.requestDate || new Date();
}

function formatDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

async function ensureCategory(categories) {
  const existing = await categories.findOne({ name: CATEGORY_NAME });
  if (existing) return existing;
  if (!apply) return { _id: null };
  const now = new Date();
  const { insertedId } = await categories.insertOne({ name: CATEGORY_NAME, createdAt: now, updatedAt: now });
  return { _id: insertedId };
}

async function run() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");

  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db();
    const transactions = db.collection("pettycashtransactions");
    const expenses = db.collection("expenses");
    const category = await ensureCategory(db.collection("expensecategories"));

    const missing = [];
    const unlinked = [];
    const undated = [];
    let scanned = 0;

    for await (const transaction of transactions.find({ status: "Paid" })) {
      scanned += 1;
      const sourceId = String(transaction._id);
      const linkedId = toObjectId(transaction.expense);
      const expense =
        (linkedId && (await expenses.findOne({ _id: linkedId }))) ||
        (await expenses.findOne({ sourceType: SOURCE_TYPE, sourceId }));

      if (!expense) {
        missing.push(transaction);
        continue;
      }
      if (!linkedId || String(linkedId) !== String(expense._id)) {
        unlinked.push({ transaction, expense });
      }
      if (!expense.createdAt || !expense.expenseDate) {
        undated.push({ transaction, expense });
      }
    }

    const total = missing.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    console.log(`Scanned ${scanned} paid petty cash order(s).`);
    console.log(`- Missing expense: ${missing.length} (total ${total.toFixed(2)})`);
    missing.slice(0, 20).forEach((t) => {
      console.log(`    ${formatDate(paidDate(t))}  ${t.vendorName || t.purpose || "-"}  ${Number(t.amount) || 0}  ${t.location || ""}`);
    });
    if (missing.length > 20) console.log(`    …and ${missing.length - 20} more`);
    console.log(`- Expense exists but not linked to the order: ${unlinked.length}`);
    console.log(`- Petty cash expense with no date: ${undated.length}`);

    if (!apply) {
      console.log("\nDry run only — re-run with --apply to save.");
      return;
    }

    const now = new Date();
    for (const transaction of missing) {
      const paidAt = paidDate(transaction);
      const paidBy = transaction.paidBy || transaction.requestedBy || null;
      const { insertedId } = await expenses.insertOne({
        title: `${transaction.vendorName || transaction.purpose || "Petty Cash"} Purchase`,
        amount: Number(transaction.amount) || 0,
        categoryId: category._id,
        categoryName: CATEGORY_NAME,
        description: [transaction.description, transaction.paymentReference].filter(Boolean).join(" | "),
        locationName: transaction.location || "",
        expenseDate: paidAt,
        staffName: (paidBy && paidBy.name) || "",
        staffId: toObjectId(paidBy && paidBy._id),
        sourceType: SOURCE_TYPE,
        sourceId: String(transaction._id),
        vendor: { _id: toObjectId(transaction.vendor), companyName: transaction.vendorName || "" },
        createdAt: paidAt,
        updatedAt: now,
      });
      await transactions.updateOne({ _id: transaction._id }, { $set: { expense: insertedId } });
    }

    for (const { transaction, expense } of unlinked) {
      await transactions.updateOne({ _id: transaction._id }, { $set: { expense: expense._id } });
    }

    for (const { transaction, expense } of undated) {
      const paidAt = paidDate(transaction);
      await expenses.updateOne(
        { _id: expense._id },
        {
          $set: {
            createdAt: expense.createdAt || paidAt,
            expenseDate: expense.expenseDate || paidAt,
            updatedAt: expense.updatedAt || now,
          },
        }
      );
    }

    console.log(`\nCreated ${missing.length} expense(s), linked ${unlinked.length}, dated ${undated.length}.`);
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
