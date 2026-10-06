/**
 * AI Chat Service
 *
 * The assistant answers from a summary of the business worked out on the server — never from raw
 * records. That summary used to be today's dashboard and nothing else, with today's sales passed
 * in as the month's too, so "how was this month?" got today's figures and "what should I restock?"
 * got "see the Decision Center" because no product was named anywhere in it. It now carries today
 * and this month side by side, the products running out (worked out, with order quantities), the
 * products not selling, what customers owe, and the open recommendations.
 */
import { generateDashboardMetrics } from "@/lib/analytics/dashboardAnalytics";
import { getRecommendations } from "./orchestrator";
import AIInsight from "@/models/AIInsight";
import { Transaction } from "@/models/Transactions";
import { generateAIText } from "./provider";
import { buildRestockPlan } from "./restockAdvisor";
import { dayKeyOf } from "@/lib/tradingDay";

/** The summary is reused for a minute, so a quick back-and-forth does not rebuild it every time. */
const CONTEXT_TTL_MS = 60 * 1000;
const contextCache = { at: 0, value: null };

const round = (value) => Math.round(Number(value) || 0);

/** What customers still owe on credit sales, whenever they were made. */
async function outstandingCredit() {
  const [row] = await Transaction.aggregate([
    { $match: { status: "credit", subStatus: { $ne: "void" }, creditStatus: { $nin: ["paid", "written_off"] } } },
    {
      $group: {
        _id: null,
        owed: { $sum: { $ifNull: ["$creditBalance", 0] } },
        customers: { $addToSet: "$creditCustomerName" },
        overdue: { $sum: { $cond: [{ $eq: ["$creditStatus", "overdue"] }, 1, 0] } },
        sales: { $sum: 1 },
      },
    },
  ]);
  return { owed: round(row?.owed), openCreditSales: row?.sales || 0, customers: (row?.customers || []).filter(Boolean).length, overdue: row?.overdue || 0 };
}

/**
 * Build business context for AI chat (summarized analytics only, never raw data)
 * @returns {Promise<Object>}
 */
export async function buildBusinessContext() {
  if (contextCache.value && Date.now() - contextCache.at < CONTEXT_TTL_MS) return contextCache.value;

  try {
    const [today, month, restock, credit, recommendations, latestInsight] = await Promise.all([
      generateDashboardMetrics("today").catch(() => null),
      generateDashboardMetrics("month").catch(() => null),
      buildRestockPlan().catch(() => null),
      outstandingCredit().catch(() => null),
      getRecommendations({ limit: 5, status: "pending" }).catch(() => []),
      AIInsight.findOne({ reportType: "monthly" }).sort({ generatedAt: -1 }).lean().catch(() => null),
    ]);

    const now = new Date();
    const value = {
      // The shop's date, in Lagos
      date: `${dayKeyOf(now)} (${now.toLocaleDateString("en-GB", { weekday: "long", timeZone: "Africa/Lagos" })})`,
      currency: "Nigerian Naira (₦)",
      todaySoFar: today && {
        sales: round(today.sales?.totalSales),
        transactions: today.sales?.transactionCount || 0,
        averageSale: round(today.sales?.avgTransactionValue),
        grossProfit: round(today.profit?.grossProfit),
        refunds: round(today.refunds?.totalRefunds),
      },
      thisMonth: month && {
        period: month.reportPeriod,
        sales: round(month.sales?.totalSales),
        transactions: month.sales?.transactionCount || 0,
        salesChangeVsPreviousPeriodPercent: month.growth?.salesGrowth ?? null,
        grossProfit: round(month.profit?.grossProfit),
        grossMarginPercent: month.profit?.grossMargin ?? null,
        expenses: round(month.profit?.totalExpenses),
        netProfit: round(month.profit?.netProfit),
        refunds: round(month.refunds?.totalRefunds),
        creditSalesMade: round(month.credits?.totalCredit),
        biggestExpenses: (month.expenseBreakdown || []).slice(0, 4).map((e) => ({ category: e.category || "Other", amount: round(e.total) })),
        topProducts: (month.topProducts || []).slice(0, 8),
        stockBoughtFromVendors: round(month.purchases?.totalPurchases),
        stillOwedToVendors: round(month.purchases?.totalBalance),
      },
      stock: month && {
        valueAtCost: round(month.inventory?.totalCostValue),
        valueAtSalePrice: round(month.inventory?.totalRetailValue),
        products: month.inventory?.totalProducts || 0,
        outOfStock: month.stockHealth?.outOfStock || 0,
        healthScore: month.stockHealth?.healthScore || 0,
        notSellingFor30Days: {
          count: month.stockHealth?.deadStockCount || 0,
          moneyTiedUp: round(month.stockHealth?.deadStockValue),
          examples: (month.deadStockProducts || []).map((p) => ({ name: p.name, stock: p.quantity, value: round(p.tiedUpValue) })),
        },
      },
      // Worked out from the last 30 days of sales; quantities are what to order
      restockNow: restock && {
        urgent: restock.urgentRestock.slice(0, 10).map((line) => ({
          product: line.product,
          inStock: line.currentStock,
          sellsPerDay: line.avgDailySales,
          daysLeft: line.daysUntilStockout,
          order: line.recommendedQty,
          cost: line.estimatedCost,
        })),
        atMinimumStock: restock.routineRestock.slice(0, 6).map((line) => ({ product: line.product, inStock: line.currentStock, order: line.recommendedQty })),
        lowButNotSelling: restock.doNotRestock.slice(0, 5).map((line) => line.product),
        totalCostToOrderAll: restock.totalEstimatedCost,
      },
      customersOwe: credit,
      openRecommendations: (recommendations || []).map((r) => ({ type: r.recommendationType, priority: r.priority, summary: String(r.recommendation || "").slice(0, 200) })),
      latestMonthlyBriefing: String(latestInsight?.summary || "").slice(0, 600),
    };

    contextCache.value = value;
    contextCache.at = Date.now();
    return value;
  } catch (err) {
    console.error("[AI Chat] Context build error:", err.message);
    return { date: dayKeyOf(new Date()), error: "Context unavailable" };
  }
}

/** Where things are in the app, so the assistant can point people to the right screen. */
export const APP_HELP = [
  { keywords: ["add product", "new product", "create product"], response: "To add a new product: Go to **Manage → Product List → Add Product**. Enter name, category, cost price, and sale price. Enable stock management if needed. Save." },
  { keywords: ["stock movement", "restock", "transfer stock"], response: "Go to **Stock → Stock Movement** to create restocks, transfers, or returns. Each movement auto-updates stock levels at relevant locations." },
  { keywords: ["end of day", "eod", "close till"], response: "Go to **Reporting → EOD Reports**. Select location and date, then reconcile your till against expected values. The system calculates variance automatically." },
  { keywords: ["expense", "add expense"], response: "Go to **Expenses → Expense Management**. Enter title, amount, category, and location. Cash entries can be added for daily operations." },
  { keywords: ["credit", "credit sale"], response: "Credit sales are tracked per customer. Go to the customer's profile to see outstanding credit. Mark payments as they come in." },
  { keywords: ["purchase order", "vendor payment"], response: "Go to **Manage → Vendor Payment Tracker** to manage purchase orders. Use Quick Entry for fast recording, or Seed Data to import vendors and orders from the expense app. Orders placed in **Manage → Vendors** wait in Submitted Stock Orders until they are received." },
];

/** "How do I…", "where can I…": a question about using the app, not about the business. */
const HOW_TO = /^\s*(how\s+(do|can|should|to)\b|how\s+i\b|where\s+(do|can|is|are|to)\b|what\s+is\s+the\s+way\b|steps?\s+to\b|guide\s+me\b|show\s+me\s+how\b)/i;

/** A ready answer for a how-to question about the app, or null when the question is about the business. */
export function helpAnswerFor(message) {
  // "add a product", "close the till": the small words are dropped so the help keywords match
  const text = String(message || "")
    .toLowerCase()
    .replace(/\b(a|an|the|my|our|some|new)\b/g, " ")
    .replace(/\s+/g, " ");
  if (!HOW_TO.test(text)) return null;
  return APP_HELP.find((entry) => entry.keywords.some((keyword) => text.includes(keyword))) || null;
}

const CHAT_SYSTEM_PROMPT = `You are the AI Business Assistant for a Nigerian retail business, inside its inventory and point-of-sale system.

RULES:
- Currency: Nigerian Naira (₦). Write amounts like ₦12,500.
- Answer from the business summary given with each question. Quote its figures; name its products.
- Never invent a figure, product or trend that is not in the summary. If the summary does not hold the answer, say what is missing and where in the app to look.
- "todaySoFar" is today only; "thisMonth" is the month to date. Do not mix them up.
- Restock quantities and days left in "restockNow" are already calculated from the last 30 days of sales — use them as given.
- Be concise and practical: lead with the answer, then up to 4 short bullet points. Under 200 words unless asked for detail.
- For how-to questions, use the app help below.

APP HELP:
${APP_HELP.map((entry) => `- ${entry.response}`).join("\n")}`;

/**
 * Process a chat message through the hybrid system
 * @param {string} message - User's message
 * @param {Array} conversationHistory - Previous messages for context
 * @returns {Promise<Object>}
 */
export async function processAIChatMessage(message, conversationHistory = [], providerOverride = null) {
  const startTime = Date.now();

  const context = await buildBusinessContext();

  const historyText = conversationHistory
    .slice(-6)
    .filter((m) => m && typeof m.content === "string" && m.source !== "error")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 1500)}`)
    .join("\n");

  const prompt = `BUSINESS SUMMARY (worked out just now):
${JSON.stringify(context, null, 2)}

${historyText ? `CONVERSATION SO FAR:\n${historyText}\n\n` : ""}User: ${message}`;

  const result = await generateAIText(prompt, { provider: providerOverride, systemPrompt: CHAT_SYSTEM_PROMPT });

  if (result.success) {
    return {
      success: true,
      response: result.text,
      context: { salesToday: context.todaySoFar?.sales || 0, healthScore: context.stock?.healthScore || 0 },
      meta: { ...result.meta, executionTimeMs: Date.now() - startTime },
    };
  }

  // The reason matters here. The old code swallowed it and always said "try
  // again", which hid an invalid key or an exhausted quota indefinitely.
  console.error("[AI Chat] Generation error:", result.error);
  return {
    success: false,
    response: result.error,
    error: result.error,
    meta: { ...result.meta, executionTimeMs: Date.now() - startTime },
  };
}

/** Suggested questions for the chat interface */
export const SUGGESTED_QUESTIONS = [
  "Summarize today's business performance",
  "What products should I restock?",
  "Which products are not selling?",
  "How is this month compared with last month?",
  "How much do customers owe me?",
  "What should I focus on today?",
  "Where is my money going this month?",
  "Summarize this month's report",
];
