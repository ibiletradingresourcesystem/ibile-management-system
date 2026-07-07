import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { apiClient } from "@/lib/api-client";
import { clearAllAppCaches } from "@/lib/clearAllCaches";
import { showToastMessage } from "@/lib/toast-state";

/* ===== Ripple Handler ===== */
function createRipple(event) {
  const button = event.currentTarget;
  const circle = document.createElement("span");
  const diameter = Math.max(button.clientWidth, button.clientHeight);
  const radius = diameter / 2;

  circle.style.width = circle.style.height = `${diameter}px`;
  circle.style.left = `${event.clientX - button.getBoundingClientRect().left - radius}px`;
  circle.style.top = `${event.clientY - button.getBoundingClientRect().top - radius}px`;

  const ripple = button.getElementsByTagName("span")[0];
  if (ripple) ripple.remove();

  button.appendChild(circle);
}

export default function Login({
  staffList,
  locations,
  noAdmin,
  businessName,
  poweredBy,
}) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState(locations?.[0] || "");
  const [availableLocations, setAvailableLocations] = useState(locations || []);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Admin setup state
  const [showSetup, setShowSetup] = useState(!!noAdmin);
  const [setupStep, setSetupStep] = useState("email"); // email | verify | complete
  const [setupEmail, setSetupEmail] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [setupName, setSetupName] = useState("");
  const [setupPin, setSetupPin] = useState("");
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupMessage, setSetupMessage] = useState("");
  const router = useRouter();

  // Determine if selected user is admin
  const selectedUser = staffList.find((u) => u.name === name);
  const isSelectedAdmin = selectedUser?.role === "admin";
  const userAssignedLocation = selectedUser?.assignedLocation || "";

  // When user changes, auto-set location for non-admins
  useEffect(() => {
    if (name && !isSelectedAdmin && userAssignedLocation) {
      setLocation(userAssignedLocation);
    }
  }, [name, isSelectedAdmin, userAssignedLocation]);

  /* ===== Init Store ===== */
  useEffect(() => {
    async function init() {
      if (!availableLocations.length) {
        const res = await fetch("/api/setup/init", { method: "POST" });
        const data = await res.json();
        if (data.success) {
          const locs = data.store.locations.map((l) =>
            typeof l === "string" ? l : l.name,
          );
          setAvailableLocations(locs);
          setLocation(locs[0]);
        }
      }
    }
    init();
  }, []);

  useEffect(() => {
    if (!error) return;
    showToastMessage({ title: "Login", text: error, fallbackTone: "danger" });
    setError("");
  }, [error]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    if (!name) return setError("Please select a user.");
    if (!location) return setError("Please select a location.");
    if (password.length !== 4) return setError("PIN must be 4 digits.");

    setLoading(true);
    try {
      const user = staffList.find((u) => u.name === name);
      if (!user?.email) throw new Error("User email not found");

      const res = await apiClient.post("/api/auth/login", {
        email: user.email,
        password,
      });

      // Clear ALL stale caches before establishing the new session
      await clearAllAppCaches();

      localStorage.setItem("auth_token", res.data.token);
      localStorage.setItem(
        "user",
        JSON.stringify({ ...res.data.user, location }),
      );

      // Determine redirect based on user permissions
      const loggedInUser = res.data.user;
      const isAdmin = loggedInUser?.role === "admin";
      const perms = loggedInUser?.permissions || [];
      const hasDashboard = isAdmin || perms.includes("dashboard");

      if (hasDashboard) {
        router.push("/");
      } else {
        // Find first accessible page
        const pageMap = [
          { perm: "manage.products", path: "/manage/products" },
          { perm: "manage", path: "/manage/products" },
          { perm: "stock.management", path: "/stock/management" },
          { perm: "stock", path: "/stock/management" },
          { perm: "reporting.sales-report", path: "/reporting/reporting" },
          { perm: "reporting", path: "/reporting/reporting" },
          { perm: "expenses.entry", path: "/expenses/expenses" },
          { perm: "expenses", path: "/expenses/expenses" },
          { perm: "setup.company", path: "/setup/setup" },
          { perm: "setup", path: "/setup/setup" },
          { perm: "support", path: "/support" },
        ];
        const first = pageMap.find(({ perm }) => perms.includes(perm));
        router.push(first?.path || "/support");
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setPassword("");
    } finally {
      setLoading(false);
    }
  };

  const handleKeypad = (value) => {
    if (value === "clear") setPassword("");
    else if (value === "back") setPassword((p) => p.slice(0, -1));
    else if (password.length < 4) setPassword((p) => p + value);
  };

  // Admin setup handlers
  const handleSendCode = async (e) => {
    e.preventDefault();
    setSetupLoading(true);
    setSetupMessage("");
    try {
      const res = await fetch("/api/auth/setup-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send-code", email: setupEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSetupMessage(data.message);
      setSetupStep("verify");
    } catch (err) {
      setSetupMessage(err.message);
    } finally {
      setSetupLoading(false);
    }
  };

  const handleVerifyAndCreate = async (e) => {
    e.preventDefault();
    setSetupLoading(true);
    setSetupMessage("");
    try {
      const res = await fetch("/api/auth/setup-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify-and-create",
          code: setupCode,
          name: setupName,
          password: setupPin,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSetupMessage(data.message);
      setSetupStep("complete");
      // Reload after 2 seconds to show login
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setSetupMessage(err.message);
    } finally {
      setSetupLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-6 py-12 overflow-hidden" style={{ backgroundColor: 'var(--page-bg, #f9fafb)' }}>
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-32 -left-32 w-96 h-96 rounded-full bg-blue-100 opacity-40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 w-80 h-80 rounded-full bg-indigo-100 opacity-40 blur-3xl" />
      <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-blue-50 opacity-30 blur-3xl" />

      <div className="relative w-full max-w-4xl flex flex-col lg:flex-row items-center gap-10 lg:gap-16">

        {/* ===== HERO ===== */}
        <div className="w-full lg:flex-1 text-center lg:text-left">
          <img
            src="/images/logo.png"
            alt="St Micheals Logo"
            className="h-14 w-auto mx-auto lg:mx-0 mb-6"
          />
          <span className="inline-flex items-center px-3 py-1 mb-5 rounded border border-blue-100 bg-blue-50 text-blue-600 text-xs font-semibold uppercase tracking-wide">
            Inventory Management System
          </span>
          <h1 className="text-4xl lg:text-5xl font-extrabold text-gray-900 leading-tight mb-5">
            St Micheals<br />Inventory<br />Platform
          </h1>
          <p className="text-sm text-gray-500 max-w-[300px] mx-auto lg:mx-0 leading-relaxed mb-7">
            A secure and centralized system to manage products, staff access,
            and store operations with accuracy and control.
          </p>
          <ul className="flex flex-col items-center lg:items-start gap-2.5 mb-8 text-sm text-gray-600">
            <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />Product &amp; stock management</li>
            <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />Sales reporting &amp; analytics</li>
            <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />Role-based staff access control</li>
          </ul>
          <p className="text-xs text-gray-400">Authorized personnel only</p>
        </div>

        {/* ===== LOGIN CARD ===== */}
        <div className="w-full max-w-sm lg:flex-shrink-0">
          <div className="bg-white rounded-lg shadow-lg p-8 border border-gray-200">

          {/* ADMIN SETUP FLOW */}
          {showSetup ? (
            <div>
              <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">
                Admin Setup
              </h2>
              <p className="text-xs text-gray-500 text-center mb-6">
                No admin account found. Verify your email to create one.
              </p>

              {setupStep === "email" && (
                <form onSubmit={handleSendCode}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Admin Email</label>
                  <input
                    type="email"
                    value={setupEmail}
                    onChange={(e) => setSetupEmail(e.target.value)}
                    placeholder="Enter authorized admin email"
                    required
                    className="form-input mb-4"
                  />
                  <button
                    type="submit"
                    disabled={setupLoading}
                    className="w-full py-3 rounded-lg font-bold text-white text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    {setupLoading ? "Sending..." : "Send Verification Code"}
                  </button>
                </form>
              )}

              {setupStep === "verify" && (
                <form onSubmit={handleVerifyAndCreate}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Verification Code</label>
                  <input
                    type="text"
                    value={setupCode}
                    onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="6-digit code from email"
                    required
                    maxLength={6}
                    className="form-input mb-3 text-center tracking-widest text-lg font-bold"
                  />
                  <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
                  <input
                    type="text"
                    value={setupName}
                    onChange={(e) => setSetupName(e.target.value)}
                    placeholder="Admin display name"
                    required
                    className="form-input mb-3"
                  />
                  <label className="block text-sm font-medium text-gray-700 mb-1">4-Digit PIN</label>
                  <input
                    type="password"
                    value={setupPin}
                    onChange={(e) => setSetupPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    placeholder="••••"
                    required
                    maxLength={4}
                    className="form-input mb-4 text-center tracking-widest text-lg"
                  />
                  <button
                    type="submit"
                    disabled={setupLoading || setupCode.length !== 6 || setupPin.length !== 4}
                    className="w-full py-3 rounded-lg font-bold text-white text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    {setupLoading ? "Creating..." : "Create Admin Account"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setSetupStep("email"); setSetupMessage(""); }}
                    className="w-full mt-2 py-2 text-sm text-gray-500 hover:text-blue-600"
                  >
                    ← Back to email
                  </button>
                </form>
              )}

              {setupStep === "complete" && (
                <div className="text-center py-4">
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <span className="text-green-600 text-2xl">✓</span>
                  </div>
                  <p className="text-green-700 font-semibold">Admin account created!</p>
                  <p className="text-xs text-gray-500 mt-1">Reloading...</p>
                </div>
              )}

              {setupMessage && setupStep !== "complete" && (
                <p className={`mt-3 text-xs text-center ${setupMessage.includes("sent") || setupMessage.includes("success") ? "text-green-600" : "text-red-500"}`}>
                  {setupMessage}
                </p>
              )}
            </div>
          ) : (
            /* NORMAL LOGIN */
            <div>
            <h2 className="text-2xl font-bold text-center text-gray-900 mb-6">
              Staff Login
            </h2>

          <form onSubmit={handleLogin}>
            {/* USER */}
            <select
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="form-input mb-4"
            >
              <option value="" disabled>Select User</option>
              {staffList.map((user, index) => (
                <option key={index} value={user.name}>{user.name}</option>
              ))}
            </select>

            {/* LOCATION */}
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={name && !isSelectedAdmin && !!userAssignedLocation}
              className={`form-input mb-4 ${
                name && !isSelectedAdmin && userAssignedLocation ? "bg-gray-100 text-gray-600 cursor-not-allowed" : ""
              }`}
            >
              {(isSelectedAdmin || !name) ? (
                availableLocations.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))
              ) : (
                <option value={userAssignedLocation || location}>
                  {userAssignedLocation || location}
                </option>
              )}
            </select>
            {name && !isSelectedAdmin && userAssignedLocation && (
              <p className="text-xs text-gray-500 -mt-3 mb-3 text-center">
                Assigned to {userAssignedLocation}
              </p>
            )}

            {/* PIN */}
            <div className="flex justify-center gap-3 mb-5">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 border-gray-400 ${
                    password.length > i ? "bg-blue-600" : "bg-gray-300"
                  }`}
                />
              ))}
            </div>

            {/* KEYPAD */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, "C", 0, "←"].map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={(e) => {
                    createRipple(e);
                    handleKeypad(
                      key === "C" ? "clear" : key === "←" ? "back" : key,
                    );
                  }}
                  className={`ripple h-16 border-2 border-gray-200 rounded-lg text-lg font-bold shadow
                    active:scale-95 transition
                    ${
                      key === "C"
                        ? "bg-red-500 text-white"
                        : key === "←"
                          ? "bg-gray-400 text-white"
                          : "bg-blue-100 text-blue-800"
                    }`}
                >
                  {key}
                </button>
              ))}
            </div>

            {/* LOGIN BUTTON */}
            <button
              type="submit"
              disabled={loading}
              onClick={createRipple}
              className="ripple w-full py-3 rounded-lg font-bold text-white text-lg
                         bg-blue-600 hover:bg-blue-700 active:scale-95 transition"
            >
              {loading ? "Logging in..." : "Log In"}
            </button>
          </form>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* ===== FOOTER ===== */}
      <p className="mt-10 text-xs text-gray-400 text-center">
        &copy; {new Date().getFullYear()} {businessName} &middot; Powered by <span className="font-medium text-gray-500">{poweredBy}</span> &middot; All rights reserved
      </p>
    </div>
  );
}

/* ===== SSR ===== */
export async function getServerSideProps() {
  const { connectToDatabase } = await import("@/lib/mongodb");
  const User = (await import("@/models/User")).default;
  const Store = (await import("@/models/Store")).default;
  const Staff = (await import("@/models/Staff")).default;

  await connectToDatabase();

  // Fetch all users (for login dropdown)
  const adminUsers = await User.find({ isActive: true }, "name email role").lean();

  // Check if any admin exists
  const hasAdmin = adminUsers.some((u) => u.role === "admin");

  // Fetch staff to get assigned locations
  const staffData = await Staff.find({}, "name location role").lean();

  const store = await Store.findOne({}).lean();

  const locations = store?.locations?.map((l) =>
    typeof l === "string" ? l : l.name,
  ) || ["Default Location"];

  // Create a map of user name to their assigned location from Staff
  const staffLocationMap = {};
  staffData.forEach((s) => {
    if (s.name && s.location) {
      staffLocationMap[s.name] = s.location;
    }
  });

  return {
    props: {
      staffList: adminUsers.map((u) => ({
        ...JSON.parse(JSON.stringify(u)),
        assignedLocation: staffLocationMap[u.name] || "",
      })),
      locations,
      noAdmin: !hasAdmin,
      businessName: store?.businessName || store?.name || "St Micheals",
      poweredBy:
        store?.poweredBy || store?.providerName || store?.vendorName || "BizSuits",
    },
  };
}
