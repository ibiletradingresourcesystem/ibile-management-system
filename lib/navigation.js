/**
 * The single source of truth for the sidebar.
 *
 * The desktop rail and the mobile drawer used to carry their own copy of every
 * link, label and permission key, so a rename or a fix only landed on one of
 * them (that is how the Tax pages ended up pointing at /expenses/... where no
 * page exists). Both now render from this list.
 *
 * Each section:
 *   key        unique id used for open/close state
 *   label      what shows in the rail
 *   icon       FontAwesome icon
 *   match      route prefixes that mark the section active
 *   permission permission key for the section as a whole
 *   href       set instead of `items` for a plain link
 *   external   true for an off-site link (opens in a new tab)
 *   items      submenu entries: { href, label, permission, group }
 *   groups     named collapsible groups inside the submenu
 */
import { isBasicStaffRole } from "./permission-utils";
import {
  faHome,
  faCog,
  faList,
  faBoxes,
  faChartLine,
  faCashRegister,
  faHeadset,
  faCoins,
  faBook,
} from "@fortawesome/free-solid-svg-icons";

/** Where the POS / Till front end lives. */
export const TILL_URL = "https://ibile-salespoint-app.vercel.app/";

export const MENU = [
  {
    key: "home",
    label: "Home",
    icon: faHome,
    href: "/",
    permission: "dashboard",
    match: ["/"],
    exact: true,
  },

  {
    key: "setup",
    label: "Setup",
    icon: faCog,
    permission: "setup",
    match: ["/setup"],
    items: [
      { href: "/setup/setup", label: "Business Profile", permission: "setup.company" },
      { href: "/setup/Hero-Promo-setup", label: "Storefront & Promos", permission: "setup.hero-promo" },
      { href: "/setup/receipts", label: "Receipt Settings", permission: "setup.receipts" },
      { href: "/setup/pos-tenders", label: "Payment Methods", permission: "setup.pos-tenders" },
      { href: "/setup/location-items", label: "Location Payments", permission: "setup.location-items" },
      { href: "/setup/assets", label: "Asset Register", permission: "setup.assets" },
      { href: "/setup/users", label: "User Accounts", permission: "setup.users" },
      { href: "/setup/color-theme", label: "Appearance & Theme", permission: "setup.color-theme" },
    ],
  },

  {
    key: "manage",
    label: "Manage",
    icon: faList,
    permission: "manage",
    match: ["/manage", "/products", "/memo"],
    groups: [
      { key: "staff-menu", label: "Staff", match: ["/manage/staff"] },
      {
        key: "procurement-menu",
        label: "Procurement",
        match: ["/manage/vendors", "/manage/market", "/manage/purchase-orders", "/memo"],
      },
    ],
    items: [
      { href: "/manage/products", label: "Products", permission: "manage.products" },
      { href: "/manage/product-import", label: "Bulk Import", permission: "manage.products" },
      { href: "/manage/archived", label: "Archived Products", permission: "manage.archived" },
      { href: "/products/price-tags", label: "Price Tags", permission: "manage.products" },
      { href: "/manage/categories", label: "Categories", permission: "manage.categories" },
      { href: "/manage/promotions", label: "Product Promotions", permission: "manage.promotions" },
      { href: "/manage/promotions-management", label: "Customer Campaigns", permission: "manage.customer-promotions" },
      { href: "/manage/orders", label: "Orders", permission: "manage.orders" },
      { href: "/manage/customers", label: "Customers", permission: "manage.customers" },
      { href: "/manage/staff", label: "Staff Directory", permission: "manage.staff", group: "staff-menu" },
      { href: "/manage/staff-roles", label: "Roles & Permissions", permission: "manage.staff-roles", group: "staff-menu" },
      { href: "/manage/vendors", label: "Vendors", permission: "manage.vendors", group: "procurement-menu" },
      { href: "/manage/market", label: "Market", permission: "manage.market", group: "procurement-menu" },
      { href: "/manage/purchase-orders", label: "Purchase Orders", permission: "manage.purchase-orders", group: "procurement-menu" },
    ],
  },

  {
    key: "stock",
    label: "Stock",
    icon: faBoxes,
    permission: "stock",
    match: ["/stock"],
    items: [
      { href: "/stock/management", label: "Stock Levels", permission: "stock.management" },
      { href: "/stock/movement", label: "Stock Movement", permission: "stock.movement" },
      { href: "/stock/stock-history-levels", label: "Stock History", permission: "stock.management" },
      { href: "/stock/stock-take", label: "Stock Take", permission: "stock.stock-take" },
      { href: "/stock/stock-take-report", label: "Stock Take Reports", permission: "stock.stock-take-report" },
      { href: "/stock/expiration-report", label: "Expiry Tracking", permission: "stock.expiration-report" },
    ],
  },

  {
    key: "reporting",
    label: "Reports",
    icon: faChartLine,
    permission: "reporting",
    match: ["/reporting"],
    groups: [{ key: "sales-report", label: "Sales Breakdown", match: ["/reporting/sales-report"] }],
    items: [
      { href: "/reporting/reporting", label: "Sales Report", permission: "reporting.sales-report" },
      { href: "/reporting/end-of-day-report", label: "End of Day Reports", permission: "reporting.eod" },
      {
        href: "/reporting/transaction-report/completed-transactions",
        label: "Completed Transactions",
        permission: ["reporting.transaction-report", "reporting.transactions"],
      },
      { href: "/reporting/sales-report/time-intervals", label: "Time Intervals", permission: "reporting.time-intervals", group: "sales-report" },
      { href: "/reporting/sales-report/time-comparisons", label: "Time Comparisons", permission: "reporting.time-comparisons", group: "sales-report" },
      { href: "/reporting/sales-report/products", label: "Sales by Product", permission: "reporting.sales-by-product", group: "sales-report" },
      { href: "/reporting/sales-report/employees", label: "Sales by Employee", permission: "reporting.employees", group: "sales-report" },
      { href: "/reporting/sales-report/locations", label: "Sales by Location", permission: "reporting.locations", group: "sales-report" },
      { href: "/reporting/sales-report/categories", label: "Sales by Category", permission: "reporting.categories", group: "sales-report" },
    ],
  },

  {
    key: "expenses",
    label: "Expenses",
    icon: faCoins,
    permission: "expenses",
    match: ["/expenses"],
    items: [
      { href: "/expenses/expenses", label: "Record Expenses", permission: "expenses.entry" },
      { href: "/expenses/analysis", label: "Expense Analysis", permission: "expenses.analysis" },
      { href: "/expenses/categories", label: "Expense Categories", permission: "expenses.entry" },
      { href: "/expenses/petty-cash", label: "Petty Cash", permission: "expenses.entry" },
    ],
  },

  {
    key: "accounting",
    label: "Accounting",
    icon: faBook,
    permission: "accounting",
    match: ["/accounting"],
    items: [
      { href: "/accounting/chart-of-accounts", label: "Chart of Accounts", permission: "accounting.chart-of-accounts" },
      { href: "/accounting/journal-entries", label: "Journal Entries", permission: "accounting.journal-entries" },
      { href: "/accounting/general-ledger", label: "General Ledger", permission: "accounting.general-ledger" },
      { href: "/accounting/reports", label: "Financial Statements", permission: "accounting.trial-balance" },
      // Tax sits with the books, not with expenses: both pages live under /accounting,
      // and the menu listed them under Expenses only for historical reasons.
      { href: "/accounting/tax-analysis", label: "Business Tax", permission: ["accounting.tax-analysis", "expenses.tax-analysis"] },
      { href: "/accounting/tax-personal", label: "Personal Tax Calculator", permission: ["accounting.tax-personal", "expenses.tax-personal"] },
    ],
  },

  {
    key: "till",
    label: "Till",
    icon: faCashRegister,
    href: TILL_URL,
    external: true,
    permission: "till",
    match: [],
  },

  {
    key: "support",
    label: "Support",
    icon: faHeadset,
    permission: "support",
    match: ["/support"],
    items: [
      { href: "/support", label: "Help & Tickets" },
      { href: "/support/ai-business-assistant", label: "AI Assistant" },
    ],
  },
];

/** All permission keys a section touches — used to hide an empty section. */
export function sectionPermissions(section) {
  const keys = [section.permission];
  (section.items || []).forEach((item) => {
    if (Array.isArray(item.permission)) keys.push(...item.permission);
    else if (item.permission) keys.push(item.permission);
  });
  return keys.filter(Boolean);
}

/** Does `pathname` sit inside this section? */
export function isSectionActive(section, pathname) {
  if (section.exact) return pathname === section.href;
  return (section.match || []).some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/") || pathname.startsWith(prefix));
}

/**
 * Highlight the right submenu entry, including the pages that are logically
 * "inside" another one (a product edit form belongs to Products, a stock-take
 * detail belongs to Stock Take).
 */
export function isItemActive(href, pathname) {
  if (pathname === href) return true;
  if (href === "/stock/stock-take") {
    return pathname.startsWith("/stock/stock-take/") && !pathname.startsWith("/stock/stock-take-report");
  }
  if (href === "/stock/movement") return pathname.startsWith("/stock/movement/");
  if (href === "/manage/products") {
    return pathname.startsWith("/products") && pathname !== "/products/price-tags";
  }
  if (href === "/manage/purchase-orders") return pathname.startsWith("/memo");
  if (href === "/reporting/transaction-report/completed-transactions") {
    return pathname.startsWith("/reporting/transaction-report");
  }
  return false;
}

/* ─── Access ──────────────────────────────────────────────────────────── */

// The permission each page needs: the page guard in components/Layout.js reads it, and so does
// the choice of a user's home page below, so the two always agree.
// Map route prefixes to required permission keys
export const ROUTE_PERMISSIONS = {
  "/setup/users": "setup.users",
  "/setup/assets": "setup.assets",
  "/setup/setup": "setup.company",
  "/setup/Hero-Promo-setup": "setup.hero-promo",
  "/setup/receipts": "setup.receipts",
  "/setup/pos-tenders": "setup.pos-tenders",
  "/setup/location-items": "setup.location-items",
  "/setup": "setup",
  "/manage/staff-roles": "manage.staff-roles",
  "/manage/staff": "manage.staff",
  "/manage/vendors": "manage.vendors",
  "/manage/market": "manage.market",
  "/manage/purchase-orders": "manage.purchase-orders",
  "/manage/products": "manage.products",
  "/manage/product-import": "manage.products",
  "/manage/archived": "manage.archived",
  "/manage/categories": "manage.categories",
  "/manage/promotions-management": "manage.customer-promotions",
  "/manage/promotions": "manage.promotions",
  "/manage/orders": "manage.orders",
  "/manage/customers": "manage.customers",
  "/manage/campaigns": "manage.campaigns",
  "/manage": "manage",
  "/stock/management": "stock.management",
  "/stock/movement": "stock.movement",
  "/stock/stock-history-levels": "stock.management",
  "/stock/stock-take-report": "stock.stock-take-report",
  "/stock/stock-take": "stock.stock-take",
  "/stock/expiration-report": "stock.expiration-report",
  "/stock": "stock",
  // Each Sales Breakdown page opens with its own permission (as the menu shows it), or with
  // Sales Report as before. Only Sales Report used to be checked, so someone given just Time
  // Comparisons saw it in the menu and was turned away from it.
  "/reporting/sales-report/time-intervals": ["reporting.time-intervals", "reporting.sales-report"],
  "/reporting/sales-report/time-comparisons": ["reporting.time-comparisons", "reporting.sales-report"],
  "/reporting/sales-report/products": ["reporting.sales-by-product", "reporting.sales-report"],
  "/reporting/sales-report/employees": ["reporting.employees", "reporting.sales-report"],
  "/reporting/sales-report/locations": ["reporting.locations", "reporting.sales-report"],
  "/reporting/sales-report/categories": ["reporting.categories", "reporting.sales-report"],
  "/reporting/sales-report": "reporting.sales-report",
  "/reporting/end-of-day-report": "reporting.eod",
  "/reporting/transaction-report": ["reporting.transaction-report", "reporting.transactions"],
  "/reporting/reporting": "reporting.sales-report",
  "/reporting": "reporting",
  "/expenses/expenses": "expenses.entry",
  "/expenses/analysis": "expenses.analysis",
  "/expenses": "expenses",
  // The tax pages live under /accounting but are reached from the Expenses
  // menu, so either permission opens them.
  "/accounting/tax-analysis": ["accounting.tax-analysis", "expenses.tax-analysis"],
  "/accounting/tax-personal": ["accounting.tax-personal", "expenses.tax-personal"],
  "/accounting/chart-of-accounts": "accounting.chart-of-accounts",
  "/accounting/journal-entries": "accounting.journal-entries",
  "/accounting/general-ledger": "accounting.general-ledger",
  "/accounting/reports": "accounting.trial-balance",
  "/accounting/trial-balance": "accounting.trial-balance",
  "/accounting/profit-loss": "accounting.profit-loss",
  "/accounting/balance-sheet": "accounting.balance-sheet",
  "/accounting": "accounting",
  "/products": "manage.products",
  "/memo": "manage.purchase-orders",
  "/support": "support",
};

export function getRequiredPermission(pathname) {
  // Check most specific routes first (longer paths first)
  const sorted = Object.keys(ROUTE_PERMISSIONS).sort((a, b) => b.length - a.length);
  for (const prefix of sorted) {
    if (pathname.startsWith(prefix)) {
      return ROUTE_PERMISSIONS[prefix];
    }
  }
  return null; // No permission required (home, etc.)
}

/**
 * The rule the app checks permissions by (lib/useAuth.js uses the same one): an admin may do
 * everything; otherwise the key itself, or for a section key ("stock") any page inside it.
 * A list of keys passes when any one does. No key means no restriction.
 */
export function userCan(user, permission) {
  if (!permission) return true;
  if (user?.role === "admin") return true;
  if (Array.isArray(permission)) return permission.some((key) => userCan(user, key));
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  if (permissions.includes(permission)) return true;
  if (!permission.includes(".")) return permissions.some((key) => key.startsWith(`${permission}.`));
  return false;
}

/** Can this user open the page at `href`: is it in their menu, and does the page guard let them in? */
function canOpen(user, href, menuPermission) {
  if (href === "/") return userCan(user, "dashboard");
  return userCan(user, menuPermission) && userCan(user, getRequiredPermission(href));
}

/* ─── Basic staff ─────────────────────────────────────────────────────── */

/** Pages basic staff do not open, whatever their permissions: the stock movement history. */
const BASIC_STAFF_BLOCKED = ["/stock/movement"];

/** Is this page closed to this user because of their role (not their permissions)? */
export function isRouteBlockedForUser(user, pathname) {
  if (!isBasicStaffRole(user?.role)) return false;
  return BASIC_STAFF_BLOCKED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** For basic staff, Stock Movement is where they record a loss: the one movement they make. */
function forBasicStaff(item) {
  if (item.href === "/stock/movement") return { ...item, href: "/stock/add", label: "Record Stock Loss" };
  return item;
}

/** A section's pages in the order its flyout shows them: its own pages, then its groups'. */
function orderedItems(section) {
  const items = section.items || [];
  return [
    ...items.filter((item) => !item.group),
    ...(section.groups || []).flatMap((group) => items.filter((item) => item.group === group.key)),
  ];
}

/**
 * The menu as this user sees it.
 *
 * Basic staff get a short flat menu: one entry for each page they can open, going straight to
 * it, with its section's icon (Vendors, Record Stock Loss, Stock Take…). There are no sections to
 * open first: a staff member given only Vendors under Manage used to tap Manage, then
 * Procurement, then Vendors. Which pages they get is still set in /setup/users. Everyone else
 * gets the full menu, sections and all.
 */
export function menuFor(user) {
  if (!isBasicStaffRole(user?.role)) return MENU;
  const entries = [];
  for (const section of MENU) {
    if (section.href) {
      if (section.external ? userCan(user, section.permission) : canOpen(user, section.href, section.permission)) {
        entries.push(section);
      }
      continue;
    }
    for (const item of orderedItems(section).map(forBasicStaff)) {
      const permission = item.permission ?? section.permission;
      if (!canOpen(user, item.href, permission) || isRouteBlockedForUser(user, item.href)) continue;
      entries.push({
        key: `${section.key}:${item.href}`,
        label: item.label,
        icon: section.icon,
        href: item.href,
        permission,
        match: [item.href],
        // Highlighted like the page itself (a stock-take sheet lights up Stock Take)
        flatItem: true,
      });
    }
  }
  return entries;
}

/**
 * A user's home page: the top-most page in the sidebar they can open, in the order the sidebar
 * shows them (sections top to bottom; in each, its own pages first, then its groups). An admin,
 * or anyone with the dashboard, gets the dashboard. It used to be a short fixed list, so someone
 * given only Vendors, or only Stock Take, was sent to Support.
 */
export function firstAccessiblePage(user) {
  if (!user) return "/login";
  for (const section of menuFor(user)) {
    if (section.external) continue;
    if (section.href) {
      if (canOpen(user, section.href, section.permission) && !isRouteBlockedForUser(user, section.href)) return section.href;
      continue;
    }
    for (const item of orderedItems(section)) {
      if (canOpen(user, item.href, item.permission ?? section.permission) && !isRouteBlockedForUser(user, item.href)) return item.href;
    }
  }
  return "/support";
}

/** The current page's name from the menu ("Vendors", "Stock Take"), for the top bar on a phone. */
export function pageTitleFor(pathname) {
  if (!pathname || pathname === "/") return "Home";
  let best = null;
  for (const section of MENU) {
    for (const item of section.items || []) {
      const hit = pathname === item.href || isItemActive(item.href, pathname) || pathname.startsWith(`${item.href}/`);
      if (hit && (!best || item.href.length > best.href.length)) best = item;
    }
  }
  if (best) return best.label;
  if (pathname.startsWith("/stock/add")) return "Stock Movement";
  const section = MENU.find((s) => !s.exact && isSectionActive(s, pathname));
  return section?.label || "";
}
