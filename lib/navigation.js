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
        match: ["/manage/vendors", "/manage/purchase-orders", "/memo"],
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
      // These two live under /accounting. The menu used to point at
      // /expenses/tax-analysis and /expenses/tax-personal, which are 404s.
      { href: "/accounting/tax-analysis", label: "Business Tax", permission: ["expenses.tax-analysis", "accounting.tax-analysis"] },
      { href: "/accounting/tax-personal", label: "Personal Tax Calculator", permission: ["expenses.tax-personal", "accounting.tax-personal"] },
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
