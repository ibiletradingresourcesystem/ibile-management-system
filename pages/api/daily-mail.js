import path from "path";
import { mongooseConnect } from "@/lib/mongoose";
import Product from "@/models/Product";
import Store from "@/models/Store";
import Transaction from "@/models/Transactions";
import Expense from "@/models/Expense";
import StockMovement from "@/models/StockMovement";
import jwt from "jsonwebtoken";
import { createMailTransport, getMailEnvValue, getMailFromAddress } from "@/lib/mail";
import { aggregateProductSales } from "@/lib/product-sales-report";
import { buildLocationCache, resolveLocationName } from "@/lib/serverLocationHelper";

function isDerivedChildProduct(product) {
  return product?.isChildProduct && product?.packType !== "pack";
}

function normalizeLocationValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getProductId(product) {
  return String(product?._id || product?.id || "");
}

function getMovementLocationLabel(locationId, locationCache) {
  const key = String(locationId || "").trim();
  if (!key) return "";
  return String(locationCache[key] || locationCache[key.toLowerCase()] || key).trim();
}

function getItemQuantity(item) {
  const quantity = Number(item?.qty ?? item?.quantity ?? 0);
  return Number.isFinite(quantity) ? quantity : 0;
}

function ensureProductLocationMap(stockByProduct, productId) {
  if (!stockByProduct.has(productId)) {
    stockByProduct.set(productId, new Map());
  }

  return stockByProduct.get(productId);
}

function addLocationQuantity(stockByProduct, productId, locationLabel, quantity) {
  const normalizedLocation = normalizeLocationValue(locationLabel);
  if (!productId || !normalizedLocation || !Number.isFinite(quantity) || quantity === 0) return;

  const locationMap = ensureProductLocationMap(stockByProduct, productId);
  const existing = locationMap.get(normalizedLocation) || {
    locationName: String(locationLabel || "").trim(),
    quantity: 0,
  };

  existing.quantity += quantity;
  locationMap.set(normalizedLocation, existing);
}

function resolveStockProductDelta(productMap, productId, quantity) {
  const product = productMap.get(String(productId || ""));
  if (!product) return null;

  if (isDerivedChildProduct(product)) {
    const parentId = String(product.parentProduct || "");
    const parent = productMap.get(parentId);
    const unitsPerPack = Number(parent?.qtyPerPack || product.qtyPerPack || 1) || 1;
    return { productId: parentId, quantity: quantity / unitsPerPack };
  }

  return { productId: String(product._id), quantity };
}

function getAssignedLocationNames(product, locationCache, activeLocationNameByKey) {
  const assignedLocations = Array.isArray(product?.locations) ? product.locations : [];
  const namesByKey = new Map();

  assignedLocations.forEach((locationValue) => {
    const reportName = getReportLocationName(locationValue, locationCache, activeLocationNameByKey);
    if (reportName) {
      namesByKey.set(normalizeLocationValue(reportName), reportName);
    }
  });

  return Array.from(namesByKey.values());
}

function getReportLocationName(value, locationCache, activeLocationNameByKey) {
  const resolvedName = getMovementLocationLabel(value, locationCache);
  const normalizedName = normalizeLocationValue(resolvedName);
  if (!normalizedName || normalizedName === "unknown" || normalizedName === "vendor") return "";
  return activeLocationNameByKey.get(normalizedName) || activeLocationNameByKey.get(normalizeLocationValue(value)) || resolvedName;
}

function roundStockQuantity(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function createStockLocationSummary(locationName) {
  return {
    location: locationName,
    totalUnits: 0,
    totalCostValue: 0,
    totalSaleValue: 0,
    productCount: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
  };
}

function ensureStockLocation(stockByLocation, locationName) {
  const name = String(locationName || "").trim();
  if (!name) return null;
  if (!stockByLocation[name]) {
    stockByLocation[name] = createStockLocationSummary(name);
  }
  return stockByLocation[name];
}

function getMonthRange(referenceDate = new Date()) {
  const start = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const nextMonthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 1);
  const end = new Date(nextMonthStart.getTime() - 1);
  return { start, end, nextMonthStart };
}

function isLastDayOfMonth(date = new Date()) {
  const tomorrow = new Date(date);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.getDate() === 1;
}

function getCreditPaymentTotalForRange(transaction, start, endExclusive) {
  return (Array.isArray(transaction.creditPayments) ? transaction.creditPayments : []).reduce((sum, payment) => {
    const paidAt = payment?.paidAt ? new Date(payment.paidAt) : null;
    if (!paidAt || Number.isNaN(paidAt.getTime()) || paidAt < start || paidAt >= endExclusive) return sum;
    return sum + Number(payment.amount || 0);
  }, 0);
}

function getCreditPaidTotal(transaction) {
  const payments = Array.isArray(transaction.creditPayments) ? transaction.creditPayments : [];
  if (payments.length > 0) {
    return payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  }
  return Number(transaction.creditPaidAmount || 0);
}

function getCreditBalance(transaction) {
  const total = Number(transaction.creditOriginalTotal || transaction.total || 0);
  return Math.max(0, total - getCreditPaidTotal(transaction));
}

export default async function handler(req, res) {
  try {
    // Auth check - Allow JWT, CRON_SECRET, or Vercel Cron
    if (process.env.NODE_ENV === "production") {
      const key = req.query.key;
      const auth = req.headers.authorization;

      // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
      if (
        key === process.env.CRON_SECRET ||
        auth === `Bearer ${process.env.CRON_SECRET}`
      ) {
        console.log("[Monthly Mail] ✅ Authorized via CRON_SECRET");
      } else if (auth && auth.startsWith("Bearer ")) {
        // Verify JWT token for admin users
        try {
          const token = auth.substring(7);
          if (!process.env.JWT_SECRET) {
            return res.status(500).json({ error: "JWT_SECRET not configured" });
          }
          jwt.verify(token, process.env.JWT_SECRET);
          console.log("[Monthly Mail] ✅ Authorized via JWT token");
        } catch (tokenErr) {
          console.log("[Monthly Mail] ❌ Invalid JWT token:", tokenErr.message);
          return res.status(401).json({ error: "Unauthorized" });
        }
      } else {
        console.log("[Monthly Mail] ❌ No valid authorization");
        return res.status(401).json({ error: "Unauthorized" });
      }
    }

    if (req.method !== "POST" && req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    console.log("[Monthly Mail] Generating comprehensive monthly report...");

    const monthlyReportTo = getMailEnvValue(
      "MONTHLY_REPORT_MAIL_TO",
      "MONTHLY_REPORT_EMAIL_TO",
      "REPORT_MAIL_TO",
      "TEST_EMAIL",
      "FROM_EMAIL",
      "EMAIL_USER"
    );
    console.log("[Monthly Mail] Mail config:", {
      hasRecipient: Boolean(monthlyReportTo),
      hasSender: Boolean(getMailEnvValue("MAIL_FROM", "SMTP_FROM", "EMAIL_FROM", "FROM_EMAIL", "SMTP_USER", "EMAIL_USER")),
    });

    const isCronAuthorized =
      req.query.key === process.env.CRON_SECRET ||
      req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
    const forceSend = req.query.force === "1" || req.query.force === "true";

    if (isCronAuthorized && !forceSend && !isLastDayOfMonth(new Date())) {
      return res.status(200).json({
        message: "Monthly report skipped because today is not the last day of the month.",
        skipped: true,
        timestamp: new Date().toISOString(),
      });
    }

    if (!monthlyReportTo) {
      console.log("[Monthly Mail] Missing monthly report recipient");
      return res.status(500).json({
        error: "Missing MONTHLY_REPORT_MAIL_TO in .env",
        hint: "Set MONTHLY_REPORT_MAIL_TO or MONTHLY_REPORT_EMAIL_TO for monthly reports",
      });
    }

    // Connect to database
    await mongooseConnect();
    console.log("[Monthly Mail] Connected to MongoDB");

    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const { start: monthStart, end: monthEnd, nextMonthStart } = getMonthRange(now);
    const reportMonthLabel = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const reportRangeLabel = `${monthStart.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} - ${monthEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

    // =====================
    // FETCH ALL DATA
    // =====================

    // 1. Get Store with locations and build location cache
    const stores = await Store.find().lean();
    const storesMap = {};
    const locationsMap = await buildLocationCache(); // Use centralized helper
    
    stores.forEach((store) => {
      storesMap[store._id.toString()] = store;
    });

    // Get all location names for report
    const allLocations = [];
    stores.forEach((store) => {
      if (store.locations) {
        store.locations.forEach((loc) => {
          if (loc.isActive !== false) {
            allLocations.push({ id: loc._id.toString(), name: loc.name });
          }
        });
      }
    });

    // 2. Get completed transactions for the month
    const transactions = await Transaction.find({
      createdAt: { $gte: monthStart, $lt: nextMonthStart },
      status: "completed",
    }).lean();
    console.log(`[Monthly Mail] Found ${transactions.length} completed transactions`);

    // 3. Get expenses for the month
    const expenses = await Expense.find({
      $or: [
        { createdAt: { $gte: monthStart, $lt: nextMonthStart } },
        { expenseDate: { $gte: monthStart, $lt: nextMonthStart } },
      ],
    }).lean();
    console.log(`[Monthly Mail] Found ${expenses.length} expenses`);

    const [creditIssuedThisMonth, creditAccounts] = await Promise.all([
      Transaction.find({
        createdAt: { $gte: monthStart, $lt: nextMonthStart },
        status: "credit",
      }).lean(),
      Transaction.find({
        $or: [
          { status: "credit" },
          { creditPayments: { $elemMatch: { paidAt: { $gte: monthStart, $lt: nextMonthStart } } } },
        ],
      }).lean(),
    ]);

    // 5. Get all products for stock report
    const allProducts = await Product.find({
      isArchived: { $ne: true },
      isStockManaged: { $ne: false },
    }).lean();
    console.log(`[Monthly Mail] Found ${allProducts.length} products`);

    const productMap = new Map(allProducts.map((product) => [getProductId(product), product]));
    const [stockMovements, stockTransactions] = await Promise.all([
      StockMovement.find({ status: "Received" })
        .select("fromLocationId toLocationId reason products dateReceived dateSent")
        .lean(),
      Transaction.find({ status: { $in: ["completed", "refunded", "credit"] } })
        .select("location status subStatus items createdAt")
        .lean(),
    ]);
    console.log(`[Monthly Mail] Found ${stockMovements.length} stock movements and ${stockTransactions.length} stock transactions for location stock`);

    const productCostById = {};
    allProducts.forEach((product) => {
      if (product?._id) {
        productCostById[product._id.toString()] = product.costPrice || 0;
      }
    });

    const tenderBreakdownByLocation = {};

    // =====================
    // PROCESS TRANSACTIONS FOR SALES BY LOCATION
    // =====================
    const salesByLocation = {};
    const tenderTotals = {};
    const transactionTenderBreakdownByLocation = {};
    let totalCogsMonth = 0;
    let missingProductIdCount = 0;
    let missingCostCount = 0;
    const productSalesSummary = aggregateProductSales(transactions);
    const totalItemsSold = productSalesSummary.reduce(
      (sum, product) => sum + (product.unitsSold || 0),
      0,
    );

    for (const tx of transactions) {
      const locName = await resolveLocationName(tx.location, locationsMap);

      if (!salesByLocation[locName]) {
        salesByLocation[locName] = {
          location: locName,
          totalSales: 0,
          transactionCount: 0,
          itemsSold: 0,
        };
      }
      salesByLocation[locName].totalSales += tx.total || 0;
      salesByLocation[locName].transactionCount += 1;

      if (!transactionTenderBreakdownByLocation[locName]) {
        transactionTenderBreakdownByLocation[locName] = {};
      }

      // Count items sold
      if (tx.items && Array.isArray(tx.items)) {
        tx.items.forEach((item) => {
          const itemQty = Number(item.qty || item.quantity || 0);
          salesByLocation[locName].itemsSold += itemQty;

          const itemProductId =
            item.productId?.toString?.() ||
            item.productId ||
            item._id?.toString?.() ||
            item._id;
          if (!itemProductId) {
            missingProductIdCount += 1;
            console.warn(
              "[Monthly Mail] Missing productId for transaction item:",
              {
                transactionId: tx?._id?.toString?.() || tx?._id,
                location: tx?.location || "Unknown",
                itemName: item?.name || "Unnamed item",
                quantity: itemQty,
                price: item?.salePriceIncTax ?? item?.price ?? null,
              },
            );
          }
          const hasCostFromCatalog =
            itemProductId &&
            Object.prototype.hasOwnProperty.call(
              productCostById,
              itemProductId,
            );
          const resolvedCost = item.costPrice ??
            (hasCostFromCatalog ? productCostById[itemProductId] : null);
          if (itemProductId && resolvedCost === null) {
            missingCostCount += 1;
            console.warn("[Monthly Mail] Missing cost price for product:", {
              transactionId: tx?._id?.toString?.() || tx?._id,
              location: tx?.location || "Unknown",
              productId: itemProductId,
              itemName: item?.name || "Unnamed item",
            });
          }
          const itemCost = Number(resolvedCost ?? 0);
          totalCogsMonth += itemQty * itemCost;
        });
      }

      // Aggregate tender totals
      if (Array.isArray(tx.tenderPayments) && tx.tenderPayments.length > 0) {
        tx.tenderPayments.forEach((payment) => {
          const tenderName = payment.tenderName || payment.tenderType || "Unknown";
          const amount = Number(payment.amount || 0);

          tenderTotals[tenderName] = (tenderTotals[tenderName] || 0) + amount;
          transactionTenderBreakdownByLocation[locName][tenderName] =
            (transactionTenderBreakdownByLocation[locName][tenderName] || 0) + amount;
        });
      } else {
        const tender = tx.tenderType || "CASH";
        const amount = Number(tx.total || 0);

        tenderTotals[tender] = (tenderTotals[tender] || 0) + amount;
        transactionTenderBreakdownByLocation[locName][tender] =
          (transactionTenderBreakdownByLocation[locName][tender] || 0) + amount;
      }
    }

    const displayedTenderBreakdownByLocation =
      Object.keys(tenderBreakdownByLocation).length > 0
        ? tenderBreakdownByLocation
        : transactionTenderBreakdownByLocation;

    // =====================
    // PROCESS EXPENSES BY LOCATION
    // =====================
    const expensesByLocation = {};
    let totalExpenses = 0;

    expenses.forEach((exp) => {
      const locName = exp.locationName || "Unassigned";

      if (!expensesByLocation[locName]) {
        expensesByLocation[locName] = {
          location: locName,
          totalAmount: 0,
          count: 0,
          categories: {},
        };
      }
      expensesByLocation[locName].totalAmount += exp.amount || 0;
      expensesByLocation[locName].count += 1;
      totalExpenses += exp.amount || 0;

      // Track by category
      const catName = exp.categoryName || "Uncategorized";
      expensesByLocation[locName].categories[catName] =
        (expensesByLocation[locName].categories[catName] || 0) +
        (exp.amount || 0);
    });

    // =====================
    // PROCESS STOCK BY LOCATION
    // =====================
    const stockByLocation = {};
    const expiringSoonProducts = [];
    const lowStockProducts = [];
    const expiringSoonDays = 30;
    const expiringSoonCutoff = new Date(today);
    expiringSoonCutoff.setDate(expiringSoonCutoff.getDate() + expiringSoonDays);
    const msPerDay = 1000 * 60 * 60 * 24;
    const activeLocationNameByKey = new Map();

    // Initialize all locations
    allLocations.forEach((loc) => {
      activeLocationNameByKey.set(normalizeLocationValue(loc.id), loc.name);
      activeLocationNameByKey.set(normalizeLocationValue(loc.name), loc.name);
      ensureStockLocation(stockByLocation, loc.name);
    });

    const stockByProduct = new Map();

    stockMovements.forEach((movement) => {
      const fromLocationName = getMovementLocationLabel(movement.fromLocationId, locationsMap);
      const toLocationName = getMovementLocationLabel(movement.toLocationId, locationsMap);

      (Array.isArray(movement.products) ? movement.products : []).forEach((item) => {
        const quantity = Number(item?.quantity || 0);
        if (!Number.isFinite(quantity) || quantity <= 0) return;

        const resolved = resolveStockProductDelta(productMap, item.productId, quantity);
        if (!resolved?.productId) return;

        if (movement.reason === "Restock") {
          addLocationQuantity(stockByProduct, resolved.productId, toLocationName, resolved.quantity);
        } else if (movement.reason === "Transfer") {
          addLocationQuantity(stockByProduct, resolved.productId, fromLocationName, -resolved.quantity);
          addLocationQuantity(stockByProduct, resolved.productId, toLocationName, resolved.quantity);
        } else if (["Return", "Adjustment", "Operational Loss"].includes(movement.reason)) {
          addLocationQuantity(stockByProduct, resolved.productId, fromLocationName, -resolved.quantity);
        }
      });
    });

    stockTransactions.forEach((transaction) => {
      if (transaction.subStatus === "void") return;

      const locationName = getMovementLocationLabel(transaction.location, locationsMap) || "online";
      const sign = transaction.status === "refunded" ? 1 : -1;

      (Array.isArray(transaction.items) ? transaction.items : []).forEach((item) => {
        const quantity = getItemQuantity(item);
        if (quantity <= 0) return;

        const resolved = resolveStockProductDelta(productMap, item.productId, quantity);
        if (!resolved?.productId) return;

        addLocationQuantity(stockByProduct, resolved.productId, locationName, sign * resolved.quantity);
      });
    });

    // Process products by assigned locations plus physical stock movement locations.
    for (const product of allProducts) {
      if (isDerivedChildProduct(product)) {
        continue;
      }

      const costPrice = product.costPrice || 0;
      const salePrice = product.salePriceIncTax || 0;
      const minStock = product.minStock || 0;
      const productName = product.name || product.title || "Unnamed product";
      const productId = getProductId(product);
      const productLocationStock = stockByProduct.get(productId) || new Map();
      const targetLocations = new Map();
      const expiryDateValue = product.expiryDate
        ? new Date(product.expiryDate)
        : null;

      getAssignedLocationNames(product, locationsMap, activeLocationNameByKey).forEach((locationName) => {
        targetLocations.set(normalizeLocationValue(locationName), locationName);
      });

      productLocationStock.forEach((entry) => {
        const locationName = getReportLocationName(entry.locationName, locationsMap, activeLocationNameByKey);
        if (locationName) {
          targetLocations.set(normalizeLocationValue(locationName), locationName);
        }
      });

      const addExpiringEntry = (locName, quantity) => {
        if (!expiryDateValue || quantity <= 0) {
          return;
        }
        if (expiryDateValue <= expiringSoonCutoff) {
          const daysToExpiry = Math.ceil(
            (expiryDateValue.getTime() - today.getTime()) / msPerDay,
          );
          expiringSoonProducts.push({
            name: productName,
            location: locName,
            quantity,
            expiryDate: expiryDateValue,
            daysToExpiry,
          });
        }
      };

      const addLowStockEntry = (locName, quantity) => {
        if (minStock > 0 && quantity <= minStock) {
          lowStockProducts.push({
            name: productName,
            location: locName,
            quantity,
            minStock,
          });
        }
      };

      if (targetLocations.size === 0) {
        const qty = Number(product.quantity || 0);
        if (qty <= 0) continue;
        const fallbackLocation = allLocations.length > 0 ? allLocations[0].name : "Unassigned";
        targetLocations.set(normalizeLocationValue(fallbackLocation), fallbackLocation);
      }

      targetLocations.forEach((locName, locationKey) => {
        const stockSummary = ensureStockLocation(stockByLocation, locName);
        if (!stockSummary) return;

        const locationStock = productLocationStock.get(locationKey);
        const fallbackQuantity = targetLocations.size === 1 ? Number(product.quantity || 0) : 0;
        const quantity = roundStockQuantity(locationStock ? locationStock.quantity : fallbackQuantity);

        stockSummary.totalUnits += quantity;
        stockSummary.totalCostValue += quantity * costPrice;
        stockSummary.totalSaleValue += quantity * salePrice;
        stockSummary.productCount += 1;

        if (quantity === 0) {
          stockSummary.outOfStockItems += 1;
        } else if (minStock > 0 && quantity <= minStock) {
          stockSummary.lowStockItems += 1;
        }

        addExpiringEntry(locName, quantity);
        addLowStockEntry(locName, quantity);
      });
    }

    // =====================
    // CALCULATE TOTALS
    // =====================
    const totalSales = Object.values(salesByLocation).reduce(
      (sum, l) => sum + l.totalSales,
      0,
    );
    const totalTransactionCount = Object.values(salesByLocation).reduce(
      (sum, l) => sum + l.transactionCount,
      0,
    );
    const totalStockValue = Object.values(stockByLocation).reduce(
      (sum, l) => sum + l.totalSaleValue,
      0,
    );
    const totalStockCost = Object.values(stockByLocation).reduce(
      (sum, l) => sum + l.totalCostValue,
      0,
    );
    const creditIssuedTotal = creditIssuedThisMonth.reduce(
      (sum, transaction) => sum + Number(transaction.creditOriginalTotal || transaction.total || 0),
      0,
    );
    const creditRecoveredThisMonth = creditAccounts.reduce(
      (sum, transaction) => sum + getCreditPaymentTotalForRange(transaction, monthStart, nextMonthStart),
      0,
    );
    const outstandingCredit = creditAccounts
      .filter((transaction) => !["paid", "written_off"].includes(transaction.creditStatus))
      .reduce((sum, transaction) => sum + getCreditBalance(transaction), 0);
    const creditByCustomer = new Map();
    creditAccounts.forEach((transaction) => {
      const customerName = transaction.creditCustomerName || transaction.customerName || "Credit Customer";
      const current = creditByCustomer.get(customerName) || { customerName, issued: 0, recovered: 0, outstanding: 0 };
      const transactionDate = transaction.createdAt ? new Date(transaction.createdAt) : null;
      if (transactionDate && !Number.isNaN(transactionDate.getTime()) && transactionDate >= monthStart && transactionDate < nextMonthStart) {
        current.issued += Number(transaction.creditOriginalTotal || transaction.total || 0);
      }
      current.recovered += getCreditPaymentTotalForRange(transaction, monthStart, nextMonthStart);
      if (!["paid", "written_off"].includes(transaction.creditStatus)) {
        current.outstanding += getCreditBalance(transaction);
      }
      creditByCustomer.set(customerName, current);
    });
    const creditCustomerRows = Array.from(creditByCustomer.values())
      .filter((row) => row.issued || row.recovered || row.outstanding)
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 15);
    const grossProfitMonth = totalSales - totalCogsMonth;
    const netProfitMonth = grossProfitMonth - totalExpenses;

    expiringSoonProducts.sort(
      (a, b) => a.expiryDate - b.expiryDate || a.quantity - b.quantity,
    );
    lowStockProducts.sort((a, b) => a.quantity - b.quantity);

    // =====================
    // BUILD HTML REPORT
    // =====================
    const formatMoney = (val) =>
      `₦${Number(val || 0).toLocaleString("en-NG", { minimumFractionDigits: 0 })}`;
    const formatShortDate = (date) =>
      new Date(date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

    const mailHtml = `
      <div style="font-family: Arial, sans-serif; padding: 20px; background: #f5f5f5; max-width: 900px; margin: 0 auto;">
        
        <!-- HEADER -->
        <div style="background: linear-gradient(135deg, #1f2937 0%, #374151 100%); color: white; padding: 25px; border-radius: 10px; margin-bottom: 20px;">
          <table style="width: 100%;">
            <tr>
              <td style="width: 70px; vertical-align: middle;">
                <img src="cid:businessLogo" alt="St. Micheals" style="width: 60px; height: 60px; border-radius: 8px; background: white; padding: 5px;" onerror="this.style.display='none'" />
              </td>
              <td style="vertical-align: middle; padding-left: 15px;">
                <h1 style="margin: 0; font-size: 24px;">Monthly Business Report</h1>
                <p style="margin: 5px 0 0 0; opacity: 0.9; font-size: 14px;">St. Micheals Inventory System</p>
              </td>
            </tr>
          </table>
          <p style="margin: 15px 0 0 0; opacity: 0.9;">${reportMonthLabel}</p>
          <p style="margin: 5px 0 0 0; opacity: 0.8; font-size: 13px;">${reportRangeLabel}</p>
          <p style="margin: 5px 0 0 0; opacity: 0.7; font-size: 12px;">Generated: ${new Date().toLocaleString()}</p>
          <div style="margin-top: 18px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; padding: 14px;">
            <p style="margin: 0 0 10px 0; color: rgba(255,255,255,0.72); font-size: 11px; text-transform: uppercase; letter-spacing: 0.7px; font-weight: bold;">Monthly Snapshot</p>
            <div style="display: flex; flex-wrap: wrap; gap: 12px;">
              <div style="flex: 1; min-width: 130px;">
                <p style="margin: 0; color: rgba(255,255,255,0.72); font-size: 11px;">Total Sales</p>
                <p style="margin: 4px 0 0 0; font-size: 21px; font-weight: bold; color: #ffffff;">${formatMoney(totalSales)}</p>
              </div>
              <div style="flex: 1; min-width: 110px;">
                <p style="margin: 0; color: rgba(255,255,255,0.72); font-size: 11px;">Transactions</p>
                <p style="margin: 4px 0 0 0; font-size: 20px; font-weight: bold; color: #bfdbfe;">${totalTransactionCount}</p>
              </div>
              <div style="flex: 1; min-width: 130px;">
                <p style="margin: 0; color: rgba(255,255,255,0.72); font-size: 11px;">Expenses</p>
                <p style="margin: 4px 0 0 0; font-size: 20px; font-weight: bold; color: #fecaca;">${formatMoney(totalExpenses)}</p>
              </div>
              <div style="flex: 1; min-width: 130px;">
                <p style="margin: 0; color: rgba(255,255,255,0.72); font-size: 11px;">Stock Value</p>
                <p style="margin: 4px 0 0 0; font-size: 20px; font-weight: bold; color: #fde68a;">${formatMoney(totalStockValue)}</p>
              </div>
              <div style="flex: 1; min-width: 130px;">
                <p style="margin: 0; color: rgba(255,255,255,0.72); font-size: 11px;">Credit Outstanding</p>
                <p style="margin: 4px 0 0 0; font-size: 20px; font-weight: bold; color: #fed7aa;">${formatMoney(outstandingCredit)}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- TENDER BREAKDOWN BY LOCATION -->
        <div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #8b5cf6;">
          <h2 style="color: #8b5cf6; margin-top: 0; font-size: 18px;">💳 Tender Breakdown by Location</h2>
          ${
            Object.keys(displayedTenderBreakdownByLocation).length === 0
              ? '<p style="color: #999; font-style: italic;">No tender data available for this month</p>'
              : Object.entries(displayedTenderBreakdownByLocation)
                  .map(
                    ([location, tenders]) => `
              <div style="margin-bottom: 15px; padding: 15px; background: #f9fafb; border-radius: 8px;">
                <h3 style="margin: 0 0 10px 0; color: #374151; font-size: 14px;">📍 ${location}</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 10px;">
                  ${Object.entries(tenders)
                    .map(
                      ([tender, amount]) => `
                    <div style="background: white; padding: 10px 15px; border-radius: 6px; border: 1px solid #e5e7eb;">
                      <span style="color: #666; font-size: 12px;">${tender}</span>
                      <span style="display: block; font-weight: bold; color: #1f2937;">${formatMoney(amount)}</span>
                    </div>
                  `,
                    )
                    .join("")}
                </div>
              </div>
            `,
                  )
                  .join("")
          }
          
          <!-- Total Tender Summary -->
          ${
            Object.keys(tenderTotals).length > 0
              ? `
            <div style="margin-top: 15px; padding: 15px; background: #ede9fe; border-radius: 8px;">
              <h3 style="margin: 0 0 10px 0; color: #6d28d9; font-size: 14px;">📊 Overall Tender Totals</h3>
              <div style="display: flex; flex-wrap: wrap; gap: 10px;">
                ${Object.entries(tenderTotals)
                  .map(
                    ([tender, amount]) => `
                  <div style="background: white; padding: 10px 15px; border-radius: 6px; border: 1px solid #c4b5fd;">
                    <span style="color: #666; font-size: 12px;">${tender}</span>
                    <span style="display: block; font-weight: bold; color: #6d28d9;">${formatMoney(amount)}</span>
                  </div>
                `,
                  )
                  .join("")}
              </div>
            </div>
          `
              : ""
          }
        </div>

        <!-- STOCK REPORT BY LOCATION -->
        <div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #f59e0b;">
          <h2 style="color: #f59e0b; margin-top: 0; font-size: 18px;">📦 Stock Report by Location</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #fffbeb;">
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #f59e0b; font-size: 13px;">Location</th>
                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #f59e0b; font-size: 13px;">Units</th>
                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #f59e0b; font-size: 13px;">Cost Value</th>
                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #f59e0b; font-size: 13px;">Sale Value</th>
                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #f59e0b; font-size: 13px;">Low Stock</th>
                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #f59e0b; font-size: 13px;">Out of Stock</th>
              </tr>
            </thead>
            <tbody>
              ${Object.values(stockByLocation)
                .filter((s) => s.productCount > 0)
                .map(
                  (stock) => `
                <tr style="border-bottom: 1px solid #e5e7eb;">
                  <td style="padding: 12px; font-weight: 600;">${stock.location}</td>
                  <td style="padding: 12px; text-align: right;">${stock.totalUnits.toLocaleString()}</td>
                  <td style="padding: 12px; text-align: right; color: #666;">${formatMoney(stock.totalCostValue)}</td>
                  <td style="padding: 12px; text-align: right; color: #059669; font-weight: 600;">${formatMoney(stock.totalSaleValue)}</td>
                  <td style="padding: 12px; text-align: right; color: ${stock.lowStockItems > 0 ? "#f59e0b" : "#059669"}; font-weight: 600;">${stock.lowStockItems}</td>
                  <td style="padding: 12px; text-align: right; color: ${stock.outOfStockItems > 0 ? "#dc2626" : "#059669"}; font-weight: 600;">${stock.outOfStockItems}</td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
            <tfoot>
              <tr style="background: #fef3c7; font-weight: bold;">
                <td style="padding: 12px;">TOTAL</td>
                <td style="padding: 12px; text-align: right;">${Object.values(
                  stockByLocation,
                )
                  .reduce((s, l) => s + l.totalUnits, 0)
                  .toLocaleString()}</td>
                <td style="padding: 12px; text-align: right;">${formatMoney(totalStockCost)}</td>
                <td style="padding: 12px; text-align: right; color: #059669;">${formatMoney(totalStockValue)}</td>
                <td style="padding: 12px; text-align: right;">${Object.values(stockByLocation).reduce((s, l) => s + l.lowStockItems, 0)}</td>
                <td style="padding: 12px; text-align: right;">${Object.values(stockByLocation).reduce((s, l) => s + l.outOfStockItems, 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- EXPIRING SOON & LOW STOCK -->
        <div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #f97316;">
          <h2 style="color: #f97316; margin-top: 0; font-size: 18px;">⏰ Expiring Soon & Low Stock</h2>
          <div style="display: flex; flex-wrap: wrap; gap: 15px;">
            <div style="flex: 1; min-width: 260px; background: #fff7ed; padding: 15px; border-radius: 8px; border: 1px solid #fed7aa;">
              <h3 style="margin: 0 0 10px 0; color: #c2410c; font-size: 14px;">Expiring in next ${expiringSoonDays} days</h3>
              ${
                expiringSoonProducts.length === 0
                  ? '<p style="margin: 0; color: #9a3412; font-style: italic;">No expiring products found</p>'
                  : `<table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                      <tr>
                        <th style="padding: 6px; text-align: left; border-bottom: 1px solid #fdba74;">Product</th>
                        <th style="padding: 6px; text-align: left; border-bottom: 1px solid #fdba74;">Location</th>
                        <th style="padding: 6px; text-align: right; border-bottom: 1px solid #fdba74;">Qty</th>
                        <th style="padding: 6px; text-align: right; border-bottom: 1px solid #fdba74;">Expiry</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${expiringSoonProducts
                        .slice(0, 15)
                        .map((item) => {
                          const status =
                            item.daysToExpiry < 0
                              ? `Expired ${Math.abs(item.daysToExpiry)}d`
                              : `In ${item.daysToExpiry}d`;
                          return `
                        <tr>
                          <td style="padding: 6px; border-bottom: 1px solid #ffedd5; font-weight: 600;">${item.name}</td>
                          <td style="padding: 6px; border-bottom: 1px solid #ffedd5;">${item.location}</td>
                          <td style="padding: 6px; text-align: right; border-bottom: 1px solid #ffedd5;">${item.quantity}</td>
                          <td style="padding: 6px; text-align: right; border-bottom: 1px solid #ffedd5;">${formatShortDate(item.expiryDate)} (${status})</td>
                        </tr>
                      `;
                        })
                        .join("")}
                    </tbody>
                  </table>
                  ${
                    expiringSoonProducts.length > 15
                      ? `<p style="margin: 8px 0 0 0; color: #9a3412; font-size: 11px;">Showing 15 of ${expiringSoonProducts.length}</p>`
                      : ""
                  }`
              }
            </div>

            <div style="flex: 1; min-width: 260px; background: #fef2f2; padding: 15px; border-radius: 8px; border: 1px solid #fecaca;">
              <h3 style="margin: 0 0 10px 0; color: #b91c1c; font-size: 14px;">Low stock (at or below min)</h3>
              ${
                lowStockProducts.length === 0
                  ? '<p style="margin: 0; color: #991b1b; font-style: italic;">No low stock items</p>'
                  : `<table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                      <tr>
                        <th style="padding: 6px; text-align: left; border-bottom: 1px solid #fca5a5;">Product</th>
                        <th style="padding: 6px; text-align: left; border-bottom: 1px solid #fca5a5;">Location</th>
                        <th style="padding: 6px; text-align: right; border-bottom: 1px solid #fca5a5;">Qty</th>
                        <th style="padding: 6px; text-align: right; border-bottom: 1px solid #fca5a5;">Min</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${lowStockProducts
                        .slice(0, 15)
                        .map(
                          (item) => `
                        <tr>
                          <td style="padding: 6px; border-bottom: 1px solid #fee2e2; font-weight: 600;">${item.name}</td>
                          <td style="padding: 6px; border-bottom: 1px solid #fee2e2;">${item.location}</td>
                          <td style="padding: 6px; text-align: right; border-bottom: 1px solid #fee2e2;">${item.quantity}</td>
                          <td style="padding: 6px; text-align: right; border-bottom: 1px solid #fee2e2;">${item.minStock}</td>
                        </tr>
                      `,
                        )
                        .join("")}
                    </tbody>
                  </table>
                  ${
                    lowStockProducts.length > 15
                      ? `<p style="margin: 8px 0 0 0; color: #991b1b; font-size: 11px;">Showing 15 of ${lowStockProducts.length}</p>`
                      : ""
                  }`
              }
            </div>
          </div>
        </div>

        <!-- CREDIT MANAGEMENT -->
        <div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #d97706;">
          <h2 style="color: #b45309; margin-top: 0; font-size: 18px;">Credit Management (${reportMonthLabel})</h2>
          <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 15px;">
            <div style="flex: 1; min-width: 160px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px;">
              <p style="margin: 0; color: #92400e; font-size: 12px;">Credit Issued</p>
              <p style="margin: 6px 0 0 0; color: #78350f; font-size: 20px; font-weight: bold;">${formatMoney(creditIssuedTotal)}</p>
            </div>
            <div style="flex: 1; min-width: 160px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 12px;">
              <p style="margin: 0; color: #047857; font-size: 12px;">Recovered</p>
              <p style="margin: 6px 0 0 0; color: #065f46; font-size: 20px; font-weight: bold;">${formatMoney(creditRecoveredThisMonth)}</p>
            </div>
            <div style="flex: 1; min-width: 160px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px;">
              <p style="margin: 0; color: #991b1b; font-size: 12px;">Outstanding</p>
              <p style="margin: 6px 0 0 0; color: #7f1d1d; font-size: 20px; font-weight: bold;">${formatMoney(outstandingCredit)}</p>
            </div>
          </div>
          ${
            creditCustomerRows.length === 0
              ? '<p style="color: #999; font-style: italic;">No credit activity recorded for this month</p>'
              : `<table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background: #fffbeb;">
                  <th style="padding: 12px; text-align: left; border-bottom: 2px solid #d97706; font-size: 13px;">Customer</th>
                  <th style="padding: 12px; text-align: right; border-bottom: 2px solid #d97706; font-size: 13px;">Issued</th>
                  <th style="padding: 12px; text-align: right; border-bottom: 2px solid #d97706; font-size: 13px;">Recovered</th>
                  <th style="padding: 12px; text-align: right; border-bottom: 2px solid #d97706; font-size: 13px;">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                ${creditCustomerRows
                  .map(
                    (row) => `
                  <tr style="border-bottom: 1px solid #fef3c7;">
                    <td style="padding: 12px; font-weight: 600;">${row.customerName}</td>
                    <td style="padding: 12px; text-align: right; color: #92400e; font-weight: 600;">${formatMoney(row.issued)}</td>
                    <td style="padding: 12px; text-align: right; color: #047857; font-weight: 600;">${formatMoney(row.recovered)}</td>
                    <td style="padding: 12px; text-align: right; color: #b91c1c; font-weight: 600;">${formatMoney(row.outstanding)}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>`
          }
        </div>

        <!-- SALES BY LOCATION -->
        <div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #059669;">
          <h2 style="color: #059669; margin-top: 0; font-size: 18px;">🛒 Sales by Location (${reportMonthLabel})</h2>
          ${
            Object.keys(salesByLocation).length === 0
              ? '<p style="color: #999; font-style: italic;">No sales recorded for this month</p>'
              : `<table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background: #ecfdf5;">
                  <th style="padding: 12px; text-align: left; border-bottom: 2px solid #059669; font-size: 13px;">Location</th>
                  <th style="padding: 12px; text-align: right; border-bottom: 2px solid #059669; font-size: 13px;">Sales Total</th>
                  <th style="padding: 12px; text-align: right; border-bottom: 2px solid #059669; font-size: 13px;">Transactions</th>
                  <th style="padding: 12px; text-align: right; border-bottom: 2px solid #059669; font-size: 13px;">Items Sold</th>
                </tr>
              </thead>
              <tbody>
                ${Object.values(salesByLocation)
                  .map(
                    (loc) => `
                  <tr style="border-bottom: 1px solid #e5e7eb;">
                    <td style="padding: 12px; font-weight: 600;">${loc.location}</td>
                    <td style="padding: 12px; text-align: right; color: #059669; font-weight: 600;">${formatMoney(loc.totalSales)}</td>
                    <td style="padding: 12px; text-align: right;">${loc.transactionCount}</td>
                    <td style="padding: 12px; text-align: right;">${loc.itemsSold}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>`
          }
        </div>

        <!-- EXPENSES BY LOCATION -->
        <div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #dc2626;">
          <h2 style="color: #dc2626; margin-top: 0; font-size: 18px;">💸 Expenses by Location (${reportMonthLabel})</h2>
          ${
            Object.keys(expensesByLocation).length === 0
              ? '<p style="color: #999; font-style: italic;">No expenses recorded for this month</p>'
              : `<table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background: #fef2f2;">
                  <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dc2626; font-size: 13px;">Location</th>
                  <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dc2626; font-size: 13px;">Total Amount</th>
                  <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dc2626; font-size: 13px;">Count</th>
                  <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dc2626; font-size: 13px;">Categories</th>
                </tr>
              </thead>
              <tbody>
                ${Object.values(expensesByLocation)
                  .map(
                    (loc) => `
                  <tr style="border-bottom: 1px solid #e5e7eb;">
                    <td style="padding: 12px; font-weight: 600;">${loc.location}</td>
                    <td style="padding: 12px; text-align: right; color: #dc2626; font-weight: 600;">${formatMoney(loc.totalAmount)}</td>
                    <td style="padding: 12px; text-align: right;">${loc.count}</td>
                    <td style="padding: 12px; font-size: 12px; color: #666;">
                      ${Object.entries(loc.categories)
                        .map(([cat, amt]) => `${cat}: ${formatMoney(amt)}`)
                        .join(", ")}
                    </td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
              <tfoot>
                <tr style="background: #fee2e2; font-weight: bold;">
                  <td style="padding: 12px;">TOTAL EXPENSES</td>
                  <td style="padding: 12px; text-align: right; color: #dc2626;">${formatMoney(totalExpenses)}</td>
                  <td style="padding: 12px; text-align: right;">${expenses.length}</td>
                  <td style="padding: 12px;"></td>
                </tr>
              </tfoot>
            </table>`
          }
        </div>

        <!-- MONTH SUMMARY -->
        <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; padding: 30px; border-radius: 10px; margin-bottom: 20px;">
          <h2 style="margin-top: 0; margin-bottom: 25px; font-size: 22px; text-align: center; letter-spacing: 0.5px;">📈 Month Summary</h2>
          
          <!-- Main Metrics Grid -->
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 25px;">
            <!-- Gross Sales -->
            <div style="background: rgba(255, 255, 255, 0.15); padding: 18px; border-radius: 8px; border-left: 4px solid rgba(255, 255, 255, 0.4); backdrop-filter: blur(10px);">
              <p style="margin: 0; opacity: 0.85; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">💰 Gross Sales</p>
              <p style="margin: 12px 0 0 0; font-size: 28px; font-weight: bold; line-height: 1;">${formatMoney(totalSales)}</p>
              <p style="margin: 8px 0 0 0; opacity: 0.7; font-size: 11px;">${totalTransactionCount} transactions · ${totalItemsSold} units sold</p>
            </div>

            <!-- Total Expenses -->
            <div style="background: rgba(255, 255, 255, 0.15); padding: 18px; border-radius: 8px; border-left: 4px solid rgba(255, 255, 255, 0.4); backdrop-filter: blur(10px);">
              <p style="margin: 0; opacity: 0.85; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">💸 Total Expenses</p>
              <p style="margin: 12px 0 0 0; font-size: 28px; font-weight: bold; line-height: 1;">${formatMoney(totalExpenses)}</p>
              <p style="margin: 8px 0 0 0; opacity: 0.7; font-size: 11px;">${expenses.length} expense items</p>
            </div>

            <!-- Net Profit -->
            <div style="background: rgba(255, 255, 255, 0.15); padding: 18px; border-radius: 8px; border-left: 4px solid rgba(255, 255, 255, 0.4); backdrop-filter: blur(10px);">
              <p style="margin: 0; opacity: 0.85; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">📊 Net Profit</p>
              <p style="margin: 12px 0 0 0; font-size: 28px; font-weight: bold; line-height: 1;">${formatMoney(netProfitMonth)}</p>
              <p style="margin: 8px 0 0 0; opacity: 0.7; font-size: 11px;">Sales minus COGS and expenses</p>
            </div>

            <!-- Credit Recovery -->
            <div style="background: rgba(255, 255, 255, 0.15); padding: 18px; border-radius: 8px; border-left: 4px solid rgba(255, 255, 255, 0.4); backdrop-filter: blur(10px);">
              <p style="margin: 0; opacity: 0.85; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Credit Recovered</p>
              <p style="margin: 12px 0 0 0; font-size: 28px; font-weight: bold; line-height: 1;">${formatMoney(creditRecoveredThisMonth)}</p>
              <p style="margin: 8px 0 0 0; opacity: 0.7; font-size: 11px;">Outstanding: ${formatMoney(outstandingCredit)}</p>
            </div>
          </div>

          <!-- Divider -->
          <div style="border-top: 2px solid rgba(255, 255, 255, 0.25); margin: 20px 0;"></div>

          <!-- Secondary Metrics -->
         
           <div style="display: flex; flex-wrap: wrap; gap: 10px;"> 
            <!-- Stock Value -->
            <div style="text-align: center; padding: 12px;">
              <p style="margin: 0; opacity: 0.8; font-size: 28px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Stock Value</p>
              <p style="margin: 8px 0 0 0; font-size: 18px; font-weight: bold;">${formatMoney(totalStockValue)}</p>
            </div>

            <!-- Locations Active -->
            <div style="text-align: center; padding: 12px;">
              <p style="margin: 0; opacity: 0.8; font-size: 28px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Locations</p>
              <p style="margin: 8px 0 0 0; font-size: 18px; font-weight: bold;">${allLocations.length}</p>
            </div>

            <!-- Profit Margin -->
            <div style="text-align: center; padding: 12px;">
              <p style="margin: 0; opacity: 0.8; font-size: 28px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">Profit Margin</p>
              <p style="margin: 8px 0 0 0; font-size: 18px; font-weight: bold;">${totalSales > 0 ? ((netProfitMonth / totalSales) * 100).toFixed(1) : "0"}%</p>
            </div>
          </div>
        </div>

        <!-- DATA QUALITY -->
        <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #94a3b8;">
          <h3 style="margin: 0 0 8px 0; color: #334155; font-size: 14px;">Data Quality</h3>
          <p style="margin: 0; color: #475569; font-size: 12px;">
            Missing productId on items: <strong>${missingProductIdCount}</strong> |
            Missing cost price on items: <strong>${missingCostCount}</strong>
          </p>
        </div>

        <!-- FOOTER -->
        <div style="background: #f9fafb; padding: 15px; border-radius: 8px; text-align: center;">
          <p style="color: #999; font-size: 12px; margin: 0;">This is an automated monthly report from St. Micheals Inventory System. Powered by BizSuits.</p>
          <p style="color: #059669; font-size: 12px; margin: 5px 0;">✅ Report generated successfully</p>
        </div>
      </div>
    `;

    const transporter = createMailTransport();
    if (!transporter) {
      return res.status(500).json({
        error: "Mail transport is not configured",
        hint: "Check SMTP/EMAIL environment variables",
      });
    }

    console.log("📧 Sending monthly report email to:", monthlyReportTo);

    // Logo path for embedding
    const logoPath = path.join(
      process.cwd(),
      "public/images/logo.png",
    );
    let attachments = [];

    try {
      const fs = await import("fs");
      if (fs.existsSync(logoPath)) {
        attachments.push({
          filename: "logo.png",
          path: logoPath,
          cid: "businessLogo",
        });
      }
    } catch (logoErr) {
      console.log("[Monthly Mail] Logo not found, sending without embedded image");
    }

    const emailResponse = await transporter.sendMail({
      from: getMailFromAddress("St's Micheal's Place"),
      to: monthlyReportTo,
      subject: `Monthly Business Report - ${reportMonthLabel} | St. Micheals`,
      html: mailHtml,
      attachments,
    });

    console.log("✅ Email sent successfully:", emailResponse.messageId);

    return res.status(200).json({
      message: "Monthly report sent successfully!",
      sentTo: monthlyReportTo,
      messageId: emailResponse.messageId,
      timestamp: new Date().toISOString(),
      summary: {
        totalSales,
        totalTransactions: totalTransactionCount,
        totalItemsSold,
        totalExpenses,
        totalCogs: totalCogsMonth,
        netPosition: netProfitMonth,
        stockValue: totalStockValue,
        creditIssued: creditIssuedTotal,
        creditRecovered: creditRecoveredThisMonth,
        outstandingCredit,
        locationsCount: allLocations.length,
      },
    });
  } catch (err) {
    console.error("❌ Error generating monthly report:", err);
    return res.status(500).json({
      error: "Failed to generate monthly report",
      message: err.message,
      hint: "Check EMAIL_USER/EMAIL_PASS configuration and database connection",
    });
  }
}
