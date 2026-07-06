import { mongooseConnect } from "@/lib/mongodb";
import { aggregateProductSales } from "@/lib/product-sales-report";
import Transaction from "@/models/Transactions";
import Product from "@/models/Product";
import Store from "@/models/Store";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import {
  addDays,
  format,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  eachHourOfInterval,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subYears,
} from "date-fns";

/* ---------------------------------------------
   SIMPLE IN-MEMORY CACHE
---------------------------------------------- */
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

function getCache(key) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiry) {
    cache.delete(key);
    return null;
  }
  return cached.data;
}

function setCache(key, data) {
  cache.set(key, { data, expiry: Date.now() + CACHE_TTL });
}

function resolveDateRange(range, fallbackDays) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const normalizedRange = typeof range === "string" ? range.trim() : "";

  switch (normalizedRange) {
    case "Today":
      return { start: todayStart, end: now };
    case "Yesterday":
      return { start: addDays(todayStart, -1), end: todayStart };
    case "Last 7 days":
      return { start: addDays(todayStart, -6), end: now };
    case "Last 14 days":
      return { start: addDays(todayStart, -13), end: now };
    case "Last 30 days":
      return { start: addDays(todayStart, -29), end: now };
    case "Last 90 days":
      return { start: addDays(todayStart, -89), end: now };
    case "This week":
      return { start: startOfWeek(now), end: now };
    case "Last week": {
      const currentWeekStart = startOfWeek(now);
      return { start: addDays(currentWeekStart, -7), end: currentWeekStart };
    }
    case "This month":
      return { start: startOfMonth(now), end: now };
    case "Last month": {
      const currentMonthStart = startOfMonth(now);
      return { start: startOfMonth(subMonths(now, 1)), end: currentMonthStart };
    }
    case "This year":
      return { start: startOfYear(now), end: now };
    case "Last year": {
      const currentYearStart = startOfYear(now);
      return { start: startOfYear(subYears(now, 1)), end: currentYearStart };
    }
    default: {
      const safeDays = Number(fallbackDays);

      if (safeDays === 0) {
        return { start: todayStart, end: now };
      }

      if (safeDays === 1) {
        return { start: addDays(todayStart, -1), end: todayStart };
      }

      return {
        start: subDays(now, Number.isFinite(safeDays) ? safeDays : 30),
        end: now,
      };
    }
  }
}

/* ---------------------------------------------
   API HANDLER
---------------------------------------------- */
export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  try {
    await mongooseConnect();

    const {
      location = "All",
      days = 30,
      period = "day",
      range = "",
    } = req.query;

    const { start: rangeStart, end: rangeEnd } = resolveDateRange(range, days);
    const intervalEnd = new Date(rangeEnd.getTime() - 1);

    const cacheKey = JSON.stringify({
      location,
      days,
      period,
      range,
      rangeStart: rangeStart.toISOString(),
      rangeEnd: rangeEnd.toISOString(),
    });
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    /* ---------------------------------------------
       PERIOD FORMAT
    ---------------------------------------------- */
    const periodConfig = {
      day: { fn: eachDayOfInterval, fmt: "yyyy-MM-dd" },
      week: { fn: eachWeekOfInterval, fmt: "yyyy-'W'II" },
      month: { fn: eachMonthOfInterval, fmt: "yyyy-MM" },
      hourly: { fn: eachHourOfInterval, fmt: "yyyy-MM-dd HH:00" },
    };

    const { fn, fmt } = periodConfig[period.toLowerCase()] || periodConfig.day;

    const periods = fn({ start: rangeStart, end: intervalEnd }).map((d) =>
      format(d, fmt)
    );

    /* ─────────────────────────────────────────
       QUERY TRANSACTIONS (LOCATIONS AS STRINGS)
       ───────────────────────────────────────── */

    /* ─────────────────────────────────────────
       QUERY TRANSACTIONS (LOCATIONS AS STRINGS)
       ───────────────────────────────────────── */
    // Locations are now stored as strings (location name or 'online')
    const queryFilter = {
      createdAt: { $gte: rangeStart, $lt: rangeEnd },
      status: "completed",
    };

    // Handle location filter - locations are strings now
    if (location !== "All") {
      queryFilter.location = location;
    }

    const transactions = await Transaction.find(queryFilter)
      .lean();

    /* ---------------------------------------------
       MAP STRUCTURES
    ---------------------------------------------- */
    const salesMap = {};
    const txMap = {};
    const salesByLocation = {};
    const salesByTender = {};

    let totalSales = 0;
    let totalTransactions = 0;

    /* ---------------------------------------------
       PROCESS TRANSACTIONS
    ---------------------------------------------- */
    // Collect all product IDs for cost lookup
    const productIdSet = new Set();
    for (const tx of transactions) {
      if (Array.isArray(tx.items)) {
        for (const item of tx.items) {
          if (item.productId) productIdSet.add(item.productId.toString());
        }
      }
    }

    // Fetch product costs
    const productIds = Array.from(productIdSet);
    const products = productIds.length > 0
      ? await Product.find({ _id: { $in: productIds } }, { _id: 1, costPrice: 1 }).lean()
      : [];
    const costMap = new Map(products.map((p) => [p._id.toString(), p.costPrice || 0]));

    let totalCOGS = 0;

    for (const tx of transactions) {
      const key = format(new Date(tx.createdAt), fmt);

      salesMap[key] = (salesMap[key] || 0) + (tx.total || 0);
      txMap[key] = (txMap[key] || 0) + 1;

      // Calculate COGS from items
      if (Array.isArray(tx.items)) {
        for (const item of tx.items) {
          const qty = item.qty || item.quantity || 1;
          const cost = item.productId ? (costMap.get(item.productId.toString()) || 0) : 0;
          totalCOGS += cost * qty;
        }
      }

      // Handle location - location is now stored as a string (name)
      if (tx.location) {
        const locationName = typeof tx.location === 'string' ? tx.location : tx.location.toString();
        salesByLocation[locationName] =
          (salesByLocation[locationName] || 0) + tx.total;
      } else {
        // Online transactions (no location)
        salesByLocation["online"] = (salesByLocation["online"] || 0) + tx.total;
      }

      // Handle tenders - support both split payments (new) and single tender (legacy)
      if (tx.tenderPayments && tx.tenderPayments.length > 0) {
        // New split payment format
        tx.tenderPayments.forEach((payment) => {
          const tenderName = payment.tenderName || "Unknown";
          salesByTender[tenderName] = (salesByTender[tenderName] || 0) + (payment.amount || 0);
        });
      } else if (tx.tenderType) {
        // Legacy single tender format
        salesByTender[tx.tenderType] =
          (salesByTender[tx.tenderType] || 0) + tx.total;
      }

      totalSales += tx.total || 0;
      totalTransactions += 1;
    }

    /* ---------------------------------------------
       NORMALIZED TIME SERIES
    ---------------------------------------------- */
    const salesData = periods.map((p) => salesMap[p] || 0);
    const transactionQty = periods.map((p) => txMap[p] || 0);

    /* ---------------------------------------------
       HOURLY-OF-DAY AGGREGATION (0–23)
    ---------------------------------------------- */
    const hourlyOfDay = new Array(24).fill(0);
    for (const tx of transactions) {
      const h = new Date(tx.createdAt).getHours();
      hourlyOfDay[h] += tx.total || 0;
    }

    /* ---------------------------------------------
       PREVIOUS PERIOD (same duration, shifted back)
    ---------------------------------------------- */
    const currentDuration = rangeEnd.getTime() - rangeStart.getTime();
    const prevRangeStart = new Date(rangeStart.getTime() - currentDuration);
    const prevRangeEnd = rangeStart;

    const prevQueryFilter = {
      createdAt: { $gte: prevRangeStart, $lt: prevRangeEnd },
      status: "completed",
    };
    if (location !== "All") prevQueryFilter.location = location;

    const prevTransactions = await Transaction.find(prevQueryFilter).lean();

    const prevSalesMap = {};
    const prevTxMap = {};
    for (const tx of prevTransactions) {
      // Shift into current-period time space so keys align with `periods`
      const shifted = new Date(new Date(tx.createdAt).getTime() + currentDuration);
      const key = format(shifted, fmt);
      prevSalesMap[key] = (prevSalesMap[key] || 0) + (tx.total || 0);
      prevTxMap[key] = (prevTxMap[key] || 0) + 1;
    }

    const comparisonSalesData = periods.map((p) => prevSalesMap[p] || 0);
    const comparisonTransactionQty = periods.map((p) => prevTxMap[p] || 0);
    const prevTotalSales = prevTransactions.reduce((s, t) => s + (t.total || 0), 0);
    const prevTotalTransactions = prevTransactions.length;

    /* ---------------------------------------------
       BEST SELLING PRODUCTS
    ---------------------------------------------- */
    const bestSellingProducts = aggregateProductSales(transactions)
      .map((product) => [product.name, product.unitsSold])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    /* ---------------------------------------------
       LOW STOCK COUNT
    ---------------------------------------------- */
    const lowStockItems = await Product.countDocuments({ quantity: { $lte: 10 } });

    const grossProfit = totalSales - totalCOGS;
    const grossMarginPct = totalSales > 0 ? (grossProfit / totalSales) * 100 : 0;

    const response = {
      dates: periods,
      salesData,
      transactionQty,
      hourlyOfDay,
      comparisonSalesData,
      comparisonTransactionQty,
      prevTotalSales,
      prevTotalTransactions,
      salesByLocation,
      salesByTender,
      bestSellingProducts,
      summary: {
        totalSales,
        totalTransactions,
        averageTransaction:
          totalTransactions > 0
            ? Number((totalSales / totalTransactions).toFixed(2))
            : 0,
        lowStockItems,
        totalCOGS,
        grossProfit,
        grossMargin: grossMarginPct,
        operatingMargin: grossMarginPct, // Gross margin serves as operating proxy without expense data
      },
    };

    setCache(cacheKey, response);
    return res.json(response);
  } catch (error) {
    console.error("REPORTING API ERROR:", error);
    return res.status(500).json({
      error: "Failed to load reporting data",
    });
  }
}

