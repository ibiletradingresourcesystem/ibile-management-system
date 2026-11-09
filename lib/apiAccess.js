/**
 * The page permission each API needs.
 *
 * Pages are guarded in the browser (components/Layout.js, from lib/navigation.js). These are the
 * same permissions checked on the server, so an API can only be used by someone who can open a
 * page that uses it. authMiddleware applies them on every route from the token alone, so they add
 * no database work.
 *
 * `read` applies to GET, `write` to everything else; the longest matching path wins. A route with
 * no entry is open to any signed-in user. Actions narrower than a page (an admin-only refund, say)
 * are still checked in their own route.
 */
import { userCan } from "./permission-utils";

/** Names no permission, so only an admin passes. For routes nothing in the app calls any more. */
const ADMIN_ONLY = "admin-only";

const TAX = ["accounting.tax-analysis", "expenses.tax-analysis"];
const VENDORS = ["manage.vendors", "expenses.entry"];
const STOCK_MOVERS = ["stock.movement", "stock.management"];

const RULES = {
  "/api/accounting": { read: "accounting", write: "accounting" },
  "/api/accounting/accounts": { read: "accounting", write: "accounting.chart-of-accounts" },
  "/api/accounting/entries": { read: "accounting", write: "accounting.journal-entries" },
  "/api/accounting/journal-entries": { read: "accounting", write: "accounting.journal-entries" },

  "/api/assets": { write: "setup.assets" },
  "/api/campaigns": { write: "manage.campaigns" },
  "/api/cash-entries": { read: "manage.purchase-orders", write: "manage.purchase-orders" },
  "/api/categories": { write: ["manage.categories", "manage.products"] },
  "/api/customers": { read: "manage.customers", write: "manage.customers" },
  "/api/daily-cash": { read: "expenses", write: "expenses" },

  "/api/expenses": { read: ["expenses", "dashboard"], write: "expenses.entry" },
  "/api/expenses/analysis": { read: "expenses.analysis" },
  "/api/expenses/report": { read: "expenses.analysis" },
  "/api/expenses/expense-category": { read: "expenses", write: "expenses.entry" },
  "/api/petty-cash-transactions": { read: "expenses", write: "expenses.entry" },

  "/api/heroes": { read: "setup.hero-promo", write: "setup.hero-promo" },
  "/api/site-social-links": { read: "setup.hero-promo", write: "setup.hero-promo" },

  "/api/market": { write: "manage.market" },
  "/api/orders": { read: ["manage.orders", "dashboard"], write: "manage.orders" },

  "/api/products": {
    write: ["manage.products", "manage.archived", "stock.management", "stock.movement", "manage.promotions", "manage.customer-promotions"],
  },
  "/api/products/bulk": { write: ["manage.products", "manage.archived", "stock.management"] },
  "/api/products/links": { write: "manage.products" },
  "/api/products/promotions": { write: "manage.promotions" },
  "/api/promotions": { write: "manage.customer-promotions" },

  "/api/purchase-orders": { write: ["manage.purchase-orders", ...STOCK_MOVERS] },
  "/api/purchase-orders/reminder": { write: "manage.purchase-orders" },

  "/api/reporting": { read: "reporting", write: ADMIN_ONLY },
  "/api/reporting/stock-history-levels": { read: ["reporting", "stock.management"] },

  "/api/setup/color-theme": { write: "setup.color-theme" },
  "/api/setup/location-items": { write: "setup.location-items" },
  "/api/setup/update-location": { write: "setup.location-items" },
  "/api/setup/tender-assignments": { write: "setup.location-items" },
  "/api/setup/tenders": { write: "setup.pos-tenders" },
  "/api/setup/seed-tenders": { write: "setup.pos-tenders" },

  "/api/staff": { write: ["manage.staff", "manage.staff-roles"] },
  "/api/staff/penalties": { read: "manage.staff", write: "manage.staff" },
  "/api/staff/onboarding/send-link": { write: "manage.staff" },

  "/api/stock-movement": { write: "stock.movement" },
  "/api/stock-movement/stock-movement": { write: STOCK_MOVERS },
  "/api/stock-orders": { write: ["manage.vendors", "manage.purchase-orders"] },
  "/api/stock-take": { read: ["stock.stock-take", "stock.stock-take-report"], write: "stock.stock-take" },

  "/api/taxes": { read: TAX },
  "/api/till": { read: ADMIN_ONLY, write: ADMIN_ONLY },

  "/api/transactions": { read: "reporting", write: "reporting" },
  "/api/transactions/transactions": { read: ["reporting", "dashboard"], write: ADMIN_ONLY },
  "/api/transactions/from-order": { write: ADMIN_ONLY },

  "/api/vendors": { write: VENDORS },
};

const ORDERED_PATHS = Object.keys(RULES).sort((a, b) => b.length - a.length);

function ruleFor(pathname) {
  const match = ORDERED_PATHS.find((path) => pathname === path || pathname.startsWith(`${path}/`));
  return match ? RULES[match] : null;
}

/** Whether this user may make this request, as far as the table says. */
export function canCallApi(user, method, url) {
  const rule = ruleFor(String(url || "").split("?")[0]);
  if (!rule) return true;
  return userCan(user, method === "GET" || method === "HEAD" ? rule.read : rule.write);
}
