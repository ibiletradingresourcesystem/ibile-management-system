import Expense from "@/models/Expense";
import ExpenseCategory from "@/models/ExpenseCategory";
import Product from "@/models/Product";
import StockMovement from "@/models/StockMovement";

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
    category = await ExpenseCategory.create({ name: "Supplies/Stock Purchase" });
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

export async function processProductsFromPettyCash(productsData = [], vendorId = null) {
  if (!Array.isArray(productsData) || productsData.length === 0) {
    return [];
  }

  const processedProducts = [];

  for (const productData of productsData) {
    const { productName, costPrice, quantity } = productData;

    if (!productName || !costPrice || !quantity) {
      continue;
    }

    // Check if product already exists by name
    let product = await Product.findOne({ 
      name: { $regex: `^${productName.trim()}$`, $options: "i" } 
    });

    if (!product) {
      // Create new product with default values
      const salePriceIncTax = Math.round(costPrice * 1.25); // 25% markup as default
      product = await Product.create({
        name: productName.trim(),
        description: `Created from Petty Cash Transaction - ${new Date().toLocaleDateString()}`,
        costPrice: Number(costPrice),
        salePriceIncTax: salePriceIncTax,
        quantity: 0, // Will be updated on receive
        isStockManaged: true,
        category: "Top Level",
        images: [],
        vendors: vendorId ? [vendorId] : [],
      });
    }

    processedProducts.push({
      productId: product._id,
      productName: product.name,
      costPrice: Number(product.costPrice),
      quantity: Number(quantity),
    });
  }

  return processedProducts;
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
