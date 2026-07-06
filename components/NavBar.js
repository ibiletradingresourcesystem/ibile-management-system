import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faStore, faRightFromBracket, faBell } from '@fortawesome/free-solid-svg-icons';

const TopBar = ({ user, logout }) => {
  const [lowStockCount, setLowStockCount] = useState(0);
  const [expiringCount, setExpiringCount] = useState(0);
  const [creditCount, setCreditCount] = useState(0);
  const [creditBalance, setCreditBalance] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const updateStatus = () => setIsOnline(navigator.onLine);
    updateStatus();
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);
    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, []);

  useEffect(() => {
    // Fetch notifications data periodically
    const fetchNotifications = async () => {
      try {
        // Fetch low stock from products
        const productsRes = await fetch("/api/products");
        if (productsRes.ok) {
          const data = await productsRes.json();
          const productList = data.data || data;
          const products = Array.isArray(productList) ? productList : [];

          const nextLowStockCount = products.filter(
            (product) => product.minStock > 0 && product.quantity < product.minStock
          ).length;
          setLowStockCount(nextLowStockCount);
        }

        // Fetch expiring batches from the same endpoint as expiration-report
        const batchesRes = await fetch("/api/stock-movement/batches-with-expiry");
        if (batchesRes.ok) {
          const batchData = await batchesRes.json();
          
          // Handle different API response formats
          let batchList = [];
          if (Array.isArray(batchData)) {
            batchList = batchData;
          } else if (batchData.data && Array.isArray(batchData.data)) {
            batchList = batchData.data;
          } else if (batchData.batches && Array.isArray(batchData.batches)) {
            batchList = batchData.batches;
          }
          
          // Calculate expiring count (batches expiring within 30 days, but not already expired)
          const now = new Date();
          const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
          
          const expiringBatches = batchList.filter(batch => {
            if (!batch.expiryDate) return false;
            const expiryDate = new Date(batch.expiryDate);
            // Include critical (≤7 days) and warning (8-30 days) statuses
            return expiryDate > now && expiryDate <= thirtyDaysFromNow;
          });

          setExpiringCount(expiringBatches.length);
        }

        const creditsRes = await fetch("/api/credits");
        if (creditsRes.ok) {
          const creditsData = await creditsRes.json();
          const summary = creditsData.summary || {};
          setCreditCount(Number(summary.activeCredits || 0));
          setCreditBalance(Number(summary.outstandingBalance || 0));
        }
      } catch (err) {
        console.error("Error fetching notifications:", err);
        setLowStockCount(0);
        setExpiringCount(0);
        setCreditCount(0);
        setCreditBalance(0);
      }
    };

    fetchNotifications();
    // Refresh every 2 minutes
    const interval = setInterval(fetchNotifications, 120000);
    return () => clearInterval(interval);
  }, []);

  // Function to get initials
  const getInitials = (name) =>
    name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase();

  const topBarStyle = {
    backgroundColor: '#ffffff',
    borderColor: 'var(--border-subtle, #e5e7eb)',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
  };

  const brandAccentStyle = {
    background: 'var(--btn-primary-bg, #0284c7)',
  };

  const dropdownSurfaceStyle = {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
  };

  const dropdownHeaderStyle = {
    background: 'var(--btn-primary-bg, #0284c7)',
  };

  const avatarStyle = {
    background: 'var(--color-secondary-600, #0891b2)',
  };

  const totalNotifications = lowStockCount + expiringCount + creditCount;

  return (
    <div
      className="fixed top-0 left-0 right-0 w-full z-50 flex items-center justify-between gap-2 sm:gap-3 md:gap-0 px-2 sm:px-3 md:px-8 shadow-lg border-b h-14 md:h-16"
      style={topBarStyle}
    >
      {/* Left Section: Back Office Text - Hidden on mobile */}
      <div className="hidden md:flex items-center gap-3 w-full md:w-auto">
        <div
          className="w-8 md:w-10 h-8 md:h-10 rounded flex items-center justify-center flex-shrink-0"
          style={brandAccentStyle}
        >
          <FontAwesomeIcon icon={faStore} className="w-4 md:w-6 h-4 md:h-6 text-white" />
        </div>
        <h2 className="text-gray-900 text-lg md:text-2xl font-bold tracking-tight">Back Office</h2>
      </div>

      {/* Mobile Logo Icon - Shown only on mobile */}
      <div className="md:hidden flex-shrink-0">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shadow-md"
          style={brandAccentStyle}
        >
          <FontAwesomeIcon icon={faStore} className="w-4 h-4 text-white" />
        </div>
      </div>

      {/* Right Section: Profile and Icons */}
      <div className="flex items-center gap-1 sm:gap-2 md:gap-6 w-auto justify-end flex-shrink-0">
        <div
          className={`hidden sm:flex items-center gap-2 px-2 py-1 rounded-md border text-xs font-semibold ${
            isOnline
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-red-50 text-red-700 border-red-200"
          }`}
          title={isOnline ? "Internet available" : "No internet connection"}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isOnline ? "bg-emerald-500" : "bg-red-500"
            }`}
          />
          {isOnline ? "Online" : "Offline"}
        </div>

        {/* Unified Notification Icon */}
        <div className="relative">
          <button
            className="relative p-1 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors duration-300"
            onClick={() => setShowNotifications(!showNotifications)}
            title="View notifications"
          >
            <FontAwesomeIcon icon={faBell} className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-gray-600 hover:text-blue-600 transition-colors" />
            {totalNotifications > 0 && (
              <span className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 bg-red-500 rounded-full absolute -top-1 -right-1 shadow-sm flex items-center justify-center text-white text-xs font-bold">
                {totalNotifications > 9 ? '9+' : totalNotifications}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 md:w-96 rounded-xl border z-50 overflow-hidden" style={dropdownSurfaceStyle}>
              <div className="text-white px-4 py-3" style={dropdownHeaderStyle}>
                <p className="font-semibold text-sm flex items-center gap-2">
                  Notifications
                  <span className="ml-auto bg-white/30 px-2 py-0.5 rounded-full text-xs">
                    {totalNotifications}
                  </span>
                </p>
              </div>

              <div className="grid grid-cols-4 border-b border-gray-200 bg-gray-50">
                {[
                  ['all', `All (${totalNotifications})`, 'bg-white text-blue-600 border-b-2 border-blue-600'],
                  ['stock', `Stock (${lowStockCount})`, 'bg-white text-yellow-600 border-b-2 border-yellow-600'],
                  ['expiring', `Expiring (${expiringCount})`, 'bg-white text-orange-600 border-b-2 border-orange-600'],
                  ['credit', `Credit (${creditCount})`, 'bg-white text-amber-600 border-b-2 border-amber-600'],
                ].map(([key, label, activeClass]) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`px-2 py-2 text-xs sm:text-sm font-semibold transition-colors ${
                      activeTab === key ? activeClass : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
                {activeTab === 'all' && totalNotifications === 0 && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
                    <p className="text-sm font-semibold text-emerald-800">Everything is clear</p>
                    <p className="mt-1 text-xs text-emerald-700">No low stock, expiring batches, or open credit alerts.</p>
                  </div>
                )}

                {(activeTab === 'all' || activeTab === 'stock') && lowStockCount > 0 && (
                  <div className="bg-yellow-50 border-l-4 border-yellow-500 p-3 rounded-lg">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-yellow-100 text-yellow-700 flex items-center justify-center font-bold">!</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-sm">Low Stock Alert</p>
                        <p className="text-xs text-gray-600 mt-1">
                          {lowStockCount} product{lowStockCount > 1 ? 's' : ''} below minimum stock level
                        </p>
                        <Link href="/stock/management" onClick={() => setShowNotifications(false)} className="inline-block mt-2 text-xs font-semibold text-yellow-700 underline hover:text-yellow-900">
                          View Details →
                        </Link>
                      </div>
                    </div>
                  </div>
                )}

                {(activeTab === 'all' || activeTab === 'expiring') && expiringCount > 0 && (
                  <div className="bg-orange-50 border-l-4 border-orange-500 p-3 rounded-lg">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center font-bold">30</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-sm">Expiration Alert</p>
                        <p className="text-xs text-gray-600 mt-1">
                          {expiringCount} batch{expiringCount > 1 ? 'es' : ''} expiring within 30 days
                        </p>
                        <Link href="/stock/expiration-report" onClick={() => setShowNotifications(false)} className="inline-block mt-2 text-xs font-semibold text-orange-700 underline hover:text-orange-900">
                          View Details →
                        </Link>
                      </div>
                    </div>
                  </div>
                )}

                {(activeTab === 'all' || activeTab === 'credit') && creditCount > 0 && (
                  <div className="bg-amber-50 border-l-4 border-amber-500 p-3 rounded-lg">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-bold">₦</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-sm">Credit Recovery</p>
                        <p className="text-xs text-gray-600 mt-1">
                          {creditCount} open credit account{creditCount > 1 ? 's' : ''} with ₦{Number(creditBalance || 0).toLocaleString('en-NG')} outstanding
                        </p>
                        <Link href="/expenses/credit-management" onClick={() => setShowNotifications(false)} className="inline-block mt-2 text-xs font-semibold text-amber-700 underline hover:text-amber-900">
                          View Credit Management →
                        </Link>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'stock' && lowStockCount === 0 && (
                  <div className="text-center py-6">
                    <p className="text-sm text-gray-600">All stock levels are healthy</p>
                  </div>
                )}

                {activeTab === 'expiring' && expiringCount === 0 && (
                  <div className="text-center py-6">
                    <p className="text-sm text-gray-600">No expiring products</p>
                  </div>
                )}

                {activeTab === 'credit' && creditCount === 0 && (
                  <div className="text-center py-6">
                    <p className="text-sm text-gray-600">No open credit accounts</p>
                  </div>
                )}
              </div>

              <div className="bg-gray-50 border-t border-gray-200 px-4 py-2">
                <Link
                  href={creditCount > 0 ? "/expenses/credit-management" : "/stock/expiration-report"}
                  onClick={() => setShowNotifications(false)}
                  className="block text-center text-sm font-semibold text-blue-600 transition hover:text-blue-700"
                >
                  {creditCount > 0 ? "Open Credit Management →" : "View Expiration Report →"}
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Profile Section - Compact on mobile */}
        <div className="flex items-center gap-1 sm:gap-2 md:gap-4 pl-1 sm:pl-2 md:pl-6 border-l border-gray-200">
          {/* Profile Image or Placeholder */}
          <div className="relative group">
            <div className="w-7 sm:w-8 md:w-10 h-7 sm:h-8 md:h-10 flex items-center justify-center text-white rounded-full shadow-md transition-all text-xs sm:text-sm md:text-lg font-bold flex-shrink-0" style={avatarStyle}>
              {getInitials(user?.name) || 'U'}
            </div>
          </div>

          {/* User Info - Hidden on mobile, shown on sm+ */}
          <div className="flex-col hidden sm:flex md:flex">
            <span className="text-gray-900 font-semibold text-xs md:text-sm">
              {user?.name || 'User'}
            </span>
            <span className="text-xs text-gray-500 capitalize">{user?.role || 'staff'}</span>
          </div>

          {/* Logout Button - Icon on mobile, icon+text on md+ */}
          <button
            onClick={logout}
            className="flex items-center gap-0.5 sm:gap-1 md:gap-2 bg-red-50 hover:bg-red-100 text-red-600 hover:text-red-700 text-xs md:text-sm px-1.5 sm:px-2 md:px-4 py-1.5 sm:py-2 rounded-lg shadow-sm transition duration-200 font-medium border border-red-200 hover:border-red-300 flex-shrink-0 whitespace-nowrap"
          >
            <FontAwesomeIcon icon={faRightFromBracket} className="w-3 h-3 md:w-4 md:h-4" />
            <span className="hidden sm:inline md:inline">Log Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default TopBar;
