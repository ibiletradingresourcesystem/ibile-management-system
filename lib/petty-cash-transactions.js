import mongoose from "mongoose";
import Expense from "@/models/Expense";
import ExpenseCategory from "@/models/ExpenseCategory";
import PettyCashTransaction from "@/models/PettyCashTransaction";
import Product from "@/models/Product";
import StockMovement from "@/models/StockMovement";
import { deriveChildQty } from "@/lib/syncPackQty";
import { findVendorProductLink, vendorProductId } from "@/lib/vendorProducts";

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildStaffSnapshot(staff = null) {
  if (!staff) return null;
  return {
    _id: staff._id || null,
    name: staff.name || "",
    role: staff.role || "",
    email: staff.email || staff.onboardingData?.email || "",
  };
}

export function buildApprovalHistoryEntry({
  action,
  fromStatus = "",
  toStatus = "",
  note = "",
  staff = null,
  amount = 0,
  paymentMethod = "",
  paymentReference = "",
}) {
  return {
    action,
    fromStatus,
    toStatus,
    note: typeof note === "string" ? note.trim() : "",
    actedAt: new Date(),
    actedBy: buildStaffSnapshot(staff),
    amount: Number(amount) || 0,
    paymentMethod,
    paymentReference,
  };
}

export async function ensurePettyCashCategory() {
  let category = await ExpenseCategory.findOne({ name: "Supplies/Stock Purchase" });
  if (!category) {
    // These purchases become catalogue stock, so the spend belongs in inventory
    // and reaches profit as cost of goods sold, not as a running cost.
    category = await ExpenseCategory.create({ name: "Supplies/Stock Purchase", treatment: "INVENTORY" });
  }
  return category;
}

export async function syncPettyCashExpense(transaction) {
  const sourceQuery = {
    sourceType: "petty-cash-transaction",
    sourceId: String(transaction._id),
  };

  const existingExpense = transaction.expense
    ? await Expense.findById(transaction.expense)
    : await Expense.findOne(sourceQuery);

  if (transaction.status !== "Paid") {
    if (existingExpense) {
      await Expense.findByIdAndDelete(existingExpense._id);
    }
    return null;
  }

  const category = await ensurePettyCashCategory();
  const expenseDate = transaction.paidAt || transaction.requestDate || new Date();
  const paidBy = transaction.paidBy || transaction.requestedBy || null;

  const expensePayload = {
    title: `${transaction.vendorName} Purchase`,
    amount: Number(transaction.amount) || 0,
    categoryId: category._id,
    categoryName: "Supplies/Stock Purchase",
    description: [transaction.description, transaction.paymentReference]
      .filter(Boolean)
      .join(" | "),
    locationName: transaction.location,
    expenseDate: expenseDate,
    staffName: paidBy?.name || "",
    staffId: paidBy?._id || null,
    sourceType: "petty-cash-transaction",
    sourceId: String(transaction._id),
    vendor: {
      _id: transaction.vendor,
      companyName: transaction.vendorName,
    },
  };

  if (existingExpense) {
    await Expense.findByIdAndUpdate(existingExpense._id, expensePayload, {
      new: true,
      runValidators: true,
    });
    return existingExpense._id;
  }

  const createdExpense = await Expense.create(expensePayload);
  return createdExpense._id;
}

/** Orders that have reached the shop or been paid for: they cannot be cancelled, only deleted. */
export const SETTLED_PETTY_CASH_STATUSES = ["Received", "Paid"];

/** The stock movement receiving an order made (updateInventoryFromPettyCashReceive). */
const receiveRef = (transaction) => `PCTX-${transaction._id}`;

const roundQty = (value) => Math.round(Number(value || 0) * 10000) / 10000;

/** What receiving put into stock, one line per product. */
function receivedLines(movement) {
  const byProduct = new Map();
  for (const line of movement?.products || []) {
    const productId = String(line?.productId?._id || line?.productId || "");
    const quantity = Number(line?.quantity) || 0;
    if (!productId || quantity <= 0) continue;
    byProduct.set(productId, (byProduct.get(productId) || 0) + quantity);
  }
  return [...byProduct].map(([productId, quantity]) => ({ productId, quantity: roundQty(quantity) }));
}

const linkedExpenses = (transaction) => {
  const linked = [{ sourceType: "petty-cash-transaction", sourceId: String(transaction._id) }];
  if (transaction.expense) linked.push({ _id: transaction.expense?._id || transaction.expense });
  return { $or: linked };
};

/**
 * What deleting an order undoes, for the person to see before they confirm: the stock its
 * receipt added (and where that leaves each product) and the expense its payment made.
 *
 * @returns {Promise<{ stock: Array<{productId, name, quantity, stockNow, stockAfter}>, expenseTotal: number, expenseCount: number }>}
 */
export async function pettyCashUndoPlan(transaction) {
  const [movement, expenses] = await Promise.all([
    StockMovement.findOne({ transRef: receiveRef(transaction) }).select("products").lean(),
    Expense.find(linkedExpenses(transaction)).select("amount").lean(),
  ]);
  const lines = receivedLines(movement);
  const products = await Product.find({ _id: { $in: lines.map((l) => l.productId) } }).select("name quantity").lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  return {
    stock: lines.map(({ productId, quantity }) => {
      const product = byId.get(productId);
      const stockNow = product ? roundQty(product.quantity) : null;
      return {
        productId,
        name: product?.name || "A product no longer in the catalogue",
        quantity,
        stockNow,
        stockAfter: product ? roundQty(stockNow - quantity) : null,
      };
    }),
    expenseTotal: expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
    expenseCount: expenses.length,
  };
}

/**
 * Delete a petty cash order as if it had never been entered: the stock its receipt added comes
 * back out, that receipt's stock movement goes, and so does the expense its payment made. All in
 * one database transaction, so a failure part-way leaves everything as it was.
 *
 * Stock that has been sold since can take a product below zero: the order was a mistake, so the
 * shop never had it, and the count says so.
 *
 * @returns {Promise<{ expensesRemoved: number, stockReversed: Array<{productId, quantity}> }>}
 */
export async function deletePettyCashTransaction(transaction) {
  const session = await mongoose.startSession();
  let expensesRemoved = 0;
  let stockReversed = [];
  try {
    await session.withTransaction(async () => {
      const movement = await StockMovement.findOne({ transRef: receiveRef(transaction) }).session(session);
      stockReversed = receivedLines(movement);
      if (stockReversed.length > 0) {
        await Product.bulkWrite(
          stockReversed.map(({ productId, quantity }) => ({
            updateOne: { filter: { _id: productId }, update: { $inc: { quantity: -quantity } } },
          })),
          { session }
        );
      }
      if (movement) await StockMovement.deleteOne({ _id: movement._id }, { session });
      const removed = await Expense.deleteMany(linkedExpenses(transaction), { session });
      expensesRemoved = removed.deletedCount || 0;
      await PettyCashTransaction.deleteOne({ _id: transaction._id }, { session });
    });
  } finally {
    await session.endSession();
  }

  // Units made from a pack follow the pack's new count
  for (const { productId } of stockReversed) {
    await deriveChildQty(productId);
  }
  return { expensesRemoved, stockReversed };
}

/**
 * Turn the lines of a petty cash order into catalogue products.
 *
 * A product is looked for in this order: the line's own link, the vendor's price list,
 * then the catalogue by name. Nothing is created along the way — an order used to
 * create a product whenever the typed name did not match exactly, so a vendor with a
 * linked product ended up with a duplicate of it every time they were ordered from.
 *
 * Lines that match nothing come back under `unmatched`; they are only created when
 * an administrator has confirmed it (`allowCreate`).
 *
 * @returns {Promise<{ products: Array, unmatched: Array, created: Array }>}
 */
export async function processProductsFromPettyCash(productsData = [], vendorId = null, options = {}) {
  const { vendor = null, allowCreate = false } = options;

  if (!Array.isArray(productsData) || productsData.length === 0) {
    return { products: [], unmatched: [], created: [] };
  }

  const products = [];
  const unmatched = [];
  const created = [];

  for (const productData of productsData) {
    const { productName, costPrice, quantity } = productData;

    if (!productName || !costPrice || !quantity) {
      continue;
    }

    const name = String(productName).trim();
    let product = null;

    // 1. The line already says which product it is (picked from the vendor's list).
    const lineProductId = vendorProductId(productData);
    if (lineProductId) {
      product = await Product.findOne({ _id: lineProductId, isArchived: { $ne: true } });
    }

    // 2. The vendor's price list links this name to a product.
    if (!product) {
      const linkedId = findVendorProductLink(vendor, name);
      if (linkedId) {
        product = await Product.findOne({ _id: linkedId, isArchived: { $ne: true } });
      }
    }

    // 3. A product of that name is already in the catalogue.
    if (!product) {
      product = await Product.findOne({
        name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
        isArchived: { $ne: true },
      });
    }

    if (!product) {
      if (!allowCreate) {
        unmatched.push({ productName: name, costPrice: Number(costPrice), quantity: Number(quantity) });
        continue;
      }

      // Confirmed by an administrator: add it to the catalogue.
      product = await Product.create({
        name,
        description: `Created from Petty Cash Transaction - ${new Date().toLocaleDateString()}`,
        costPrice: Number(costPrice),
        salePriceIncTax: Math.round(Number(costPrice) * 1.25), // 25% markup as default
        quantity: 0, // Will be updated on receive
        isStockManaged: true,
        category: "Top Level",
        images: [],
        vendors: vendorId ? [vendorId] : [],
      });
      created.push(product.name);
    }

    products.push({
      productId: product._id,
      productName: product.name,
      costPrice: Number(costPrice) || Number(product.costPrice) || 0,
      quantity: Number(quantity),
    });
  }

  return { products, unmatched, created };
}

export async function updateInventoryFromPettyCashReceive(transaction) {
  if (!transaction.products || transaction.products.length === 0) {
    return null;
  }

  try {
    let totalCostPrice = 0;
    const products = [];

    // Update product quantities and collect for StockMovement
    for (const item of transaction.products) {
      if (!item.productId || !item.quantity) {
        continue;
      }

      const product = await Product.findById(item.productId);
      if (!product) {
        continue;
      }

      // Update product quantity
      const newQuantity = (product.quantity || 0) + Number(item.quantity);
      await Product.findByIdAndUpdate(
        item.productId,
        { quantity: newQuantity },
        { new: true }
      );

      totalCostPrice += Number(item.costPrice) * Number(item.quantity);
      products.push({
        productId: item.productId,
        quantity: Number(item.quantity),
        costPrice: Number(item.costPrice),
      });
    }

    // Create StockMovement record for inventory tracking
    if (products.length > 0) {
      const stockMovement = await StockMovement.create({
        transRef: `PCTX-${transaction._id}`,
        vendorName: transaction.vendorName,
        reason: "Restock",
        status: "Received",
        products: products,
        totalCostPrice: totalCostPrice,
        dateSent: transaction.requestDate || new Date(),
        dateReceived: new Date(),
        staffId: transaction.receivedBy?._id || null,
      });

      return stockMovement._id;
    }

    return null;
  } catch (error) {
    console.error("Error updating inventory from petty cash receive:", error);
    throw error;
  }
}
