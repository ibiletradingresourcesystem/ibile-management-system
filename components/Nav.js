import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHome,
  faCog,
  faList,
  faBoxes,
  faChartLine,
  faCashRegister,
  faHeadset,
  faChevronRight,
  faCoins,
  faBars,
  faTimes,
  faBook,
  faRobot,
} from "@fortawesome/free-solid-svg-icons";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Loader from "@/components/Loader";
import { useAuth } from "@/lib/useAuth";

export default function Sidebar() {
  const [openMenu, setOpenMenu] = useState(null);
  const [openSubMenu, setOpenSubMenu] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const sidebarRef = useRef(null);
  const router = useRouter();
  const { pathname } = router;
  const { isAdmin, hasPermission } = useAuth();

  // Permission check helper - checks both submenu and parent permissions
  const canAccess = (permKey) => {
    if (isAdmin) return true;
    return hasPermission(permKey);
  };

  // Check if any child in a menu section is accessible
  const canAccessAny = (permKeys) => {
    if (isAdmin) return true;
    return permKeys.some((key) => hasPermission(key));
  };
  const canAccessTransactionReport = canAccessAny(["reporting.transaction-report", "reporting.transactions"]);

  // Detect mobile view
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) {
        setIsMobileMenuOpen(false);
      }
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Close submenu when clicking outside (desktop only)
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target)) {
        setOpenMenu(null);
      }
    };

    // Only add listener if a menu is open and we're on desktop
    if (openMenu && !isMobile) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [openMenu, isMobile]);

  const toggleMenu = (menu) => {
    setOpenMenu(openMenu === menu ? null : menu);
  };

  const toggleSubMenu = (submenu) => {
    setOpenSubMenu(openSubMenu === submenu ? null : submenu);
  };

  const closeMenu = () => {
    setOpenMenu(null);
    if (isMobile) {
      setIsMobileMenuOpen(false);
    }
  };

  const closeMenuOnNavigation = () => {
    setOpenMenu(null);
    setOpenSubMenu(null);
    if (isMobile) {
      setIsMobileMenuOpen(false);
    }
  };

  // Auto-open menu based on active pathname ONLY if desktop and menu was not just closed
  useEffect(() => {
    if (isMobile) return; // Don't auto-open on mobile
    
    if (pathname.startsWith("/setup")) {
      setOpenMenu("setup");
      setOpenSubMenu(null);
    } else if (pathname.startsWith("/manage") || pathname.startsWith("/products") || pathname.startsWith("/memo")) {
      setOpenMenu("manage");
      // Auto-open staff sub-menu if on a staff page
      if (pathname.startsWith("/manage/staff")) {
        setOpenSubMenu("staff-menu");
      } else if (pathname.startsWith("/manage/vendors") || pathname.startsWith("/manage/purchase-orders") || pathname.startsWith("/memo")) {
        setOpenSubMenu("procurement-menu");
      } else {
        setOpenSubMenu(null);
      }
    } else if (pathname.startsWith("/stock")) {
      setOpenMenu("stock");
      setOpenSubMenu(null);
    } else if (pathname.startsWith("/reporting")) {
      setOpenMenu("reporting");
      // Auto-open sub-menus based on specific reporting paths
      if (pathname.startsWith("/reporting/sales-report")) {
        setOpenSubMenu("sales-report");
      } else {
        setOpenSubMenu(null);
      }
    } else if (pathname.startsWith("/expenses")) {
      setOpenMenu("expenses");
      setOpenSubMenu(null);
    } else if (pathname.startsWith("/accounting")) {
      setOpenMenu("accounting");
      setOpenSubMenu(null);
    } else if (pathname === "/till") {
      setOpenMenu("till");
      setOpenSubMenu(null);
    } else if (pathname.startsWith("/support")) {
      setOpenMenu("support");
      setOpenSubMenu(null);
    }
  }, [pathname, isMobile]);

  useEffect(() => {
    const handleStart = () => setLoading(true);
    const handleStop = () => setLoading(false);
    const handleComplete = () => {
      setLoading(false);
      closeMenuOnNavigation();
    };

    router.events.on("routeChangeStart", handleStart);
    router.events.on("routeChangeComplete", handleComplete);
    router.events.on("routeChangeError", handleStop);

    return () => {
      router.events.off("routeChangeStart", handleStart);
      router.events.off("routeChangeComplete", handleComplete);
      router.events.off("routeChangeError", handleStop);
    };
  }, [router]);

  const baseLink =
    "px-2 py-4 text-gray-600 transition-all duration-300 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-center flex-col text-xs cursor-pointer border-l-4 border-transparent hidden md:flex";
  const activeLinkStyle = { background: `linear-gradient(to right, var(--sidebar-active-from, #2563eb), var(--sidebar-active-to, #1d4ed8))`, borderLeftColor: `var(--sidebar-active-to, #1d4ed8)` };
  const activeLink = `px-2 py-4 text-white nav-active-gradient flex items-center justify-center flex-col text-xs cursor-pointer font-semibold border-l-4 transition-all duration-300 hidden md:flex shadow-md`;

  const mobileBaseLink = "px-3 py-3 text-gray-700 transition-all duration-300 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent flex items-center gap-3 text-sm";
  const mobileActiveLinkStyle = { background: `linear-gradient(to right, var(--sidebar-active-from, #2563eb), var(--sidebar-active-to, #1d4ed8))`, borderLeftColor: `var(--sidebar-active-to, #1d4ed8)` };
  const mobileActiveLink = "px-3 py-3 text-white border-l-4 nav-active-gradient flex items-center gap-3 text-sm font-semibold";

  const renderMenuItem = (href, icon, label) => (
    <li key={href} className={pathname === href ? activeLink : baseLink}>
      <Link href={href} onClick={closeMenu}>
        <div className="flex flex-col items-center justify-center">
          <FontAwesomeIcon icon={icon} className="w-6 h-6" />
          <span className="text-xs">{label}</span>
        </div>
      </Link>
    </li>
  );

  const isLinkActive = (href) => {
    if (pathname === href) return true;
    if (href === "/stock/stock-take" && pathname.startsWith("/stock/stock-take") && !pathname.startsWith("/stock/stock-take-report")) {
      return true;
    }
    // Product form/edit pages should highlight "Product List"
    if (href === "/manage/products" && pathname.startsWith("/products") && pathname !== "/products/price-tags") return true;
    return false;
  };

  const renderSubMenu = (items) =>
    items.map(({ href, label, indent }, index) => {
      const isActive = isLinkActive(href);
      return (
        <li
          key={href}
          className={`border-b border-gray-100 last:border-b-0 transition-all duration-300 group`}
          onClick={closeMenuOnNavigation}
        >
          <Link 
            href={href} 
            className={`w-full h-14 flex items-center justify-between text-sm font-medium transition-all duration-300 ${
              indent ? "px-8 py-3" : "px-4 py-3"
            } ${
              isActive
                ? "bg-gradient-to-r from-blue-50 to-transparent border-l-4 border-blue-600 text-blue-600 shadow-sm"
                : "text-gray-700 hover:bg-gray-50 hover:text-blue-600 border-l-4 border-transparent"
            }`}
          >
            <span className="flex items-center gap-3">
              {!indent && (
                <span className={`w-1.5 h-1.5 rounded-full transition-all ${
                  isActive ? "bg-blue-600 scale-125" : "bg-gray-300 group-hover:bg-blue-400"
                }`}></span>
              )}
              {label}
            </span>
            {isActive && (
              <span className="text-blue-600 text-lg">›</span>
            )}
          </Link>
        </li>
      );
    });

  return (
    <>
      {/* MOBILE MENU BUTTON - Floating Circle at Bottom */}
      {isMobile && !isMobileMenuOpen && (
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="md:hidden fixed bottom-6 right-6 w-16 h-16 rounded-full text-white flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-110 z-40"
          style={{ background: `linear-gradient(to right, var(--sidebar-active-from, #2563eb), var(--sidebar-active-to, #1d4ed8))` }}
          aria-label="Open menu"
        >
          <div className="flex flex-col items-center justify-center gap-1">
            <FontAwesomeIcon icon={faBars} className="w-5 h-5" />
            <span className="text-xs font-semibold">Menu</span>
          </div>
        </button>
      )}

      {/* MOBILE BACKDROP */}
      {isMobileMenuOpen && isMobile && (
        <div
          className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* DESKTOP SIDEBAR */}
      <aside 
        ref={sidebarRef}
        className="fixed top-12 md:top-16 left-0 w-20 h-screen bg-gradient-to-b from-gray-50 to-gray-100 border-r border-gray-200 z-10 shadow-lg hidden md:block overflow-visible"
      >
        <nav className="mt-6 h-full overflow-visible">
          <ul className="space-y-1">
            {canAccess("dashboard") && renderMenuItem("/", faHome, "Home")}
            {/* Setup Menu with Submenu */}
            {canAccessAny(["setup", "setup.company", "setup.hero-promo", "setup.receipts", "setup.pos-tenders", "setup.location-items", "setup.assets", "setup.users", "setup.color-theme"]) && (
            <li
              className={`${pathname.startsWith("/setup") ? activeLink : baseLink} relative`}
            >
              <div
                className="flex flex-col items-center justify-center cursor-pointer"
                onClick={() => toggleMenu("setup")}
              >
                <FontAwesomeIcon icon={faCog} className="w-6 h-6" />
                <span className="text-xs">Setup</span>
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`w-3 h-3 mt-1 transition-transform duration-300 ${
                    openMenu === "setup" ? "rotate-90" : ""
                  }`}
                />
              </div>
              <ul
                className={`fixed top-12 md:top-16 left-20 w-56 h-[calc(100vh-3rem)] md:h-[calc(100vh-4rem)] bg-white border-r border-gray-200 overflow-y-auto shadow-2xl transition-all duration-300 ease-in-out z-40 ${
                  openMenu === "setup"
                    ? "translate-x-0 opacity-100 visible"
                    : "translate-x-4 opacity-0 invisible"
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b border-gray-200 sticky top-0 bg-white">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Setup</p>
                </div>
                {renderSubMenu([
                  { href: "/setup/setup", label: "Company Details" },
                  { href: "/setup/Hero-Promo-setup", label: "Hero-Promo Setup " },
                  { href: "/setup/receipts", label: "Receipts" },
                  { href: "/setup/pos-tenders", label: "POS Tenders" },
                  { href: "/setup/location-items", label: "Location Tenders" },
                  { href: "/setup/assets", label: "Assets" },
                  { href: "/setup/users", label: "Users" },
                  { href: "/setup/color-theme", label: "Color Theme" },
                ].filter(item => {
                  const permMap = {
                    "/setup/setup": "setup.company",
                    "/setup/Hero-Promo-setup": "setup.hero-promo",
                    "/setup/receipts": "setup.receipts",
                    "/setup/pos-tenders": "setup.pos-tenders",
                    "/setup/location-items": "setup.location-items",
                    "/setup/assets": "setup.assets",
                    "/setup/users": "setup.users",
                    "/setup/color-theme": "setup.color-theme",
                  };
                  return canAccess(permMap[item.href] || "setup");
                }))}
              </ul>
            </li>
            )}

            {/* Manage */}
            {canAccessAny(["manage", "manage.products", "manage.archived", "manage.categories", "manage.promotions", "manage.customer-promotions", "manage.orders", "manage.customers", "manage.campaigns", "manage.staff", "manage.staff-roles", "manage.vendors", "manage.purchase-orders"]) && (
            <li
              className={`${(pathname.startsWith("/manage") || pathname.startsWith("/products") || pathname.startsWith("/memo")) ? activeLink : baseLink} relative`}
            >
              <div
                className="flex flex-col items-center justify-center cursor-pointer"
                onClick={() => toggleMenu("manage")}
              >
                <FontAwesomeIcon icon={faList} className="w-6 h-6" />
                <span className="text-xs">Manage</span>
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`w-3 h-3 mt-1 transition-transform duration-300 ${
                    openMenu === "manage" ? "rotate-90" : ""
                  }`}
                />
              </div>
              <ul
                className={`fixed top-12 md:top-16 left-20 w-56 h-[calc(100vh-3rem)] md:h-[calc(100vh-4rem)] bg-white border-r border-gray-200 overflow-y-auto shadow-2xl transition-all duration-300 ease-in-out z-40 ${
                  openMenu === "manage"
                    ? "translate-x-0 opacity-100 visible"
                    : "translate-x-4 opacity-0 invisible"
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b border-gray-200 sticky top-0 bg-white">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Manage</p>
                </div>
                {renderSubMenu([
                  { href: "/manage/products", label: "Product List" },
                  { href: "/manage/archived", label: "Archived Products" },
                  { href: "/products/price-tags", label: "Price Tags" },
                  { href: "/manage/categories", label: "Categories" },
                  { href: "/manage/promotions", label: "Product Promotions" },
                  { href: "/manage/promotions-management", label: "Campaign Promotions ", indent: false },
                  { href: "/manage/orders", label: "Orders" },
                  { href: "/manage/customers", label: "Customers", indent: false },
                ].filter(item => {
                  const permMap = {
                    "/manage/products": "manage.products",
                    "/manage/archived": "manage.archived",
                    "/products/price-tags": "manage.products",
                    "/manage/categories": "manage.categories",
                    "/manage/promotions": "manage.promotions",
                    "/manage/promotions-management": "manage.customer-promotions",
                    "/manage/orders": "manage.orders",
                    "/manage/customers": "manage.customers",
                  };
                  return canAccess(permMap[item.href] || "manage");
                }))}
                {canAccessAny(["manage.staff", "manage.staff-roles"]) && (
                <li className="border-b border-gray-100 transition-all duration-300 group">
                  <button
                    onClick={() => toggleSubMenu("staff-menu")}
                    className="w-full h-14 px-4 py-3 flex items-center justify-between text-sm font-medium transition-all duration-300 text-gray-700 hover:bg-gray-50 hover:text-blue-600 border-l-4 border-transparent"
                  >
                    <span className="flex items-center gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 group-hover:bg-blue-400 transition-all"></span>
                      Staff
                    </span>
                    <span className={`text-lg transition-transform duration-300 ${openSubMenu === "staff-menu" ? "rotate-90" : ""}`}>›</span>
                  </button>
                  {openSubMenu === "staff-menu" && (
                    <div className="bg-gray-50 border-t border-gray-100">
                      {renderSubMenu([
                        { href: "/manage/staff", label: "Staff Page", indent: true },
                        { href: "/manage/staff-roles", label: "Staff Roles", indent: true },
                      ].filter(item => {
                        const permMap = {
                          "/manage/staff": "manage.staff",
                          "/manage/staff-roles": "manage.staff-roles",
                        };
                        return canAccess(permMap[item.href] || "manage");
                      }))}
                    </div>
                  )}
                </li>
                )}
                {canAccessAny(["manage.vendors", "manage.purchase-orders"]) && (
                <li className="border-b border-gray-100 transition-all duration-300 group">
                  <button
                    onClick={() => toggleSubMenu("procurement-menu")}
                    className="w-full h-14 px-4 py-3 flex items-center justify-between text-sm font-medium transition-all duration-300 text-gray-700 hover:bg-gray-50 hover:text-blue-600 border-l-4 border-transparent"
                  >
                    <span className="flex items-center gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 group-hover:bg-blue-400 transition-all"></span>
                      Procurement
                    </span>
                    <span className={`text-lg transition-transform duration-300 ${openSubMenu === "procurement-menu" ? "rotate-90" : ""}`}>›</span>
                  </button>
                  {openSubMenu === "procurement-menu" && (
                    <div className="bg-gray-50 border-t border-gray-100">
                      {renderSubMenu([
                        { href: "/manage/vendors", label: "Vendors", indent: true },
                        { href: "/manage/purchase-orders", label: "Payment Tracker", indent: true },
                      ].filter(item => {
                        const permMap = {
                          "/manage/vendors": "manage.vendors",
                          "/manage/purchase-orders": "manage.purchase-orders",
                        };
                        return canAccess(permMap[item.href] || "manage");
                      }))}
                    </div>
                  )}
                </li>
                )}
              </ul>
            </li>
            )}

            {/* Stock */}
            {canAccessAny(["stock", "stock.management", "stock.movement", "stock.stock-take", "stock.stock-take-report", "stock.expiration-report"]) && (
            <li
              className={`${pathname.startsWith("/stock") ? activeLink : baseLink} relative`}
            >
              <div
                className="flex flex-col items-center justify-center cursor-pointer"
                onClick={() => toggleMenu("stock")}
              >
                <FontAwesomeIcon icon={faBoxes} className="w-6 h-6" />
                <span className="text-xs">Stock</span>
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`w-3 h-3 mt-1 transition-transform duration-300 ${
                    openMenu === "stock" ? "rotate-90" : ""
                  }`}
                />
              </div>
              <ul
                className={`fixed top-12 md:top-16 left-20 w-56 h-[calc(100vh-3rem)] md:h-[calc(100vh-4rem)] bg-white border-r border-gray-200 overflow-y-auto shadow-2xl transition-all duration-300 ease-in-out z-40 ${
                  openMenu === "stock"
                    ? "translate-x-0 opacity-100 visible"
                    : "translate-x-4 opacity-0 invisible"
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b border-gray-200 sticky top-0 bg-white">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Stock</p>
                </div>
                {renderSubMenu([
                  { href: "/stock/management", label: "Stock Management" },
                  { href: "/stock/movement", label: "Stock Movement" },
                  { href: "/stock/stock-history-levels", label: "Stock History / Levels" },
                  { href: "/stock/stock-take", label: "Stock Take" },
                  { href: "/stock/stock-take-report", label: "Stock Take Report" },
                  { href: "/stock/expiration-report", label: "Expiration Report" },
                ].filter(item => {
                  const permMap = {
                    "/stock/management": "stock.management",
                    "/stock/movement": "stock.movement",
                    "/stock/stock-history-levels": "stock.management",
                    "/stock/stock-take": "stock.stock-take",
                    "/stock/stock-take-report": "stock.stock-take-report",
                    "/stock/expiration-report": "stock.expiration-report",
                  };
                  return canAccess(permMap[item.href] || "stock");
                }))}
              </ul>
            </li>
            )}

            {canAccessAny(["reporting", "reporting.sales-report", "reporting.eod", "reporting.transaction-report", "reporting.transactions", "reporting.time-intervals", "reporting.time-comparisons", "reporting.sales-by-product", "reporting.employees", "reporting.locations", "reporting.categories"]) && (
            <li
              className={`${
                pathname.startsWith("/reporting") ? activeLink : baseLink
              } relative`}
            >
              <div
                className="flex flex-col items-center justify-center cursor-pointer"
                onClick={() => toggleMenu("reporting")}
              >
                <FontAwesomeIcon icon={faChartLine} className="w-6 h-6" />
                <span className="text-xs">Reporting</span>
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`w-3 h-3 mt-1 transition-transform duration-300 ${
                    openMenu === "reporting" ? "rotate-90" : ""
                  }`}
                />
              </div>
              <ul
                className={`fixed top-12 md:top-16 left-20 w-56 h-[calc(100vh-3rem)] md:h-[calc(100vh-4rem)] bg-white border-r border-gray-200 overflow-y-auto shadow-2xl transition-all duration-300 ease-in-out z-40 ${
                  openMenu === "reporting"
                    ? "translate-x-0 opacity-100 visible"
                    : "translate-x-4 opacity-0 invisible"
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b border-gray-200 sticky top-0 bg-white">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Reporting</p>
                </div>
                {renderSubMenu([
                  { href: "/reporting/reporting", label: "Sales Report" },
                  { href: "/reporting/end-of-day-report", label: "End of Day Reports" },
                ].filter(item => {
                  const permMap = {
                    "/reporting/reporting": "reporting.sales-report",
                    "/reporting/end-of-day-report": "reporting.eod",
                  };
                  return canAccess(permMap[item.href] || "reporting");
                }))}
                
                {/* Sales Report Dropdown */}
                {canAccessAny(["reporting.time-intervals", "reporting.time-comparisons", "reporting.sales-by-product", "reporting.employees", "reporting.locations", "reporting.categories"]) && (
                <li className="border-b border-gray-100 transition-all duration-300 group">
                  <button
                    onClick={() => toggleSubMenu("sales-report")}
                    className="w-full h-14 px-4 py-3 flex items-center justify-between text-sm font-medium transition-all duration-300 text-gray-700 hover:bg-gray-50 hover:text-blue-600 border-l-4 border-transparent"
                  >
                    <span className="flex items-center gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-300 group-hover:bg-blue-400 transition-all"></span>
                      Sales Report
                    </span>
                    <span className={`text-lg transition-transform duration-300 ${openSubMenu === "sales-report" ? "rotate-90" : ""}`}>›</span>
                  </button>
                  {openSubMenu === "sales-report" && (
                    <div className="bg-gray-50 border-t border-gray-100">
                      {renderSubMenu([
                        { href: "/reporting/sales-report/time-intervals", label: "Time Intervals", indent: true },
                        { href: "/reporting/sales-report/time-comparisons", label: "Time Comparisons", indent: true },
                        { href: "/reporting/sales-report/products", label: "Sales by Product", indent: true },
                        { href: "/reporting/sales-report/employees", label: "Employees", indent: true },
                        { href: "/reporting/sales-report/locations", label: "Locations", indent: true },
                        { href: "/reporting/sales-report/categories", label: "Categories", indent: true },
                      ].filter(item => {
                        const permMap = {
                          "/reporting/sales-report/time-intervals": "reporting.time-intervals",
                          "/reporting/sales-report/time-comparisons": "reporting.time-comparisons",
                          "/reporting/sales-report/products": "reporting.sales-by-product",
                          "/reporting/sales-report/employees": "reporting.employees",
                          "/reporting/sales-report/locations": "reporting.locations",
                          "/reporting/sales-report/categories": "reporting.categories",
                        };
                        return canAccess(permMap[item.href] || "reporting");
                      }))}
                    </div>
                  )}
                </li>
                )}

                {/* Transaction Report */}
                {renderSubMenu([
                  { href: "/reporting/transaction-report/completed-transactions", label: "Completed Transactions", indent: true },
                ].filter(() => canAccessTransactionReport))}
              </ul>
            </li>
            )}

            {canAccessAny(["expenses", "expenses.entry", "expenses.analysis", "expenses.tax-analysis", "expenses.tax-personal"]) && (
            <li
              className={`${
                pathname.startsWith("/expenses") ? activeLink : baseLink
              } relative`}
            >
              <div
                className="flex flex-col items-center justify-center cursor-pointer"
                onClick={() => toggleMenu("expenses")}
              >
                <FontAwesomeIcon icon={faCoins} className="w-6 h-6" />
                <span className="text-xs">Expenses</span>
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`w-3 h-3 mt-1 transition-transform duration-300 ${
                    openMenu === "expenses" ? "rotate-90" : ""
                  }`}
                />
              </div>
              <ul
                className={`fixed top-12 md:top-16 left-20 w-56 h-[calc(100vh-3rem)] md:h-[calc(100vh-4rem)] bg-white border-r border-gray-200 overflow-y-auto shadow-2xl transition-all duration-300 ease-in-out z-40 ${
                  openMenu === "expenses"
                    ? "translate-x-0 opacity-100 visible"
                    : "translate-x-4 opacity-0 invisible"
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b border-gray-200 sticky top-0 bg-white">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Expenses</p>
                </div>
                {renderSubMenu([
                  { href: "/expenses/expenses", label: "Expenses Entry" },
                  { href: "/expenses/analysis", label: "Expenses Analysis" },
                  { href: "/expenses/categories", label: "Categories" },
                  { href: "/expenses/petty-cash", label: "Petty Cash" },
                  { href: "/expenses/tax-analysis", label: "Tax Analysis" },
                  {
                    href: "/expenses/tax-personal",
                    label: "Personal Tax Calculator",
                  },
                ].filter(item => {
                  const permMap = {
                    "/expenses/expenses": "expenses.entry",
                    "/expenses/analysis": "expenses.analysis",
                    "/expenses/categories": "expenses.entry",
                    "/expenses/petty-cash": "expenses.entry",
                    "/expenses/tax-analysis": "expenses.tax-analysis",
                    "/expenses/tax-personal": "expenses.tax-personal",
                  };
                  return canAccess(permMap[item.href] || "expenses");
                }))}
              </ul>
            </li>
            )}
            {canAccessAny(["accounting", "accounting.chart-of-accounts", "accounting.journal-entries", "accounting.general-ledger", "accounting.trial-balance", "accounting.profit-loss", "accounting.balance-sheet"]) && (
            <li
              className={`${
                pathname.startsWith("/accounting") ? activeLink : baseLink
              } relative`}
            >
              <div
                className="flex flex-col items-center justify-center cursor-pointer"
                onClick={() => toggleMenu("accounting")}
              >
                <FontAwesomeIcon icon={faBook} className="w-6 h-6" />
                <span className="text-xs">Accounting</span>
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`w-3 h-3 mt-1 transition-transform duration-300 ${
                    openMenu === "accounting" ? "rotate-90" : ""
                  }`}
                />
              </div>
              <ul
                className={`fixed top-12 md:top-16 left-20 w-56 h-[calc(100vh-3rem)] md:h-[calc(100vh-4rem)] bg-white border-r border-gray-200 overflow-y-auto shadow-2xl transition-all duration-300 ease-in-out z-40 ${
                  openMenu === "accounting"
                    ? "translate-x-0 opacity-100 visible"
                    : "translate-x-4 opacity-0 invisible"
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-4 py-3 border-b border-gray-200 sticky top-0 bg-white">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Accounting</p>
                </div>
                {renderSubMenu([
                  { href: "/accounting/chart-of-accounts", label: "Chart of Accounts" },
                  { href: "/accounting/journal-entries", label: "Journal Entries" },
                  { href: "/accounting/general-ledger", label: "General Ledger" },
                  { href: "/accounting/reports", label: "Financial Reports" },
                ].filter(item => {
                  const permMap = {
                    "/accounting/chart-of-accounts": "accounting.chart-of-accounts",
                    "/accounting/journal-entries": "accounting.journal-entries",
                    "/accounting/general-ledger": "accounting.general-ledger",
                    "/accounting/reports": "accounting.trial-balance",
                  };
                  return canAccess(permMap[item.href] || "accounting");
                }))}
              </ul>
            </li>
            )}
            {canAccess("till") && (
            <li key="/till" className={baseLink}>
              <a href="https://sales-point-app.vercel.app" target="_blank" rel="noopener noreferrer">
                <div className="flex flex-col items-center justify-center">
                  <FontAwesomeIcon icon={faCashRegister} className="w-6 h-6" />
                  <span className="text-xs">Till</span>
                </div>
              </a>
            </li>
            )}
            {canAccess("support") && renderMenuItem("/support", faHeadset, "Support")}
            {canAccess("support") && renderMenuItem("/support/ai-business-assistant", faRobot, "AI Assistant")}
          </ul>
        </nav>
      </aside>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50">
          <Loader size="lg" fullScreen={false} text="Please wait..." />
        </div>
      )}

      {/* MOBILE SIDEBAR - FULL SCREEN */}
      {isMobileMenuOpen && isMobile && (
        <nav className="fixed top-0 left-0 right-0 bottom-0 w-full bg-white shadow-2xl z-40 overflow-y-auto">
          {/* Mobile Header */}
          <div className="sticky top-0 text-white px-4 py-4 flex items-center justify-between" style={{ background: `linear-gradient(to right, var(--sidebar-active-from, #2563eb), var(--sidebar-active-to, #1d4ed8))` }}>
            <span className="text-lg font-bold">Menu</span>
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-white text-2xl transition-all"
              aria-label="Close menu"
            >
              <FontAwesomeIcon icon={faTimes} />
            </button>
          </div>

          <ul className="space-y-0 pb-20">
            {/* Home */}
            {canAccess("dashboard") && (
            <li onClick={closeMenu}>
              <Link href="/" className={`block ${pathname === "/" ? mobileActiveLink : mobileBaseLink}`}>
                <FontAwesomeIcon icon={faHome} className="w-5 h-5" />
                <span>Home</span>
              </Link>
            </li>
            )}

            {/* Setup Menu */}
            {canAccessAny(["setup", "setup.company", "setup.hero-promo", "setup.receipts", "setup.pos-tenders", "setup.location-items", "setup.assets", "setup.users", "setup.color-theme"]) && (
            <li>
              <button
                onClick={() => toggleMenu("setup")}
                className={`w-full ${pathname.startsWith("/setup") ? mobileActiveLink : mobileBaseLink} justify-between`}
              >
                <div className="flex items-center gap-3">
                  <FontAwesomeIcon icon={faCog} className="w-5 h-5" />
                  <span>Setup</span>
                </div>
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`w-4 h-4 transition-transform duration-300 ${openMenu === "setup" ? "rotate-90" : ""}`}
                />
              </button>
              {openMenu === "setup" && (
                <ul className="bg-gray-50 border-l-4 border-blue-600">
                  {canAccess("setup.company") && (
                  <li onClick={closeMenu}>
                    <Link href="/setup/setup" className={`block px-8 py-3 text-sm transition-all ${pathname === "/setup/setup" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Company Details
                    </Link>
                  </li>
                  )}
                  {canAccess("setup.hero-promo") && (
                  <li onClick={closeMenu}>
                    <Link href="/setup/Hero-Promo-setup" className={`block px-8 py-3 text-sm transition-all ${pathname === "/setup/Hero-Promo-setup" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Hero-Promo Setup
                    </Link>
                  </li>
                  )}
                  {canAccess("setup.receipts") && (
                  <li onClick={closeMenu}>
                    <Link href="/setup/receipts" className={`block px-8 py-3 text-sm transition-all ${pathname === "/setup/receipts" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Receipts
                    </Link>
                  </li>
                  )}
                  {canAccess("setup.pos-tenders") && (
                  <li onClick={closeMenu}>
                    <Link href="/setup/pos-tenders" className={`block px-8 py-3 text-sm transition-all ${pathname === "/setup/pos-tenders" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      POS Tenders
                    </Link>
                  </li>
                  )}
                  {canAccess("setup.location-items") && (
                  <li onClick={closeMenu}>
                    <Link href="/setup/location-items" className={`block px-8 py-3 text-sm transition-all ${pathname === "/setup/location-items" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Location Tenders
                    </Link>
                  </li>
                  )}
                  {canAccess("setup.assets") && (
                  <li onClick={closeMenu}>
                    <Link href="/setup/assets" className={`block px-8 py-3 text-sm transition-all ${pathname === "/setup/assets" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Assets
                    </Link>
                  </li>
                  )}
                  {canAccess("setup.users") && (
                  <li onClick={closeMenu}>
                    <Link href="/setup/users" className={`block px-8 py-3 text-sm transition-all ${pathname === "/setup/users" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Users
                    </Link>
                  </li>
                  )}
                  {canAccess("setup.color-theme") && (
                  <li onClick={closeMenu}>
                    <Link href="/setup/color-theme" className={`block px-8 py-3 text-sm transition-all ${pathname === "/setup/color-theme" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Color Theme
                    </Link>
                  </li>
                  )}
                </ul>
              )}
            </li>
            )}

            {/* Manage Menu */}
            {canAccessAny(["manage", "manage.products", "manage.archived", "manage.categories", "manage.promotions", "manage.customer-promotions", "manage.orders", "manage.customers", "manage.campaigns", "manage.staff", "manage.staff-roles", "manage.vendors", "manage.purchase-orders"]) && (
            <li>
              <button
                onClick={() => toggleMenu("manage")}
                className={`w-full ${(pathname.startsWith("/manage") || pathname.startsWith("/products")) ? mobileActiveLink : mobileBaseLink} justify-between`}
              >
                <div className="flex items-center gap-3">
                  <FontAwesomeIcon icon={faList} className="w-5 h-5" />
                  <span>Manage</span>
                </div>
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`w-4 h-4 transition-transform duration-300 ${openMenu === "manage" ? "rotate-90" : ""}`}
                />
              </button>
              {openMenu === "manage" && (
                <ul className="bg-gray-50 border-l-4 border-blue-600">
                  {canAccess("manage.products") && (
                  <li onClick={closeMenu}>
                    <Link href="/manage/products" className={`block px-8 py-3 text-sm transition-all ${(pathname === "/manage/products" || pathname.startsWith("/products")) ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Product List
                    </Link>
                  </li>
                  )}
                  {canAccess("manage.archived") && (
                  <li onClick={closeMenu}>
                    <Link href="/manage/archived" className={`block px-8 py-3 text-sm transition-all ${pathname === "/manage/archived" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Archived Products
                    </Link>
                  </li>
                  )}
                  {canAccess("manage.products") && (
                  <li onClick={closeMenu}>
                    <Link href="/products/price-tags" className={`block px-8 py-3 text-sm transition-all ${pathname === "/products/price-tags" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Price Tags
                    </Link>
                  </li>
                  )}
                  {canAccess("manage.categories") && (
                  <li onClick={closeMenu}>
                    <Link href="/manage/categories" className={`block px-8 py-3 text-sm transition-all ${pathname === "/manage/categories" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Categories
                    </Link>
                  </li>
                  )}
                  {canAccess("manage.promotions") && (
                  <li onClick={closeMenu}>
                    <Link href="/manage/promotions" className={`block px-8 py-3 text-sm transition-all ${pathname === "/manage/promotions" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Promotions
                    </Link>
                  </li>
                  )}
                  {canAccess("manage.customer-promotions") && (
                  <li onClick={closeMenu}>
                    <Link href="/manage/promotions-management" className={`block px-8 py-3 text-sm transition-all ${pathname === "/manage/promotions-management" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Campaign Promotions 
                    </Link>
                  </li>
                  )}
                  {canAccess("manage.orders") && (
                  <li onClick={closeMenu}>
                    <Link href="/manage/orders" className={`block px-8 py-3 text-sm transition-all ${pathname === "/manage/orders" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Orders
                    </Link>
                  </li>
                  )}
                  {canAccessAny(["manage.staff", "manage.staff-roles"]) && (
                  <li>
                    <button
                      onClick={() => toggleSubMenu("mobile-staff-menu")}
                      className={`w-full flex items-center justify-between px-8 py-3 text-sm transition-all ${pathname.startsWith("/manage/staff") ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}
                    >
                      <span>Staff</span>
                      <FontAwesomeIcon
                        icon={faChevronRight}
                        className={`w-4 h-4 transition-transform duration-300 ${openSubMenu === "mobile-staff-menu" ? "rotate-90" : ""}`}
                      />
                    </button>
                    {openSubMenu === "mobile-staff-menu" && (
                      <ul className="bg-white/70">
                        {canAccess("manage.staff") && (
                        <li onClick={closeMenu}>
                          <Link href="/manage/staff" className={`block px-12 py-3 text-sm transition-all ${pathname === "/manage/staff" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                            Staff Page
                          </Link>
                        </li>
                        )}
                        {canAccess("manage.staff-roles") && (
                        <li onClick={closeMenu}>
                          <Link href="/manage/staff-roles" className={`block px-12 py-3 text-sm transition-all ${pathname === "/manage/staff-roles" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                            Staff Roles
                          </Link>
                        </li>
                        )}
                      </ul>
                    )}
                  </li>
                  )}
                  {canAccess("manage.customers") && (
                  <li onClick={closeMenu}>
                    <Link href="/manage/customers" className={`block px-8 py-3 text-sm transition-all ${pathname === "/manage/customers" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Customers
                    </Link>
                  </li>
                  )}

                  {canAccessAny(["manage.vendors", "manage.purchase-orders"]) && (
                  <li>
                    <button
                      onClick={() => toggleSubMenu("mobile-procurement-menu")}
                      className={`w-full flex items-center justify-between px-8 py-3 text-sm transition-all ${pathname.startsWith("/manage/vendors") || pathname.startsWith("/manage/purchase-orders") ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}
                    >
                      <span>Procurement</span>
                      <FontAwesomeIcon
                        icon={faChevronRight}
                        className={`w-4 h-4 transition-transform duration-300 ${openSubMenu === "mobile-procurement-menu" ? "rotate-90" : ""}`}
                      />
                    </button>
                    {openSubMenu === "mobile-procurement-menu" && (
                      <ul className="bg-white/70">
                        {canAccess("manage.vendors") && (
                        <li onClick={closeMenu}>
                          <Link href="/manage/vendors" className={`block px-12 py-3 text-sm transition-all ${pathname === "/manage/vendors" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                            Vendors
                          </Link>
                        </li>
                        )}
                        {canAccess("manage.purchase-orders") && (
                        <li onClick={closeMenu}>
                          <Link href="/manage/purchase-orders" className={`block px-12 py-3 text-sm transition-all ${pathname === "/manage/purchase-orders" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                            Payment Tracker
                          </Link>
                        </li>
                        )}
                      </ul>
                    )}
                  </li>
                  )}
                </ul>
              )}
            </li>
            )}

            {/* Stock Menu */}
            {canAccessAny(["stock", "stock.management", "stock.movement", "stock.stock-take", "stock.stock-take-report", "stock.expiration-report"]) && (
            <li>
              <button
                onClick={() => toggleMenu("stock")}
                className={`w-full ${pathname.startsWith("/stock") ? mobileActiveLink : mobileBaseLink} justify-between`}
              >
                <div className="flex items-center gap-3">
                  <FontAwesomeIcon icon={faBoxes} className="w-5 h-5" />
                  <span>Stock</span>
                </div>
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`w-4 h-4 transition-transform duration-300 ${openMenu === "stock" ? "rotate-90" : ""}`}
                />
              </button>
              {openMenu === "stock" && (
                <ul className="bg-gray-50 border-l-4 border-blue-600">
                  {canAccess("stock.management") && (
                  <li onClick={closeMenu}>
                    <Link href="/stock/management" className={`block px-8 py-3 text-sm transition-all ${pathname === "/stock/management" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Stock Management
                    </Link>
                  </li>
                  )}
                  {canAccess("stock.movement") && (
                  <li onClick={closeMenu}>
                    <Link href="/stock/movement" className={`block px-8 py-3 text-sm transition-all ${pathname === "/stock/movement" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Stock Movement
                    </Link>
                  </li>
                  )}
                  {canAccess("stock.management") && (
                  <li onClick={closeMenu}>
                    <Link href="/stock/stock-history-levels" className={`block px-8 py-3 text-sm transition-all ${pathname === "/stock/stock-history-levels" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Stock History / Levels
                    </Link>
                  </li>
                  )}
                  {canAccess("stock.stock-take") && (
                  <li onClick={closeMenu}>
                    <Link href="/stock/stock-take" className={`block px-8 py-3 text-sm transition-all ${pathname.startsWith("/stock/stock-take") && !pathname.startsWith("/stock/stock-take-report") ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Stock Take
                    </Link>
                  </li>
                  )}
                  {canAccess("stock.stock-take-report") && (
                  <li onClick={closeMenu}>
                    <Link href="/stock/stock-take-report" className={`block px-8 py-3 text-sm transition-all ${pathname === "/stock/stock-take-report" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Stock Take Report
                    </Link>
                  </li>
                  )}
                  {canAccess("stock.expiration-report") && (
                  <li onClick={closeMenu}>
                    <Link href="/stock/expiration-report" className={`block px-8 py-3 text-sm transition-all ${pathname === "/stock/expiration-report" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Expiration Report
                    </Link>
                  </li>
                  )}
                </ul>
              )}
            </li>
            )}

            {/* Reporting Menu */}
            {canAccessAny(["reporting", "reporting.sales-report", "reporting.eod", "reporting.transaction-report", "reporting.transactions", "reporting.time-intervals", "reporting.time-comparisons", "reporting.sales-by-product", "reporting.employees", "reporting.locations", "reporting.categories"]) && (
            <li>
              <button
                onClick={() => toggleMenu("reporting")}
                className={`w-full ${pathname.startsWith("/reporting") ? mobileActiveLink : mobileBaseLink} justify-between`}
              >
                <div className="flex items-center gap-3">
                  <FontAwesomeIcon icon={faChartLine} className="w-5 h-5" />
                  <span>Reporting</span>
                </div>
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`w-4 h-4 transition-transform duration-300 ${openMenu === "reporting" ? "rotate-90" : ""}`}
                />
              </button>
              {openMenu === "reporting" && (
                <ul className="bg-gray-50 border-l-4 border-blue-600">
                  {canAccess("reporting.sales-report") && (
                  <li onClick={closeMenu}>
                    <Link href="/reporting/reporting" className={`block px-8 py-3 text-sm transition-all ${pathname === "/reporting/reporting" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Sales Report
                    </Link>
                  </li>
                  )}
                  {canAccess("reporting.eod") && (
                  <li onClick={closeMenu}>
                    <Link href="/reporting/end-of-day-report" className={`block px-8 py-3 text-sm transition-all ${pathname === "/reporting/end-of-day-report" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      End of Day Reports
                    </Link>
                  </li>
                  )}
                  {canAccessTransactionReport && (
                  <li onClick={closeMenu}>
                    <Link href="/reporting/transaction-report" className={`block px-8 py-3 text-sm transition-all ${pathname === "/reporting/transaction-report" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Transaction Reports
                    </Link>
                  </li>
                  )}
                  {canAccessTransactionReport && (
                  <li onClick={closeMenu}>
                    <Link href="/reporting/transaction-report/completed-transactions" className={`block px-10 py-3 text-sm transition-all ${pathname === "/reporting/transaction-report/completed-transactions" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Completed Transactions
                    </Link>
                  </li>
                  )}
                  {canAccess("reporting.time-intervals") && (
                  <li onClick={closeMenu}>
                    <Link href="/reporting/sales-report/time-intervals" className={`block px-10 py-3 text-sm transition-all ${pathname === "/reporting/sales-report/time-intervals" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Time Intervals
                    </Link>
                  </li>
                  )}
                  {canAccess("reporting.time-comparisons") && (
                  <li onClick={closeMenu}>
                    <Link href="/reporting/sales-report/time-comparisons" className={`block px-10 py-3 text-sm transition-all ${pathname === "/reporting/sales-report/time-comparisons" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Time Comparisons
                    </Link>
                  </li>
                  )}
                  {canAccess("reporting.sales-by-product") && (
                  <li onClick={closeMenu}>
                    <Link href="/reporting/sales-report/products" className={`block px-10 py-3 text-sm transition-all ${pathname === "/reporting/sales-report/products" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Sales by Product
                    </Link>
                  </li>
                  )}
                  {canAccess("reporting.employees") && (
                  <li onClick={closeMenu}>
                    <Link href="/reporting/sales-report/employees" className={`block px-10 py-3 text-sm transition-all ${pathname === "/reporting/sales-report/employees" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Employees
                    </Link>
                  </li>
                  )}
                  {canAccess("reporting.locations") && (
                  <li onClick={closeMenu}>
                    <Link href="/reporting/sales-report/locations" className={`block px-10 py-3 text-sm transition-all ${pathname === "/reporting/sales-report/locations" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Locations
                    </Link>
                  </li>
                  )}
                  {canAccess("reporting.categories") && (
                  <li onClick={closeMenu}>
                    <Link href="/reporting/sales-report/categories" className={`block px-10 py-3 text-sm transition-all ${pathname === "/reporting/sales-report/categories" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Categories
                    </Link>
                  </li>
                  )}
                </ul>
              )}
            </li>
            )}

            {/* Expenses Menu */}
            {canAccessAny(["expenses", "expenses.entry", "expenses.analysis", "expenses.tax-analysis", "expenses.tax-personal"]) && (
            <li>
              <button
                onClick={() => toggleMenu("expenses")}
                className={`w-full ${pathname.startsWith("/expenses") ? mobileActiveLink : mobileBaseLink} justify-between`}
              >
                <div className="flex items-center gap-3">
                  <FontAwesomeIcon icon={faCoins} className="w-5 h-5" />
                  <span>Expenses</span>
                </div>
                <FontAwesomeIcon
                  icon={faChevronRight}
                  className={`w-4 h-4 transition-transform duration-300 ${openMenu === "expenses" ? "rotate-90" : ""}`}
                />
              </button>
              {openMenu === "expenses" && (
                <ul className="bg-gray-50 border-l-4 border-blue-600">
                  {canAccess("expenses.entry") && (
                  <li onClick={closeMenu}>
                    <Link href="/expenses/expenses" className={`block px-8 py-3 text-sm transition-all ${pathname === "/expenses/expenses" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Expenses Entry
                    </Link>
                  </li>
                  )}
                  {canAccess("expenses.analysis") && (
                  <li onClick={closeMenu}>
                    <Link href="/expenses/analysis" className={`block px-8 py-3 text-sm transition-all ${pathname === "/expenses/analysis" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Expenses Analysis
                    </Link>
                  </li>
                  )}
                  {canAccess("expenses.entry") && (
                  <li onClick={closeMenu}>
                    <Link href="/expenses/petty-cash" className={`block px-8 py-3 text-sm transition-all ${pathname === "/expenses/petty-cash" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Petty Cash
                    </Link>
                  </li>
                  )}
                  {canAccess("expenses.tax-analysis") && (
                  <li onClick={closeMenu}>
                    <Link href="/expenses/tax-analysis" className={`block px-8 py-3 text-sm transition-all ${pathname === "/expenses/tax-analysis" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Tax Analysis
                    </Link>
                  </li>
                  )}
                  {canAccess("expenses.tax-personal") && (
                  <li onClick={closeMenu}>
                    <Link href="/expenses/tax-personal" className={`block px-8 py-3 text-sm transition-all ${pathname === "/expenses/tax-personal" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Personal Tax Calculator
                    </Link>
                  </li>
                  )}
                </ul>
              )}
            </li>
            )}

            {/* Accounting */}
            {canAccessAny(["accounting", "accounting.chart-of-accounts", "accounting.journal-entries", "accounting.general-ledger", "accounting.trial-balance", "accounting.profit-loss", "accounting.balance-sheet"]) && (
            <li>
              <button
                onClick={() => toggleMenu("accounting")}
                className={`w-full ${pathname.startsWith("/accounting") ? mobileActiveLink : mobileBaseLink}`}
              >
                <FontAwesomeIcon icon={faBook} className="w-5 h-5" />
                <span>Accounting</span>
                <FontAwesomeIcon icon={faChevronRight} className={`w-4 h-4 ml-auto transition-transform ${openMenu === "accounting" ? "rotate-90" : ""}`} />
              </button>
              {openMenu === "accounting" && (
                <ul className="bg-gray-50 border-l-4 border-blue-600">
                  {canAccess("accounting.chart-of-accounts") && (
                  <li onClick={closeMenu}>
                    <Link href="/accounting/chart-of-accounts" className={`block px-8 py-3 text-sm transition-all ${pathname === "/accounting/chart-of-accounts" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Chart of Accounts
                    </Link>
                  </li>
                  )}
                  {canAccess("accounting.journal-entries") && (
                  <li onClick={closeMenu}>
                    <Link href="/accounting/journal-entries" className={`block px-8 py-3 text-sm transition-all ${pathname === "/accounting/journal-entries" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Journal Entries
                    </Link>
                  </li>
                  )}
                  {canAccess("accounting.general-ledger") && (
                  <li onClick={closeMenu}>
                    <Link href="/accounting/general-ledger" className={`block px-8 py-3 text-sm transition-all ${pathname === "/accounting/general-ledger" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      General Ledger
                    </Link>
                  </li>
                  )}
                  {canAccess("accounting.trial-balance") && (
                  <li onClick={closeMenu}>
                    <Link href="/accounting/reports" className={`block px-8 py-3 text-sm transition-all ${pathname === "/accounting/reports" ? "bg-blue-50 text-blue-700 font-semibold border-l-4 border-blue-600" : "text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-l-4 border-transparent"}`}>
                      Financial Reports
                    </Link>
                  </li>
                  )}
                </ul>
              )}
            </li>
            )}

            {/* Till */}
            {canAccess("till") && (
            <li onClick={closeMenu}>
              <a href="https://sales-point-app.vercel.app" target="_blank" rel="noopener noreferrer" className={`block ${mobileBaseLink}`}>
                <FontAwesomeIcon icon={faCashRegister} className="w-5 h-5" />
                <span>Till</span>
              </a>
            </li>
            )}

            {/* Support */}
            {canAccess("support") && (
            <li onClick={closeMenu}>
              <Link href="/support" className={`block ${pathname === "/support" ? mobileActiveLink : mobileBaseLink}`}>
                <FontAwesomeIcon icon={faHeadset} className="w-5 h-5" />
                <span>Support</span>
              </Link>
            </li>
            )}
          </ul>
        </nav>
      )}
    </>
  );
}
