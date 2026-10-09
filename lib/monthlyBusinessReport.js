/**
 * The business half of the monthly report (pages/api/monthly-report-mail.js): how the month
 * compares with the one before, its trading days, what sold and what did not, who sold it,
 * refunds and discounts, buying and what is owed to vendors, stock lost and counted, petty cash.
 *
 * Months are the shop's calendar months, in Africa/Lagos (lib/tradingDay.js), the same days the
 * sales reports use — not the server's UTC month, which started an hour into the shop's.
 */
import { dayKeyOf, formatDayKey, shopDaysBounds } from "@/lib/tradingDay";
import {
  getAllocatedLineItems,
  getReportStaffName,
  getTransactionDiscount,
  getTransactionItemQuantity,
  isCompletedSale,
} from "@/lib/sales-report-utils";
import Transaction from "@/models/Transactions";
import PurchaseOrder from "@/models/PurchaseOrder";
import StockMovement from "@/models/StockMovement";
import StockTake from "@/models/StockTake";
import PettyCashTransaction from "@/models/PettyCashTransaction";
import Category from "@/models/Category";
import Expense from "@/models/Expense";
import Product from "@/models/Product";

const pad = (n) => String(n).padStart(2, "0");

/**
 * Expenses that belong to a period: by the date the expense is for, or when it has none, the day
 * it was entered. Matching either date counted an expense entered in one month for the one
 * before in both.
 */
export function expensesInRange(start, end) {
  const range = { $gte: start, $lt: end };
  return { $or: [{ expenseDate: range }, { expenseDate: null, createdAt: range }] };
}
const monthName = (year, month) =>
  new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const lastDayOf = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Sales of products nobody put in a category, and of lines the till sold without a product. */
export const NO_CATEGORY = "No category set";
export const NOT_LINKED = "Not linked to a product";

/**
 * The month a report covers. "YYYY-MM" for that month, "current" for this month so far, and by
 * default the month before this one — which is what the 1st-of-the-month run sends.
 */
export function reportMonth(monthParam, now = new Date()) {
  const todayKey = dayKeyOf(now);
  let [year, month] = todayKey.split("-").map(Number);
  const toDate = monthParam === "current";
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(monthParam || ""))) {
    [year, month] = String(monthParam).split("-").map(Number);
  } else if (!toDate) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  const firstKey = `${year}-${pad(month)}-01`;
  const lastKey = toDate ? todayKey : `${year}-${pad(month)}-${pad(lastDayOf(year, month))}`;
  const { start, end } = shopDaysBounds(firstKey, lastKey);

  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevLastDay = lastDayOf(prevYear, prevMonth);
  // A month so far is compared with the same days of the month before
  const prevLast = toDate ? Math.min(Number(todayKey.slice(8, 10)), prevLastDay) : prevLastDay;
  const prev = shopDaysBounds(`${prevYear}-${pad(prevMonth)}-01`, `${prevYear}-${pad(prevMonth)}-${pad(prevLast)}`);

  return {
    monthKey: `${year}-${pad(month)}`,
    firstKey,
    lastKey,
    start,
    end,
    label: `${monthName(year, month)}${toDate ? " (to date)" : ""}`,
    rangeLabel: `${formatDayKey(firstKey)} – ${formatDayKey(lastKey)}`,
    prev: { start: prev.start, end: prev.end, label: `${monthName(prevYear, prevMonth)}${toDate ? " (same days)" : ""}` },
  };
}

/** A sold line's cost: what the till recorded, else the product's cost now. */
const lineCost = (item, productMap) => {
  const recorded = Number(item?.costPrice);
  if (Number.isFinite(recorded) && item?.costPrice !== null && item?.costPrice !== undefined) return recorded;
  return Number(productMap.get(String(item?.productId || ""))?.costPrice) || 0;
};

/** Sales, transactions, items, cost of goods and discounts for completed sales. */
export function summariseSales(transactions, productMap) {
  const totals = { sales: 0, count: 0, items: 0, cogs: 0, discounts: 0 };
  for (const tx of transactions) {
    if (!isCompletedSale(tx)) continue;
    totals.sales += Number(tx.total) || 0;
    totals.count += 1;
    totals.items += getTransactionItemQuantity(tx);
    totals.discounts += getTransactionDiscount(tx);
    for (const item of tx.items || []) {
      const quantity = Number(item?.qty ?? item?.quantity) || 0;
      totals.cogs += quantity * lineCost(item, productMap);
    }
  }
  totals.grossProfit = totals.sales - totals.cogs;
  totals.grossMargin = totals.sales > 0 ? (totals.grossProfit / totals.sales) * 100 : 0;
  totals.avgBasket = totals.count > 0 ? totals.sales / totals.count : 0;
  return totals;
}

/** Everything the business sections show, for one month. */
export async function loadBusinessExtras({ period, transactions, expenses = [], allProducts = [], productMap }) {
  const { start, end, prev } = period;
  const inMonth = { $gte: start, $lt: end };
  const sold = transactions.filter(isCompletedSale);

  const [prevTransactions, prevExpenses, refunds, purchaseOrders, owed, losses, stockTakes, pettyCash, categories] = await Promise.all([
    Transaction.find({ status: "completed", subStatus: { $ne: "void" }, createdAt: { $gte: prev.start, $lt: prev.end } })
      .select("total items discount promotionValueType status subStatus")
      .lean(),
    Expense.aggregate([
      { $match: expensesInRange(prev.start, prev.end) },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Transaction.find({ status: "refunded", $or: [{ refundedAt: inMonth }, { refundedAt: null, createdAt: inMonth }] })
      .select("total refundReason")
      .lean(),
    PurchaseOrder.find({ $or: [{ createdAt: inMonth }, { receivedAt: inMonth }] })
      .select("grandTotal createdAt receivedAt receivedStatus vendorName")
      .lean(),
    PurchaseOrder.aggregate([
      { $match: { balance: { $gt: 0 } } },
      { $group: { _id: "$vendorName", owed: { $sum: "$balance" }, orders: { $sum: 1 } } },
      { $sort: { owed: -1 } },
    ]),
    StockMovement.find({
      reason: "Operational Loss",
      status: "Received",
      $or: [{ dateReceived: inMonth }, { dateReceived: null, dateSent: inMonth }],
    })
      .select("totalCostPrice products")
      .lean(),
    StockTake.find({ adjustmentApplied: true, adjustedAt: inMonth }).select("reference totalVarianceValue negativeVariance").lean(),
    PettyCashTransaction.find({ status: "Paid", $or: [{ paidAt: inMonth }, { paidAt: null, requestDate: inMonth }] })
      .select("amount vendorName")
      .lean(),
    Category.find({}).select("name").lean(),
  ]);

  const now = summariseSales(sold, productMap);
  const before = summariseSales(prevTransactions, productMap);
  const expenseTotal = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const prevExpenseTotal = prevExpenses[0]?.total || 0;

  // ---- Trading days
  const byDay = new Map();
  for (const tx of sold) {
    const key = dayKeyOf(tx.createdAt);
    if (!key) continue;
    byDay.set(key, (byDay.get(key) || 0) + (Number(tx.total) || 0));
  }
  const days = [...byDay.entries()].map(([key, total]) => ({ key, total })).sort((a, b) => b.total - a.total);
  const weekdays = WEEKDAYS.map((name) => ({ name, total: 0, days: 0 }));
  for (const { key, total } of days) {
    const index = (new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7;
    weekdays[index].total += total;
    weekdays[index].days += 1;
  }

  // ---- Products, categories, staff
  const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));

  // The report's product list holds stock-managed, unarchived products only; a sale of anything
  // else (or of a unit whose pack is elsewhere) still needs its category, so look those up
  const isObjectId = (value) => /^[a-f0-9]{24}$/i.test(value);
  const lookupIds = new Set();
  for (const tx of sold) {
    for (const item of tx.items || []) {
      const id = String(item?.productId || "");
      if (isObjectId(id) && !productMap.has(id)) lookupIds.add(id);
      const parentId = String(productMap.get(id)?.parentProduct || "");
      if (isObjectId(parentId) && !productMap.has(parentId)) lookupIds.add(parentId);
    }
  }
  const otherProducts = new Map();
  if (lookupIds.size > 0) {
    const found = await Product.find({ _id: { $in: [...lookupIds] } }).select("name category parentProduct").lean();
    found.forEach((p) => otherProducts.set(String(p._id), p));
    // Parents of the units just found
    const parentIds = found
      .map((p) => String(p.parentProduct || ""))
      .filter((id) => isObjectId(id) && !productMap.has(id) && !otherProducts.has(id));
    if (parentIds.length > 0) {
      (await Product.find({ _id: { $in: parentIds } }).select("name category").lean())
        .forEach((p) => otherProducts.set(String(p._id), p));
    }
  }
  const findProduct = (id) => productMap.get(String(id || "")) || otherProducts.get(String(id || ""));

  // "Top Level" is what a product gets when nobody picks a category, and an id whose category has
  // since been deleted names nothing: neither is a category
  const realCategory = (value) => {
    const raw = String(value || "").trim();
    if (!raw || raw === "Top Level") return "";
    if (categoryName.has(raw)) return categoryName.get(raw);
    return isObjectId(raw) ? "" : raw;
  };
  const uncategorised = new Map();
  const categoryOf = (product, item) => {
    // A unit made from a pack sits in its pack's category unless it has one of its own
    const name =
      realCategory(product?.category) ||
      realCategory(findProduct(product?.parentProduct)?.category) ||
      realCategory(item?.category);
    if (name) return name;
    if (!product) return NOT_LINKED;
    const label = product.name || item?.name || "Unnamed product";
    uncategorised.set(label, (uncategorised.get(label) || 0) + 1);
    return NO_CATEGORY;
  };

  const productRows = new Map();
  const categoryRows = new Map();
  const staffRows = new Map();
  const unitsSoldById = new Map();
  for (const tx of sold) {
    const staff = getReportStaffName(tx);
    const staffRow = staffRows.get(staff) || { name: staff, sales: 0, count: 0 };
    staffRow.sales += Number(tx.total) || 0;
    staffRow.count += 1;
    staffRows.set(staff, staffRow);

    for (const { item, quantity, netLineTotal } of getAllocatedLineItems(tx)) {
      const id = String(item?.productId || "");
      const key = id || `name:${String(item?.name || "").toLowerCase()}`;
      const product = findProduct(id);
      const row = productRows.get(key) || { name: item?.name || product?.name || "Unknown", units: 0, revenue: 0, cogs: 0 };
      row.units += quantity;
      row.revenue += netLineTotal;
      row.cogs += quantity * lineCost(item, productMap);
      productRows.set(key, row);
      if (id) unitsSoldById.set(id, (unitsSoldById.get(id) || 0) + quantity);
      // A unit sold from a pack also moves its pack
      if (product?.parentProduct) {
        const parentId = String(product.parentProduct);
        unitsSoldById.set(parentId, (unitsSoldById.get(parentId) || 0) + quantity);
      }

      const category = categoryOf(product, item);
      const catRow = categoryRows.get(category) || { name: category, units: 0, revenue: 0 };
      catRow.units += quantity;
      catRow.revenue += netLineTotal;
      categoryRows.set(category, catRow);
    }
  }
  const topProducts = [...productRows.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const byCategory = [...categoryRows.values()].sort((a, b) => b.revenue - a.revenue);
  const byStaff = [...staffRows.values()].sort((a, b) => b.sales - a.sales);

  // ---- Slow movers: in stock, nothing sold all month
  const slow = allProducts
    .filter((p) => !(p.isChildProduct && p.packType !== "pack") && p.isStockManaged !== false && Number(p.quantity) > 0)
    .filter((p) => !unitsSoldById.get(String(p._id)))
    .map((p) => ({ name: p.name, quantity: Number(p.quantity) || 0, value: (Number(p.quantity) || 0) * (Number(p.costPrice) || 0) }))
    .sort((a, b) => b.value - a.value);

  // ---- Stock lost
  const lostItems = new Map();
  let lossValue = 0;
  for (const movement of losses) {
    let movementValue = 0;
    for (const line of movement.products || []) {
      const product = productMap.get(String(line.productId || ""));
      const value = (Number(line.quantity) || 0) * (Number(line.costPrice ?? product?.costPrice) || 0);
      movementValue += value;
      const name = product?.name || "Unknown product";
      const row = lostItems.get(name) || { name, quantity: 0, value: 0 };
      row.quantity += Number(line.quantity) || 0;
      row.value += value;
      lostItems.set(name, row);
    }
    lossValue += Number(movement.totalCostPrice) || movementValue;
  }

  const pettyByVendor = new Map();
  for (const t of pettyCash) {
    const name = t.vendorName || "Unknown vendor";
    pettyByVendor.set(name, (pettyByVendor.get(name) || 0) + (Number(t.amount) || 0));
  }

  const raised = purchaseOrders.filter((o) => o.createdAt >= start && o.createdAt < end);
  const received = purchaseOrders.filter((o) => o.receivedAt && o.receivedAt >= start && o.receivedAt < end);

  return {
    now: { ...now, expenses: expenseTotal, netProfit: now.grossProfit - expenseTotal },
    before: { ...before, expenses: prevExpenseTotal, netProfit: before.grossProfit - prevExpenseTotal },
    prevLabel: prev.label,
    days: {
      traded: days.length,
      best: days[0] || null,
      quietest: days.length ? days[days.length - 1] : null,
      average: days.length ? days.reduce((sum, d) => sum + d.total, 0) / days.length : 0,
      weekdays,
    },
    topProducts,
    byCategory,
    uncategorisedProducts: [...uncategorised.keys()].sort((a, b) => a.localeCompare(b)),
    byStaff,
    slow: { count: slow.length, value: slow.reduce((sum, p) => sum + p.value, 0), top: slow.slice(0, 10) },
    refunds: { count: refunds.length, value: refunds.reduce((sum, t) => sum + (Number(t.total) || 0), 0) },
    purchasing: {
      raised: { count: raised.length, value: raised.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0) },
      received: { count: received.length, value: received.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0) },
      owed: owed.reduce((sum, row) => sum + row.owed, 0),
      owedTo: owed.slice(0, 5).map((row) => ({ name: row._id || "Unknown vendor", owed: row.owed, orders: row.orders })),
    },
    losses: { count: losses.length, value: lossValue, top: [...lostItems.values()].sort((a, b) => b.value - a.value).slice(0, 5) },
    stockTakes: {
      count: stockTakes.length,
      varianceValue: stockTakes.reduce((sum, s) => sum + (Number(s.totalVarianceValue) || 0), 0),
    },
    pettyCash: {
      count: pettyCash.length,
      total: pettyCash.reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
      top: [...pettyByVendor.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 5),
    },
  };
}

/* ------------------------------------------------------------------ email HTML */

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const TH = 'style="padding: 8px 10px; text-align: left; font-size: 11px; color: #6b7280; text-transform: uppercase; border-bottom: 2px solid #e5e7eb;"';
const THR = 'style="padding: 8px 10px; text-align: right; font-size: 11px; color: #6b7280; text-transform: uppercase; border-bottom: 2px solid #e5e7eb;"';
const TD = 'style="padding: 8px 10px; font-size: 13px; color: #111827; border-bottom: 1px solid #f3f4f6;"';
const TDR = 'style="padding: 8px 10px; font-size: 13px; color: #111827; text-align: right; border-bottom: 1px solid #f3f4f6; white-space: nowrap;"';

function card(color, title, body) {
  return `
    <div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid ${color};">
      <h2 style="color: ${color}; margin-top: 0; font-size: 18px;">${title}</h2>
      ${body}
    </div>`;
}

function table(head, rows) {
  return `<table style="width: 100%; border-collapse: collapse;"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

const tile = (label, value, note = "") => `
  <td style="padding: 6px; vertical-align: top;">
    <div style="background: #f9fafb; border-radius: 8px; padding: 12px;">
      <p style="margin: 0; font-size: 11px; color: #6b7280; text-transform: uppercase;">${label}</p>
      <p style="margin: 4px 0 0 0; font-size: 18px; font-weight: bold; color: #111827;">${value}</p>
      ${note ? `<p style="margin: 3px 0 0 0; font-size: 11px; color: #6b7280;">${note}</p>` : ""}
    </div>
  </td>`;

/** Which sold products have no category, so someone can give them one on the Products page. */
function uncategorisedNote(x) {
  const names = x.uncategorisedProducts || [];
  if (names.length === 0) return "";
  const shown = names.slice(0, 12).map(esc).join(", ");
  const more = names.length > 12 ? ` and ${names.length - 12} more` : "";
  return `<p style="margin: 10px 0 0 0; font-size: 12px; color: #6b7280;"><strong>${NO_CATEGORY}</strong> (${names.length} product${names.length === 1 ? "" : "s"}): ${shown}${more}. Give them a category on the Products page and next month's report files them properly.</p>`;
}

export function buildBusinessExtrasHtml(x, formatMoney) {
  const pct = (value) => `${(Number(value) || 0).toFixed(1)}%`;
  const change = (now, before) => {
    if (!before) return now ? '<span style="color: #059669;">new</span>' : "—";
    const delta = ((now - before) / Math.abs(before)) * 100;
    const color = delta >= 0 ? "#059669" : "#dc2626";
    return `<span style="color: ${color}; font-weight: bold;">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}%</span>`;
  };
  const compareRow = (label, now, before, money = true) =>
    `<tr><td ${TD}>${label}</td><td ${TDR}>${money ? formatMoney(now) : Math.round(now).toLocaleString("en-NG")}</td><td ${TDR}>${money ? formatMoney(before) : Math.round(before).toLocaleString("en-NG")}</td><td ${TDR}>${change(now, before)}</td></tr>`;

  const comparison = card(
    "#2563eb",
    `📊 How the month compares with ${esc(x.prevLabel)}`,
    table(
      `<th ${TH}>Measure</th><th ${THR}>This month</th><th ${THR}>${esc(x.prevLabel)}</th><th ${THR}>Change</th>`,
      [
        compareRow("Sales", x.now.sales, x.before.sales),
        compareRow("Transactions", x.now.count, x.before.count, false),
        compareRow("Average sale", x.now.avgBasket, x.before.avgBasket),
        compareRow("Items sold", x.now.items, x.before.items, false),
        compareRow("Gross profit", x.now.grossProfit, x.before.grossProfit),
        `<tr><td ${TD}>Gross margin</td><td ${TDR}>${pct(x.now.grossMargin)}</td><td ${TDR}>${pct(x.before.grossMargin)}</td><td ${TDR}>${(x.now.grossMargin - x.before.grossMargin >= 0 ? "+" : "") + (x.now.grossMargin - x.before.grossMargin).toFixed(1)} pts</td></tr>`,
        compareRow("Expenses", x.now.expenses, x.before.expenses),
        compareRow("Net profit", x.now.netProfit, x.before.netProfit),
      ].join("")
    )
  );

  const maxWeekday = Math.max(1, ...x.days.weekdays.map((d) => d.total));
  const tradingDays = card(
    "#0891b2",
    "📅 Trading days",
    `<table style="width: 100%; border-collapse: collapse;"><tr>
      ${tile("Days traded", x.days.traded)}
      ${tile("Average a day", formatMoney(x.days.average))}
      ${tile("Best day", x.days.best ? formatMoney(x.days.best.total) : "—", x.days.best ? formatDayKey(x.days.best.key, { weekday: true }) : "")}
      ${tile("Quietest day", x.days.quietest ? formatMoney(x.days.quietest.total) : "—", x.days.quietest ? formatDayKey(x.days.quietest.key, { weekday: true }) : "")}
    </tr></table>
    <p style="margin: 14px 0 6px 0; font-size: 12px; color: #6b7280;">Sales by day of the week</p>
    ${table(
      `<th ${TH}>Day</th><th ${TH}></th><th ${THR}>Sales</th><th ${THR}>Days</th>`,
      x.days.weekdays
        .map(
          (d) => `<tr><td ${TD}>${d.name}</td><td ${TD}><div style="background: #cffafe; height: 10px; border-radius: 5px; width: ${Math.round((d.total / maxWeekday) * 100)}%;"></div></td><td ${TDR}>${formatMoney(d.total)}</td><td ${TDR}>${d.days}</td></tr>`
        )
        .join("")
    )}`
  );

  const products = card(
    "#7c3aed",
    "🏆 Best-selling products",
    x.topProducts.length
      ? table(
          `<th ${TH}>#</th><th ${TH}>Product</th><th ${THR}>Units</th><th ${THR}>Sales</th><th ${THR}>Gross profit</th><th ${THR}>Margin</th>`,
          x.topProducts
            .map((p, i) => {
              const profit = p.revenue - p.cogs;
              return `<tr><td ${TD}>${i + 1}</td><td ${TD}>${esc(p.name)}</td><td ${TDR}>${Math.round(p.units * 100) / 100}</td><td ${TDR}>${formatMoney(p.revenue)}</td><td ${TDR}>${formatMoney(profit)}</td><td ${TDR}>${p.revenue > 0 ? pct((profit / p.revenue) * 100) : "—"}</td></tr>`;
            })
            .join("")
        )
      : '<p style="color: #999; font-style: italic;">No sales this month</p>'
  );

  const totalCategory = x.byCategory.reduce((sum, c) => sum + c.revenue, 0) || 1;
  const categories = card(
    "#db2777",
    "🗂️ Sales by category",
    x.byCategory.length
      ? table(
          `<th ${TH}>Category</th><th ${THR}>Units</th><th ${THR}>Sales</th><th ${THR}>Share</th>`,
          x.byCategory
            .slice(0, 12)
            .map((c) => `<tr><td ${TD}>${esc(c.name)}</td><td ${TDR}>${Math.round(c.units * 100) / 100}</td><td ${TDR}>${formatMoney(c.revenue)}</td><td ${TDR}>${pct((c.revenue / totalCategory) * 100)}</td></tr>`)
            .join("")
        ) + uncategorisedNote(x)
      : '<p style="color: #999; font-style: italic;">No sales this month</p>'
  );

  const staff = card(
    "#ea580c",
    "👤 Sales by staff",
    x.byStaff.length
      ? table(
          `<th ${TH}>Staff</th><th ${THR}>Transactions</th><th ${THR}>Sales</th><th ${THR}>Average sale</th>`,
          x.byStaff
            .slice(0, 12)
            .map((s) => `<tr><td ${TD}>${esc(s.name)}</td><td ${TDR}>${s.count}</td><td ${TDR}>${formatMoney(s.sales)}</td><td ${TDR}>${formatMoney(s.count ? s.sales / s.count : 0)}</td></tr>`)
            .join("")
        )
      : '<p style="color: #999; font-style: italic;">No sales this month</p>'
  );

  const slow = card(
    "#64748b",
    "🐢 In stock, nothing sold this month",
    `<p style="margin: 0 0 10px 0; font-size: 13px; color: #374151;"><strong>${x.slow.count}</strong> products with stock sold nothing — <strong>${formatMoney(x.slow.value)}</strong> at cost sitting on the shelves.</p>
    ${x.slow.top.length ? table(`<th ${TH}>Product</th><th ${THR}>In stock</th><th ${THR}>Value at cost</th>`, x.slow.top.map((p) => `<tr><td ${TD}>${esc(p.name)}</td><td ${TDR}>${Math.round(p.quantity * 100) / 100}</td><td ${TDR}>${formatMoney(p.value)}</td></tr>`).join("")) : ""}`
  );

  const buying = card(
    "#0d9488",
    "🚚 Buying, and what is owed to vendors",
    `<table style="width: 100%; border-collapse: collapse;"><tr>
      ${tile("Orders raised", formatMoney(x.purchasing.raised.value), `${x.purchasing.raised.count} purchase order${x.purchasing.raised.count === 1 ? "" : "s"}`)}
      ${tile("Stock received", formatMoney(x.purchasing.received.value), `${x.purchasing.received.count} order${x.purchasing.received.count === 1 ? "" : "s"} booked in`)}
      ${tile("Owed to vendors", formatMoney(x.purchasing.owed), "all unpaid balances today")}
      ${tile("Petty cash paid", formatMoney(x.pettyCash.total), `${x.pettyCash.count} payment${x.pettyCash.count === 1 ? "" : "s"}`)}
    </tr></table>
    ${x.purchasing.owedTo.length ? `<p style="margin: 14px 0 6px 0; font-size: 12px; color: #6b7280;">Largest balances owed</p>${table(`<th ${TH}>Vendor</th><th ${THR}>Orders</th><th ${THR}>Owed</th>`, x.purchasing.owedTo.map((v) => `<tr><td ${TD}>${esc(v.name)}</td><td ${TDR}>${v.orders}</td><td ${TDR}>${formatMoney(v.owed)}</td></tr>`).join(""))}` : ""}
    ${x.pettyCash.top.length ? `<p style="margin: 14px 0 6px 0; font-size: 12px; color: #6b7280;">Petty cash by vendor</p>${table(`<th ${TH}>Vendor</th><th ${THR}>Paid</th>`, x.pettyCash.top.map((v) => `<tr><td ${TD}>${esc(v.name)}</td><td ${TDR}>${formatMoney(v.total)}</td></tr>`).join(""))}` : ""}`
  );

  const leakage = card(
    "#dc2626",
    "📉 Refunds, discounts and stock lost",
    `<table style="width: 100%; border-collapse: collapse;"><tr>
      ${tile("Refunds", formatMoney(x.refunds.value), `${x.refunds.count} refund${x.refunds.count === 1 ? "" : "s"}`)}
      ${tile("Discounts given", formatMoney(x.now.discounts))}
      ${tile("Stock lost", formatMoney(x.losses.value), `${x.losses.count} loss record${x.losses.count === 1 ? "" : "s"}`)}
      ${tile("Stock take adjustments", formatMoney(x.stockTakes.varianceValue), `${x.stockTakes.count} stock take${x.stockTakes.count === 1 ? "" : "s"} applied`)}
    </tr></table>
    ${x.losses.top.length ? `<p style="margin: 14px 0 6px 0; font-size: 12px; color: #6b7280;">Most lost, by value</p>${table(`<th ${TH}>Product</th><th ${THR}>Quantity</th><th ${THR}>Value</th>`, x.losses.top.map((p) => `<tr><td ${TD}>${esc(p.name)}</td><td ${TDR}>${Math.round(p.quantity * 100) / 100}</td><td ${TDR}>${formatMoney(p.value)}</td></tr>`).join(""))}` : ""}`
  );

  return comparison + tradingDays + products + categories + staff + buying + leakage + slow;
}
