import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight, faBars, faTimes } from "@fortawesome/free-solid-svg-icons";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Loader from "@/components/Loader";
import { useAuth } from "@/lib/useAuth";
import {
  MENU,
  sectionPermissions,
  isSectionActive,
  isItemActive,
} from "@/lib/navigation";

export default function Sidebar() {
  const [openMenu, setOpenMenu] = useState(null);
  const [openGroup, setOpenGroup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const sidebarRef = useRef(null);
  const router = useRouter();
  const { pathname } = router;
  const { isAdmin, hasPermission } = useAuth();

  /* ─── Permissions ─────────────────────────────────────────── */

  const canAccess = useCallback(
    (permission) => {
      if (isAdmin) return true;
      if (!permission) return true;
      if (Array.isArray(permission)) return permission.some((key) => hasPermission(key));
      return hasPermission(permission);
    },
    [isAdmin, hasPermission]
  );

  const canAccessSection = useCallback(
    (section) => {
      if (isAdmin) return true;
      return sectionPermissions(section).some((key) => hasPermission(key));
    },
    [isAdmin, hasPermission]
  );

  /* ─── Responsive state ────────────────────────────────────── */

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) setIsMobileMenuOpen(false);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Close the flyout when clicking away (desktop only)
  useEffect(() => {
    if (!openMenu || isMobile) return undefined;
    const handleClickOutside = (event) => {
      if (sidebarRef.current && !sidebarRef.current.contains(event.target)) setOpenMenu(null);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openMenu, isMobile]);

  // Open the section that matches the current route
  useEffect(() => {
    if (isMobile) return;
    const section = MENU.find((s) => s.items && isSectionActive(s, pathname));
    if (!section) return;
    setOpenMenu(section.key);
    const group = (section.groups || []).find((g) =>
      (g.match || []).some((prefix) => pathname.startsWith(prefix))
    );
    setOpenGroup(group ? group.key : null);
  }, [pathname, isMobile]);

  const closeMenu = useCallback(() => {
    setOpenMenu(null);
    if (isMobile) setIsMobileMenuOpen(false);
  }, [isMobile]);

  const closeMenuOnNavigation = useCallback(() => {
    setOpenMenu(null);
    setOpenGroup(null);
    if (isMobile) setIsMobileMenuOpen(false);
  }, [isMobile]);

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
  }, [router, closeMenuOnNavigation]);

  const toggleMenu = (key) => setOpenMenu((prev) => (prev === key ? null : key));
  const toggleGroup = (key) => setOpenGroup((prev) => (prev === key ? null : key));

  /* ─── Shared styles ───────────────────────────────────────── */

  const railBase =
    "px-2 py-4 text-gray-600 transition-all duration-200 flex items-center justify-center flex-col text-xs cursor-pointer border-l-4 border-transparent hidden md:flex nav-rail-item";
  const railActive =
    "px-2 py-4 nav-active-gradient flex items-center justify-center flex-col text-xs cursor-pointer font-semibold border-l-4 transition-all duration-200 hidden md:flex shadow-md";

  const mobileBase =
    "px-4 py-3 text-gray-700 transition-all duration-200 border-l-4 border-transparent flex items-center gap-3 text-sm nav-rail-item";
  const mobileActive =
    "px-4 py-3 border-l-4 nav-active-gradient flex items-center gap-3 text-sm font-semibold";

  /* ─── Renderers ───────────────────────────────────────────── */

  const visibleItems = (section, group = null) =>
    (section.items || []).filter(
      (item) => (item.group || null) === group && canAccess(item.permission)
    );

  const renderSubItem = (item, { indent = false } = {}) => {
    const active = isItemActive(item.href, pathname);
    return (
      <li key={item.href} className="nav-sub-row" onClick={closeMenuOnNavigation}>
        <Link href={item.href} className={`nav-sub-link ${indent ? "is-indent" : ""} ${active ? "is-active" : ""}`}>
          <span className="flex items-center gap-3 min-w-0">
            {!indent && <span className="nav-dot" />}
            <span className="truncate">{item.label}</span>
          </span>
          {active && <span className="nav-chevron">›</span>}
        </Link>
      </li>
    );
  };

  const renderGroup = (section, group, { mobile = false } = {}) => {
    const items = visibleItems(section, group.key);
    if (items.length === 0) return null;
    const open = openGroup === group.key;
    return (
      <li key={group.key} className="nav-sub-row">
        <button
          type="button"
          onClick={() => toggleGroup(group.key)}
          className={`nav-sub-link nav-group-toggle ${open ? "is-open" : ""}`}
          aria-expanded={open}
        >
          <span className="flex items-center gap-3">
            <span className="nav-dot" />
            {group.label}
          </span>
          <span className={`nav-chevron ${open ? "rotate-90" : ""}`}>›</span>
        </button>
        {open && (
          <ul className="nav-group-body">{items.map((item) => renderSubItem(item, { indent: true }))}</ul>
        )}
      </li>
    );
  };

  const renderSubmenu = (section, { mobile = false } = {}) => {
    const rootItems = visibleItems(section, null);
    const groups = (section.groups || []).map((g) => renderGroup(section, g, { mobile })).filter(Boolean);
    return (
      <>
        {rootItems.map((item) => renderSubItem(item))}
        {groups}
      </>
    );
  };

  /* ─── Desktop rail ────────────────────────────────────────── */

  const renderRailSection = (section) => {
    if (!canAccessSection(section)) return null;
    const active = isSectionActive(section, pathname);

    if (section.href) {
      const inner = (
        <div className="flex flex-col items-center justify-center">
          <FontAwesomeIcon icon={section.icon} className="w-6 h-6" />
          <span className="text-xs mt-1">{section.label}</span>
        </div>
      );
      return (
        <li key={section.key} className={active ? railActive : railBase}>
          {section.external ? (
            <a href={section.href} target="_blank" rel="noopener noreferrer" title={`${section.label} (opens in a new tab)`}>
              {inner}
            </a>
          ) : (
            <Link href={section.href} onClick={closeMenu}>
              {inner}
            </Link>
          )}
        </li>
      );
    }

    if (visibleItems(section, null).length === 0 && (section.groups || []).every((g) => visibleItems(section, g.key).length === 0)) {
      return null;
    }

    const open = openMenu === section.key;
    return (
      <li key={section.key} className={`${active ? railActive : railBase} relative`}>
        <div
          className="flex flex-col items-center justify-center cursor-pointer"
          onClick={() => toggleMenu(section.key)}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleMenu(section.key);
            }
          }}
        >
          <FontAwesomeIcon icon={section.icon} className="w-6 h-6" />
          <span className="text-xs mt-1">{section.label}</span>
          <FontAwesomeIcon
            icon={faChevronRight}
            className={`w-3 h-3 mt-1 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          />
        </div>
        <ul
          className={`nav-flyout ${open ? "is-open" : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="nav-flyout-header">
            <p>{section.label}</p>
          </div>
          {renderSubmenu(section)}
        </ul>
      </li>
    );
  };

  /* ─── Mobile drawer ───────────────────────────────────────── */

  const renderMobileSection = (section) => {
    if (!canAccessSection(section)) return null;
    const active = isSectionActive(section, pathname);

    if (section.href) {
      const inner = (
        <>
          <FontAwesomeIcon icon={section.icon} className="w-5 h-5" />
          <span>{section.label}</span>
        </>
      );
      return (
        <li key={section.key} onClick={closeMenu}>
          {section.external ? (
            <a href={section.href} target="_blank" rel="noopener noreferrer" className={`block ${mobileBase}`}>
              {inner}
            </a>
          ) : (
            <Link href={section.href} className={`block ${active ? mobileActive : mobileBase}`}>
              {inner}
            </Link>
          )}
        </li>
      );
    }

    if (visibleItems(section, null).length === 0 && (section.groups || []).every((g) => visibleItems(section, g.key).length === 0)) {
      return null;
    }

    const open = openMenu === section.key;
    return (
      <li key={section.key}>
        <button
          type="button"
          onClick={() => toggleMenu(section.key)}
          className={`w-full ${active ? mobileActive : mobileBase} justify-between`}
          aria-expanded={open}
        >
          <span className="flex items-center gap-3">
            <FontAwesomeIcon icon={section.icon} className="w-5 h-5" />
            <span>{section.label}</span>
          </span>
          <FontAwesomeIcon
            icon={faChevronRight}
            className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          />
        </button>
        {open && <ul className="nav-mobile-submenu">{renderSubmenu(section, { mobile: true })}</ul>}
      </li>
    );
  };

  return (
    <>
      {/* Floating menu button (mobile) */}
      {isMobile && !isMobileMenuOpen && (
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="md:hidden fixed bottom-6 right-6 w-16 h-16 rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-all hover:scale-110 z-40"
          style={{
            background: "var(--sidebar-active-bg, #2563eb)",
            color: "var(--sidebar-active-ink, #ffffff)",
          }}
          aria-label="Open menu"
        >
          <span className="flex flex-col items-center justify-center gap-1">
            <FontAwesomeIcon icon={faBars} className="w-5 h-5" />
            <span className="text-xs font-semibold">Menu</span>
          </span>
        </button>
      )}

      {isMobileMenuOpen && isMobile && (
        <div
          className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Desktop rail */}
      <aside ref={sidebarRef} className="nav-rail hidden md:block">
        <nav className="mt-6 h-full overflow-visible">
          <ul className="space-y-1">{MENU.map(renderRailSection)}</ul>
        </nav>
      </aside>

      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50">
          <Loader size="lg" fullScreen={false} text="Please wait..." />
        </div>
      )}

      {/* Mobile drawer */}
      {isMobileMenuOpen && isMobile && (
        <nav className="fixed inset-0 w-full shadow-2xl z-40 overflow-y-auto" style={{ background: "var(--surface-card, #fff)" }}>
          <div
            className="sticky top-0 px-4 py-4 flex items-center justify-between z-10"
            style={{
              background: "var(--sidebar-active-bg, #2563eb)",
              color: "var(--sidebar-active-ink, #ffffff)",
            }}
          >
            <span className="text-lg font-bold">Menu</span>
            <button onClick={() => setIsMobileMenuOpen(false)} className="text-2xl transition-all" aria-label="Close menu">
              <FontAwesomeIcon icon={faTimes} />
            </button>
          </div>
          <ul className="pb-24">{MENU.map(renderMobileSection)}</ul>
        </nav>
      )}
    </>
  );
}
