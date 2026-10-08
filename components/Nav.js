import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight, faBars, faTimes, faRightFromBracket, faArrowUpRightFromSquare } from "@fortawesome/free-solid-svg-icons";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Loader from "@/components/Loader";
import { useAuth } from "@/lib/useAuth";
import {
  menuFor,
  sectionPermissions,
  isSectionActive,
  isItemActive,
} from "@/lib/navigation";

const initialsOf = (name) =>
  String(name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "U";

/**
 * The sidebar: a rail of sections with flyouts on a computer, a slide-out drawer on a phone
 * (opened by the floating Menu button). Both are drawn from lib/navigation.js, and from the
 * menu as this user sees it: basic staff get a short flat list of their own pages.
 */
export default function Sidebar() {
  const [openMenu, setOpenMenu] = useState(null);
  const [openGroup, setOpenGroup] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const sidebarRef = useRef(null);
  const router = useRouter();
  const { pathname } = router;
  const { isAdmin, hasPermission, user, logout } = useAuth();
  const menu = useMemo(() => menuFor(user), [user]);

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

  /** A flat entry lights up like its page; a section, for any page inside it. */
  const isActive = useCallback(
    (section) => (section.flatItem ? isItemActive(section.href, pathname) || pathname.startsWith(`${section.href}/`) : isSectionActive(section, pathname)),
    [pathname]
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

  // Open the section that matches the current route: the flyout on a computer, and the drawer's
  // section on a phone when the drawer opens
  useEffect(() => {
    if (isMobile && !isMobileMenuOpen) return;
    const section = menu.find((s) => s.items && isSectionActive(s, pathname));
    if (!section) return;
    setOpenMenu(section.key);
    const group = (section.groups || []).find((g) =>
      (g.match || []).some((prefix) => pathname.startsWith(prefix))
    );
    setOpenGroup(group ? group.key : null);
  }, [pathname, isMobile, isMobileMenuOpen, menu]);

  // The page behind an open drawer does not scroll
  useEffect(() => {
    if (!isMobileMenuOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event) => {
      if (event.key === "Escape") setIsMobileMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [isMobileMenuOpen]);

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

  /* ─── Renderers ───────────────────────────────────────────── */

  const visibleItems = (section, group = null) =>
    (section.items || []).filter(
      (item) => (item.group || null) === group && canAccess(item.permission)
    );

  const hasAnyItem = (section) =>
    visibleItems(section, null).length > 0 || (section.groups || []).some((g) => visibleItems(section, g.key).length > 0);

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

  const renderGroup = (section, group) => {
    const items = visibleItems(section, group.key);
    if (items.length === 0) return null;
    const open = openGroup === group.key;

    // A page inside a group has to mark the group itself as well, or the
    // sidebar reads as though nothing is selected the moment the group is
    // collapsed or another group is opened.
    const activeChild = items.find((item) => isItemActive(item.href, pathname));

    return (
      <li key={group.key} className="nav-sub-row">
        <button
          type="button"
          onClick={() => toggleGroup(group.key)}
          className={`nav-sub-link nav-group-toggle ${open ? "is-open" : ""} ${activeChild ? "is-active" : ""}`}
          aria-expanded={open}
          aria-current={activeChild ? "true" : undefined}
          title={activeChild ? `${group.label} — ${activeChild.label}` : group.label}
        >
          <span className="flex items-center gap-3 min-w-0">
            <span className="nav-dot" />
            <span className="truncate">{group.label}</span>
          </span>
          <span className="flex items-center gap-2 flex-shrink-0">
            {/* Collapsed and holding the current page: a marker stands in for
                the highlighted child row that is hidden. */}
            {activeChild && !open && <span className="nav-group-marker" aria-hidden="true" />}
            <span className={`nav-chevron ${open ? "rotate-90" : ""}`}>›</span>
          </span>
        </button>
        {open && (
          <ul className="nav-group-body">{items.map((item) => renderSubItem(item, { indent: true }))}</ul>
        )}
      </li>
    );
  };

  const renderSubmenu = (section) => {
    const rootItems = visibleItems(section, null);
    const groups = (section.groups || []).map((g) => renderGroup(section, g)).filter(Boolean);
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
    const active = isActive(section);

    if (section.href) {
      const inner = (
        <div className="flex flex-col items-center justify-center text-center">
          <FontAwesomeIcon icon={section.icon} className="w-6 h-6" />
          <span className="text-xs mt-1 leading-tight">{section.label}</span>
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

    if (!hasAnyItem(section)) return null;

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

  /* ─── Phone drawer ────────────────────────────────────────── */

  const drawerLink = (href, label, { active = false, icon = null, external = false, sub = false } = {}) => {
    const className = `nav-drawer-link ${sub ? "is-sub" : ""} ${active ? "is-active" : ""}`;
    const content = (
      <>
        {icon ? (
          <span className="nav-drawer-icon">
            <FontAwesomeIcon icon={icon} className="w-4 h-4" />
          </span>
        ) : (
          <span className="nav-dot" />
        )}
        <span className="flex-1 min-w-0 truncate">{label}</span>
        {external && <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="w-3 h-3 opacity-60" />}
      </>
    );
    return external ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className} onClick={() => setIsMobileMenuOpen(false)}>
        {content}
      </a>
    ) : (
      <Link href={href} className={className} aria-current={active ? "page" : undefined} onClick={() => setIsMobileMenuOpen(false)}>
        {content}
      </Link>
    );
  };

  const renderDrawerSection = (section) => {
    if (!canAccessSection(section)) return null;
    const active = isActive(section);

    if (section.href) {
      return (
        <li key={section.key}>
          {drawerLink(section.href, section.label, { active, icon: section.icon, external: section.external })}
        </li>
      );
    }
    if (!hasAnyItem(section)) return null;

    const open = openMenu === section.key;
    const rootItems = visibleItems(section, null);
    const groups = (section.groups || [])
      .map((group) => ({ group, items: visibleItems(section, group.key) }))
      .filter(({ items }) => items.length > 0);
    return (
      <li key={section.key}>
        <button
          type="button"
          onClick={() => toggleMenu(section.key)}
          className={`nav-drawer-link w-full ${active ? "is-current" : ""}`}
          aria-expanded={open}
        >
          <span className="nav-drawer-icon">
            <FontAwesomeIcon icon={section.icon} className="w-4 h-4" />
          </span>
          <span className="flex-1 min-w-0 text-left">{section.label}</span>
          <FontAwesomeIcon icon={faChevronRight} className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
        </button>
        {open && (
          <ul className="nav-drawer-sub">
            {rootItems.map((item) => (
              <li key={item.href}>{drawerLink(item.href, item.label, { active: isItemActive(item.href, pathname), sub: true })}</li>
            ))}
            {groups.map(({ group, items }) => (
              <li key={group.key}>
                <p className="nav-drawer-group">{group.label}</p>
                <ul>
                  {items.map((item) => (
                    <li key={item.href}>{drawerLink(item.href, item.label, { active: isItemActive(item.href, pathname), sub: true })}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <>
      {/* Floating menu button (phone) */}
      {isMobile && !isMobileMenuOpen && (
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          className="md:hidden fixed right-5 w-16 h-16 rounded-full flex items-center justify-center shadow-lg hover:shadow-xl transition-all z-40"
          style={{
            bottom: "calc(1.25rem + env(safe-area-inset-bottom))",
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

      {/* Desktop rail */}
      <aside ref={sidebarRef} className="nav-rail hidden md:block">
        <nav className="mt-6 h-full overflow-visible">
          <ul className="space-y-1">{menu.map(renderRailSection)}</ul>
        </nav>
      </aside>

      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50">
          <Loader size="lg" fullScreen={false} text="Please wait..." />
        </div>
      )}

      {/* Phone drawer: in front of the top bar, so its own header and close button show */}
      {isMobile && (
        <>
          <div
            className={`md:hidden fixed inset-0 z-[60] bg-black/50 transition-opacity duration-200 ${isMobileMenuOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            onClick={() => setIsMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <nav
            aria-label="Main menu"
            aria-hidden={!isMobileMenuOpen}
            className={`nav-drawer md:hidden ${isMobileMenuOpen ? "is-open" : ""}`}
          >
            <div className="nav-drawer-head">
              <span className="nav-drawer-avatar">{initialsOf(user?.name)}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold truncate">{user?.name || "User"}</span>
                <span className="block text-xs opacity-80 capitalize">{user?.role || "staff"}</span>
              </span>
              <button type="button" onClick={() => setIsMobileMenuOpen(false)} className="nav-drawer-close" aria-label="Close menu">
                <FontAwesomeIcon icon={faTimes} className="w-5 h-5" />
              </button>
            </div>
            <ul className="nav-drawer-list">{isMobileMenuOpen && menu.map(renderDrawerSection)}</ul>
            <div className="nav-drawer-foot">
              <button type="button" onClick={logout} className="nav-drawer-signout">
                <FontAwesomeIcon icon={faRightFromBracket} className="w-4 h-4" />
                Sign out
              </button>
            </div>
          </nav>
        </>
      )}
    </>
  );
}
