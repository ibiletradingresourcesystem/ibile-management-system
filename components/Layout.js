import { Inter } from "next/font/google";
import { useRouter } from "next/router";
import { useAuth } from "@/lib/useAuth";
import Nav from "@/components/Nav";
import NavBar from "@/components/NavBar";
import Loader from "@/components/Loader";
import AccessDeniedState from "@/components/AccessDeniedState";
import { getRequiredPermission } from "@/lib/navigation";

const inter = Inter({ subsets: ["latin"] });

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
    <div
      className="min-h-screen w-full flex flex-col"
      style={{ backgroundColor: "var(--page-bg, #f9fafb)" }}
    >
      {/* Top Navigation Bar - Fixed */}
      <NavBar user={user} logout={logout} />

      {/* Main Layout Container */}
      <div className="w-full flex flex-col md:flex-row pt-14 md:pt-16 md:pl-20">
        {/* Desktop Navigation - Relative positioned sidebar */}
        <Nav className="hidden md:flex md:fixed md:top-16 md:left-0 md:w-20 md:h-screen md:z-40 md:flex-col" />

        {/* Main Content Area */}
        <div className="w-full flex-1 overflow-hidden">
          <div
            className="w-full min-h-[calc(100vh-56px)] md:min-h-[calc(100vh-64px)] px-3 md:px-6 overflow-y-auto"
            style={{ backgroundColor: "var(--page-bg, #f9fafb)" }}
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
