import { Inter } from "next/font/google";
import { useRouter } from "next/router";
import { useAuth } from "@/lib/useAuth";
import Nav from "@/components/Nav";
import NavBar from "@/components/NavBar";
import Loader from "@/components/Loader";
import AccessDeniedState from "@/components/AccessDeniedState";

const inter = Inter({ subsets: ["latin"] });

// Map route prefixes to required permission keys
const ROUTE_PERMISSIONS = {
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
  "/manage/purchase-orders": "manage.purchase-orders",
  "/manage/products": "manage.products",
  "/manage/archived": "manage.archived",
  "/manage/categories": "manage.categories",
  "/manage/promotions-management": "manage.customer-promotions",
  "/manage/promotions": "manage.promotions",
  "/manage/orders": "manage.orders",
  "/manage/hotel-reservations": "manage.orders",
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
  "/reporting/sales-report": "reporting.sales-report",
  "/reporting/end-of-day-report": "reporting.eod",
  "/reporting/transaction-report": ["reporting.transaction-report", "reporting.transactions"],
  "/reporting/reporting": "reporting.sales-report",
  "/reporting": "reporting",
  "/expenses/expenses": "expenses.entry",
  "/expenses/credit-management": "expenses.analysis",
  "/expenses/analysis": "expenses.analysis",
  "/expenses/tax-analysis": "expenses.tax-analysis",
  "/expenses/tax-personal": "expenses.tax-personal",
  "/expenses": "expenses",
  "/support": "support",
};

function getRequiredPermission(pathname) {
  // Check most specific routes first (longer paths first)
  const sorted = Object.keys(ROUTE_PERMISSIONS).sort((a, b) => b.length - a.length);
  for (const prefix of sorted) {
    if (pathname.startsWith(prefix)) {
      return ROUTE_PERMISSIONS[prefix];
    }
  }
  return null; // No permission required (home, etc.)
}

export default function Layout({ children, title = "Dashboard" }) {
  const router = useRouter();
  const { user, token, loading, isAuthenticated, isAdmin, hasPermission, getFirstAccessiblePage, logout } = useAuth();
  const accessiblePath = getFirstAccessiblePage() || "/";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader size="lg" text="Loading..." />
      </div>
    );
  }

  //  REDIRECT TO LOGIN IF NOT AUTHENTICATED
  if (!isAuthenticated) {
    if (typeof window !== "undefined") {
      router.push("/login");
    }
    return null;
  }

  // CHECK PAGE PERMISSIONS
  const requiredPermission = getRequiredPermission(router.pathname);
  const hasAccess = !requiredPermission || isAdmin || (
    Array.isArray(requiredPermission)
      ? requiredPermission.some((permission) => hasPermission(permission))
      : hasPermission(requiredPermission)
  );

  // Dashboard access control: only admin or users with "dashboard" permission
  const isDashboard = router.pathname === "/";
  const hasDashboardAccess = isDashboard ? (isAdmin || hasPermission("dashboard")) : true;

  // Redirect non-dashboard users to their first accessible page
  if (isDashboard && !hasDashboardAccess) {
    if (typeof window !== "undefined") {
      const firstPage = getFirstAccessiblePage();
      router.replace(firstPage);
    }
    return null;
  }

  //  APP SHELL
  return (
    <div className="bg-gray-50 min-h-screen w-full flex flex-col">
      {/* Top Navigation Bar - Fixed */}
      <NavBar user={user} logout={logout} />

      {/* Main Layout Container */}
      <div className="w-full flex flex-col md:flex-row pt-14 md:pt-16 md:pl-20">
        {/* Desktop Navigation - Relative positioned sidebar */}
        <Nav className="hidden md:flex md:fixed md:top-16 md:left-0 md:w-20 md:h-screen md:z-40 md:flex-col" />

        {/* Main Content Area */}
        <div className="w-full flex-1 overflow-hidden">
          <div
            className="w-full min-h-[calc(100vh-56px)] md:min-h-[calc(100vh-64px)] px-3 md:px-6 bg-gray-50 overflow-y-auto"
          >
            {hasAccess ? children : (
              <AccessDeniedState
                message="You don't have permission to access this page."
                actionLabel="Go to Available Page"
                onAction={() => router.push(accessiblePath)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Mobile Menu Button - Handled by Nav component */}
    </div>
  );
}
