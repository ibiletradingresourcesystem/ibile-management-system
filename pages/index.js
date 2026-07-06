"use client";

import { Bar, Line } from "react-chartjs-2";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/router";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog } from "@/lib/dialogs";
import { motion } from "framer-motion";
import { Loader } from "@/components/ui";
import useProgress from "@/lib/useProgress";
import { getCachedSetup } from "@/lib/setupCache";
import { formatCurrency, formatNumber } from "@/lib/format";
import { aggregateProductSales } from "@/lib/product-sales-report";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  List,
  Mail,
  Minus,
  PackagePlus,
  RefreshCw,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const PERIOD_LABELS = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This Week",
  lastWeek: "Last Week",
  month: "This Month",
  lastMonth: "Last Month",
  custom: "Custom Period",
};

const COMPARISON_LABELS = {
  today:     "vs yesterday",
  yesterday: "vs day before",
  week:      "vs previous week",
  lastWeek:  "vs week before that",
  month:     "vs last month",
  lastMonth: "vs month before that",
  custom:    "",
};

const DASH_HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0) return "12 AM";
  if (i < 12) return `${i} AM`;
  if (i === 12) return "12 PM";
  return `${i - 12} PM`;
});

function computeTrend(current, previous) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return { direction: "up", label: "+100%" };
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? "+" : "";
  return {
    direction: pct >= 0 ? "up" : "down",
    label: `${sign}${pct.toFixed(2)}%`,
  };
}

function resolveLocationName(record) {
  const rawLocation =
    record?.locationName ??
    record?.location ??
    record?.storeLocation ??
    null;

  if (typeof rawLocation === "string") {
    return rawLocation;
  }

  if (rawLocation && typeof rawLocation === "object") {
    if (typeof rawLocation.name === "string") return rawLocation.name;
    if (typeof rawLocation.label === "string") return rawLocation.label;
  }

  return null;
}

function matchesSelectedLocation(record, selectedLocation) {
  if (selectedLocation === "All") return true;
  return resolveLocationName(record) === selectedLocation;
}

const DASHBOARD_COMPLETED_ORDER_STATUSES = new Set(["Processing", "Shipped", "Delivered"]);

function getTransactionStaffDisplayName(record) {
  const explicitName =
    record?.staff?.name ||
    record?.staffName ||
    record?.completedByStaffName ||
    "";

  return String(explicitName).trim() || "Unknown";
}

function getOrderCompletionDate(order) {
  return (
    order?.finalizedAt ||
    order?.reservationReleasedAt ||
    order?.updatedAt ||
    order?.createdAt ||
    new Date().toISOString()
  );
}

function isCompletedOrderForDashboard(order) {
  const status = String(order?.status || "").trim();
  const isPaid = Boolean(order?.paid || order?.paymentStatus === "Paid");
  const isFinalized = Boolean(
    order?.inventoryFinalizedBy ||
    order?.reservationStatus === "finalized" ||
    order?.paymentReference
  );

  return isPaid && isFinalized && DASHBOARD_COMPLETED_ORDER_STATUSES.has(status);
}

function getTransactionLookupKeys(tx) {
  const keys = new Set();

  [tx?._id, tx?.externalId, tx?.dedupeKey, tx?.sourceOrderId].forEach((value) => {
    const normalized = String(value || "").trim();
    if (normalized) {
      keys.add(normalized);
    }
  });

  return keys;
}

function getOrderLookupKeys(order) {
  const keys = new Set();
  const orderId = String(order?._id || "").trim();

  if (orderId) {
    keys.add(orderId);
    keys.add(`order:${orderId}`);
  }

  const paymentReference = String(order?.paymentReference || "").trim();
  if (paymentReference) {
    keys.add(paymentReference);
  }

  return keys;
}

function getOrderCustomerDisplayName(order) {
  return (
    order?.customer?.name ||
    order?.shippingDetails?.name ||
    order?.customerSnapshot?.name ||
    "Unknown"
  );
}

export default function Home() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [lastRefresh, setLastRefresh] = useState(null);

  const [storeInfo, setStoreInfo] = useState({});
  const [selectedUser, setSelectedUser] = useState("Admin");

  const [allTransactions, setAllTransactions] = useState([]);
  const [allExpenses, setAllExpenses] = useState([]);
  const [allOrders, setAllOrders] = useState([]);

  const [selectedLocation, setSelectedLocation] = useState("All");
  const [selectedPeriod, setSelectedPeriod] = useState("today");
  const [customDateRange, setCustomDateRange] = useState({
    startDate: "",
    endDate: "",
  });

  const dashboardTransactions = useMemo(() => {
    const normalizedTransactions = Array.isArray(allTransactions) ? allTransactions : [];
    if (!Array.isArray(allOrders) || allOrders.length === 0) {
      return normalizedTransactions;
    }

    const existingLookupKeys = new Set();
    normalizedTransactions.forEach((tx) => {
      getTransactionLookupKeys(tx).forEach((key) => existingLookupKeys.add(key));
    });

    const fallbackTransactions = allOrders
      .filter(isCompletedOrderForDashboard)
      .filter((order) => {
        const lookupKeys = getOrderLookupKeys(order);
        if (lookupKeys.size === 0) {
          return false;
        }

        for (const key of lookupKeys) {
          if (existingLookupKeys.has(key)) {
            return false;
          }
        }

        return true;
      })
      .map((order) => ({
        _id: `order-fallback:${String(order._id)}`,
        externalId: `order:${String(order._id)}`,
        sourceOrderId: String(order._id),
        salesChannel: "ONLINE_STORE",
        status: "completed",
        total: Number(order.total || 0),
        subtotal: Number(order.subtotal || order.total || 0),
        tax: 0,
        createdAt: getOrderCompletionDate(order),
        location: order.locationName || "online",
        locationName: order.locationName || "online",
        staff: order.completedByStaffName
          ? { name: order.completedByStaffName }
          : null,
        staffName: order.completedByStaffName || "Unknown",
        completedByStaffName: order.completedByStaffName || "Unknown",
        customerName: getOrderCustomerDisplayName(order),
        isSyntheticOrderTransaction: true,
      }));

    return [...normalizedTransactions, ...fallbackTransactions];
  }, [allTransactions, allOrders]);

  /* =======================
     FETCH DATA (Optimized with caching + parallel calls)
  ======================= */
  async function fetchDashboardData() {
    try {
      setLoading(true);
      start();

      // Use cached setup (24-hour TTL) to avoid unnecessary API call
      const setupData = await getCachedSetup();
      setStoreInfo(setupData?.store || {});
      setSelectedUser(setupData?.user?.name || "Admin");

      // Fetch transactional data in parallel (cannot cache - changes frequently)
      onFetch();
      const [txRes, expenseRes, orderRes] = await Promise.all([
        apiClient.get("/api/transactions/transactions"),
        apiClient.get("/api/expenses"),
        apiClient.get("/api/orders"),
      ]);

      onProcess();
      setAllTransactions(txRes.data.transactions || []);
      setAllExpenses(expenseRes.data.expenses || []);
      setAllOrders(
        Array.isArray(orderRes.data?.orders) ? orderRes.data.orders : []
      );
      
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Dashboard load failed:", err);
      if (err.response?.status === 500) {
        console.error("Server error details:", {
          endpoint: err.config?.url,
          status: err.response?.status,
          message: err.response?.data?.message || err.response?.data?.error,
          details: err.response?.data?.error || err.message
        });
      }
    } finally {
      complete();
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchDashboardData();
  }, []);

  /* =======================
     DATE FILTER
  ======================= */
  const isWithinPeriod = (date) => {
    const now = new Date();
    const d = new Date(date);

    if (selectedPeriod === "today")
      return d.toDateString() === now.toDateString();

    if (selectedPeriod === "yesterday") {
      const yesterday = new Date();
      yesterday.setDate(now.getDate() - 1);
      return d.toDateString() === yesterday.toDateString();
    }

    if (selectedPeriod === "week") {
      const thisWeekStart = new Date(now);
      thisWeekStart.setDate(now.getDate() - now.getDay()); // back to Sunday
      thisWeekStart.setHours(0, 0, 0, 0);
      return d >= thisWeekStart && d <= now;
    }

    if (selectedPeriod === "lastWeek") {
      const thisWeekStart = new Date(now);
      thisWeekStart.setDate(now.getDate() - now.getDay());
      thisWeekStart.setHours(0, 0, 0, 0);
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(thisWeekStart.getDate() - 7);
      return d >= lastWeekStart && d < thisWeekStart;
    }

    if (selectedPeriod === "month")
      return (
        d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      );

    if (selectedPeriod === "lastMonth") {
      const lastMonth = new Date();
      lastMonth.setMonth(now.getMonth() - 1);
      return (
        d.getMonth() === lastMonth.getMonth() && d.getFullYear() === lastMonth.getFullYear()
      );
    }

    if (selectedPeriod === "custom") {
      if (!customDateRange.startDate || !customDateRange.endDate) return true;
      const start = new Date(customDateRange.startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(customDateRange.endDate);
      end.setHours(23, 59, 59, 999);
      return d >= start && d <= end;
    }

    return true;
  };

  const isInPrevPeriod = (date) => {
    const now = new Date();
    const d = new Date(date);
    if (selectedPeriod === "today") {
      const yesterday = new Date();
      yesterday.setDate(now.getDate() - 1);
      return d.toDateString() === yesterday.toDateString();
    }
    if (selectedPeriod === "yesterday") {
      const dayBefore = new Date();
      dayBefore.setDate(now.getDate() - 2);
      return d.toDateString() === dayBefore.toDateString();
    }
    if (selectedPeriod === "week") {
      // prev period of "This Week" = Last Week (Sun–Sat)
      const thisWeekStart = new Date(now);
      thisWeekStart.setDate(now.getDate() - now.getDay());
      thisWeekStart.setHours(0, 0, 0, 0);
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(thisWeekStart.getDate() - 7);
      return d >= lastWeekStart && d < thisWeekStart;
    }
    if (selectedPeriod === "lastWeek") {
      // prev period of "Last Week" = week before last (Sun–Sat)
      const thisWeekStart = new Date(now);
      thisWeekStart.setDate(now.getDate() - now.getDay());
      thisWeekStart.setHours(0, 0, 0, 0);
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(thisWeekStart.getDate() - 7);
      const weekBeforeLastStart = new Date(lastWeekStart);
      weekBeforeLastStart.setDate(lastWeekStart.getDate() - 7);
      return d >= weekBeforeLastStart && d < lastWeekStart;
    }
    if (selectedPeriod === "month") {
      const lm = new Date(); lm.setMonth(now.getMonth() - 1);
      return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
    }
    if (selectedPeriod === "lastMonth") {
      const tm = new Date(); tm.setMonth(now.getMonth() - 2);
      return d.getMonth() === tm.getMonth() && d.getFullYear() === tm.getFullYear();
    }
    return false;
  };

  /* =======================
     FILTERED DATA
  ======================= */
  const filteredTransactions = useMemo(() => {
    return dashboardTransactions.filter((tx) => {
      if (tx.status !== "completed") return false;
      if (!matchesSelectedLocation(tx, selectedLocation)) return false;
      return isWithinPeriod(tx.createdAt);
    });
  }, [dashboardTransactions, selectedLocation, selectedPeriod, customDateRange]);

  const heldTransactions = useMemo(() => {
    return dashboardTransactions.filter((tx) => {
      if (tx.status !== "held") return false;
      if (!matchesSelectedLocation(tx, selectedLocation)) return false;
      return isWithinPeriod(tx.createdAt);
    });
  }, [dashboardTransactions, selectedLocation, selectedPeriod, customDateRange]);

  const prevFilteredTransactions = useMemo(() => {
    return dashboardTransactions.filter((tx) => {
      if (tx.status !== "completed") return false;
      if (!matchesSelectedLocation(tx, selectedLocation)) return false;
      return isInPrevPeriod(tx.createdAt);
    });
  }, [dashboardTransactions, selectedLocation, selectedPeriod]);

  const filteredOrders = useMemo(() => {
    if (!Array.isArray(allOrders)) return [];

    return allOrders.filter((order) => {
      if (!matchesSelectedLocation(order, selectedLocation)) return false;
      return isWithinPeriod(order.createdAt);
    });
  }, [allOrders, selectedLocation, selectedPeriod, customDateRange]);

  const recentOrders = useMemo(() => {
    return filteredOrders.filter((order) => !isCompletedOrderForDashboard(order));
  }, [filteredOrders]);

  const filteredExpenses = useMemo(
    () =>
      allExpenses.filter((expense) => {
        if (!matchesSelectedLocation(expense, selectedLocation)) return false;
        return isWithinPeriod(expense.expenseDate || expense.createdAt);
      }),
    [allExpenses, selectedLocation, selectedPeriod, customDateRange]
  );

  /* =======================
     KPIs
  ======================= */
  const kpis = useMemo(() => {
    const sales = filteredTransactions.reduce(
      (sum, t) => sum + Number(t.total || 0),
      0
    );
    const count = filteredTransactions.length;
    const heldCount = heldTransactions.length;
    const heldTotal = heldTransactions.reduce(
      (sum, t) => sum + Number(t.total || 0),
      0
    );

    return {
      sales,
      transactions: count,
      avg: count ? sales / count : 0,
      heldCount,
      heldTotal,
    };
  }, [filteredTransactions, heldTransactions]);

  const prevKpis = useMemo(() => {
    const sales = prevFilteredTransactions.reduce(
      (sum, t) => sum + Number(t.total || 0),
      0
    );
    const count = prevFilteredTransactions.length;
    return { sales, transactions: count, avg: count ? sales / count : 0 };
  }, [prevFilteredTransactions]);

  /* =======================
     PRODUCT SALES
  ======================= */
  const productSales = useMemo(() => {
    return aggregateProductSales(filteredTransactions);
  }, [filteredTransactions]);

  const prevProductSales = useMemo(() => {
    return aggregateProductSales(prevFilteredTransactions);
  }, [prevFilteredTransactions]);

  // Merge current + previous period for per-product trend column
  const topProductsWithTrend = useMemo(() => {
    const prevMap = new Map(prevProductSales.map((p) => [p.key, p]));
    return productSales.slice(0, 10).map((p) => {
      const prev = prevMap.get(p.key);
      const prevQty = prev?.unitsSold ?? 0;
      const prevAmt = prev?.totalSales ?? 0;
      const qtyTrend = computeTrend(p.unitsSold, prevQty);
      const amtTrend = computeTrend(p.totalSales, prevAmt);
      return { ...p, prevQty, prevAmt, qtyTrend, amtTrend };
    });
  }, [productSales, prevProductSales]);

  /* =======================
     TOP STAFF
  ======================= */
  const topStaff = useMemo(() => {
    const map = {};
    filteredTransactions.forEach((tx) => {
      const staff = getTransactionStaffDisplayName(tx);
      map[staff] = (map[staff] || 0) + Number(tx.total || 0);
    });

    


    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([staff, total]) => ({ staff, total }));
  }, [filteredTransactions]);

  /* =======================
     CHART DATA
  ======================= */
  const expenseChart = {
    labels: filteredExpenses.map((e) => e.title),
    datasets: [
      {
        label: "Expenses",
        data: filteredExpenses.map((e) => Number(e.amount || 0)),
        backgroundColor: "#ef4444",
      },
    ],
  };

  const handleDailyMail = async () => {
    try {
      const response = await apiClient.post("/api/daily-mail");
      await showAlertDialog({
        title: "Daily email sent",
        message: `Sent to: ${response.data.sentTo}`,
        tone: "success",
      });
    } catch (error) {
      await showAlertDialog({
        title: "Daily email failed",
        message: error.response?.data?.error || error.message,
        tone: "danger",
      });
    }
  };

  const dashboardHeading = storeInfo?.name || selectedUser;
  const quickActions = [
    {
      label: "Add products",
      icon: PackagePlus,
      onClick: () => router.push("/products/new"),
    },
    {
      label: "Stock",
      icon: List,
      onClick: () => router.push("/stock/management"),
    },
    {
      label: "Purchase order",
      icon: ShoppingCart,
      onClick: () => router.push("/manage/purchase-orders"),
    },
  ];

  const salesTrend = computeTrend(kpis.sales, prevKpis.sales);
  const txTrend = computeTrend(kpis.transactions, prevKpis.transactions);
  const avgTrend = computeTrend(kpis.avg, prevKpis.avg);
  const comparisonLabel = COMPARISON_LABELS[selectedPeriod] ?? "";

  /* =======================
     HOURLY OF DAY (0-23)
  ======================= */
  const [showHourlyChart, setShowHourlyChart] = useState(true);
  const [showComparison, setShowComparison] = useState(true);

  const hourlyOfDay = useMemo(() => {
    const arr = new Array(24).fill(0);
    filteredTransactions.forEach((tx) => {
      const h = new Date(tx.createdAt).getHours();
      arr[h] += tx.total || 0;
    });
    return arr;
  }, [filteredTransactions]);

  /* =======================
     COMPARISON CHART DATA
  ======================= */
  const comparisonChartData = useMemo(() => {
    const isHourly = selectedPeriod === "today" || selectedPeriod === "yesterday";

    if (isHourly) {
      const curr = new Array(24).fill(0);
      const prev = new Array(24).fill(0);
      filteredTransactions.forEach((tx) => {
        curr[new Date(tx.createdAt).getHours()] += tx.total || 0;
      });
      prevFilteredTransactions.forEach((tx) => {
        prev[new Date(tx.createdAt).getHours()] += tx.total || 0;
      });
      return { labels: DASH_HOUR_LABELS, curr, prev, currKeys: DASH_HOUR_LABELS, prevKeys: DASH_HOUR_LABELS };
    }

    // Daily grouping for all other periods
    const currBuckets = {};
    const prevBuckets = {};
    filteredTransactions.forEach((tx) => {
      const d = new Date(tx.createdAt).toISOString().split("T")[0];
      currBuckets[d] = (currBuckets[d] || 0) + (tx.total || 0);
    });
    prevFilteredTransactions.forEach((tx) => {
      const d = new Date(tx.createdAt).toISOString().split("T")[0];
      prevBuckets[d] = (prevBuckets[d] || 0) + (tx.total || 0);
    });

    const currKeys = Object.keys(currBuckets).sort();
    const prevKeys = Object.keys(prevBuckets).sort();
    const maxLen = Math.max(currKeys.length, prevKeys.length, 1);
    const labels = Array.from({ length: maxLen }, (_, i) => currKeys[i] || `Day ${i + 1}`);
    const curr = Array.from({ length: maxLen }, (_, i) => (currKeys[i] ? currBuckets[currKeys[i]] : 0));
    const prev = Array.from({ length: maxLen }, (_, i) => (prevKeys[i] ? prevBuckets[prevKeys[i]] : 0));
    return { labels, curr, prev, currKeys, prevKeys };
  }, [filteredTransactions, prevFilteredTransactions, selectedPeriod]);

  return (
    <div className="page-container">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5">
        {/* Greeting */}
        <header className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-gray-200">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
              Hi, {dashboardHeading}
            </h1>
            {lastRefresh && (
              <p className="mt-1 text-xs text-gray-400">
                Updated {lastRefresh.toLocaleTimeString()}
              </p>
            )}
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-white hover:border-gray-300 hover:shadow"
            style={{ borderRadius: 'var(--radius-lg)' }}
            onClick={handleDailyMail}
            title="Send daily mail report"
          >
            <Mail className="h-3.5 w-3.5" />
            Mail report
          </button>
        </header>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {quickActions.map((action) => (
            <QuickActionTile
              key={action.label}
              label={action.label}
              icon={action.icon}
              onClick={action.onClick}
            />
          ))}
        </div>

        {/* Key Trading Metrics */}
        <section
          className="overflow-hidden border border-gray-200 bg-white"
          style={{ borderRadius: 'var(--radius-lg)' }}
        >
          <div className="border-b border-gray-200 px-5 py-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-base font-bold tracking-tight text-gray-900">
                Key trading metrics
              </h2>
              <div className="flex flex-wrap items-center gap-4">
                <FilterSelect
                  label="Location"
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                >
                  <option value="All">All Locations</option>
                  {storeInfo.locations?.map((location) => (
                    <option key={location._id} value={location.name}>
                      {location.name}
                    </option>
                  ))}
                </FilterSelect>

                <FilterSelect
                  label="Time period"
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                >
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="week">This Week</option>
                  <option value="lastWeek">Last Week</option>
                  <option value="month">This Month</option>
                  <option value="lastMonth">Last Month</option>
                  <option value="custom">Custom Period</option>
                </FilterSelect>

                <div className="h-9 w-px bg-gray-200 hidden sm:block" />

                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-medium text-gray-600 shadow-sm transition hover:bg-white hover:border-gray-300 hover:text-gray-900 hover:shadow disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={fetchDashboardData}
                  disabled={loading}
                  title="Refresh dashboard data"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>
          </div>

          {selectedPeriod === "custom" && (
            <div className="grid grid-cols-1 gap-3 border-b border-gray-200 px-4 py-4 sm:grid-cols-2 sm:px-5">
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-[0.16em] text-gray-500">
                  Start Date
                </span>
                <input
                  type="date"
                  className="w-full border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  style={{ borderRadius: 'var(--radius-lg)' }}
                  value={customDateRange.startDate}
                  onChange={(e) =>
                    setCustomDateRange((prev) => ({
                      ...prev,
                      startDate: e.target.value,
                    }))
                  }
                />
              </label>

              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-[0.16em] text-gray-500">
                  End Date
                </span>
                <input
                  type="date"
                  className="w-full border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  style={{ borderRadius: 'var(--radius-lg)' }}
                  value={customDateRange.endDate}
                  onChange={(e) =>
                    setCustomDateRange((prev) => ({
                      ...prev,
                      endDate: e.target.value,
                    }))
                  }
                />
              </label>
            </div>
          )}

          {loading ? (
            <div className="px-4 py-10 sm:px-5">
              <Loader size="md" text="Loading dashboard..." progress={progress} />
            </div>
          ) : (
            <div
              className={`grid grid-cols-1 divide-y divide-gray-200 sm:divide-y-0 sm:divide-x sm:grid-cols-2 ${
                kpis.heldCount > 0 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
              }`}
            >
              <MetricCard
                label="Sales"
                value={formatCurrency(kpis.sales)}
                trend={salesTrend}
                comparisonLabel={comparisonLabel}
                linkLabel="Sales breakdown"
                onClick={() => router.push("/reporting/reporting")}
              />
              <MetricCard
                label="Transactions"
                value={formatNumber(kpis.transactions)}
                trend={txTrend}
                comparisonLabel={comparisonLabel}
                linkLabel="Transactions report"
                onClick={() => router.push("/reporting/completed-transactions")}
              />
              <MetricCard
                label="Avg. transaction value"
                value={formatCurrency(kpis.avg.toFixed(2))}
                trend={avgTrend}
                comparisonLabel={comparisonLabel}
              />
              {kpis.heldCount > 0 && (
                <MetricCard
                  label="Held transactions"
                  value={`${kpis.heldCount} (${formatCurrency(kpis.heldTotal)})`}
                  detail="Excluded from sales and average KPIs"
                  linkLabel="Transactions report"
                  onClick={() => router.push("/reporting/completed-transactions")}
                />
              )}
            </div>
          )}
        </section>

        {!loading && (
          <>
            {/* TIME PERIOD COMPARISON (collapsible) */}
            <section
              className="overflow-hidden border border-gray-200 bg-white"
              style={{ borderRadius: "var(--radius-lg)" }}
            >
              <button
                type="button"
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                onClick={() => setShowComparison((v) => !v)}
              >
                <div>
                  <h2 className="text-base font-bold tracking-tight text-gray-900">
                    Time Period Comparison
                  </h2>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {PERIOD_LABELS[selectedPeriod] || "Current period"} vs {COMPARISON_LABELS[selectedPeriod]?.replace("vs ", "") || "previous period"}
                  </p>
                </div>
                {showComparison
                  ? <ChevronUp className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  : <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                }
              </button>

              {showComparison && (() => {
                const currTotal = kpis.sales;
                const prevTotal = prevKpis.sales;
                const diffVal = currTotal - prevTotal;
                const diffPct = prevTotal > 0 ? ((diffVal / prevTotal) * 100).toFixed(1) : null;
                const cmpLbl = COMPARISON_LABELS[selectedPeriod]?.replace("vs ", "") || "Previous period";
                const currLbl = PERIOD_LABELS[selectedPeriod] || "Current";
                return (
                  <div className="border-t border-gray-200 px-5 pb-5 pt-4">
                    {/* Summary Cards */}
                    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                        <p className="text-xs font-medium text-sky-600">{currLbl}</p>
                        <p className="mt-1 text-xl font-bold text-sky-800">{formatCurrency(currTotal)}</p>
                        <p className="mt-0.5 text-xs text-sky-400">{kpis.transactions} transactions</p>
                      </div>
                      <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
                        <p className="text-xs font-medium text-purple-600">{cmpLbl}</p>
                        <p className="mt-1 text-xl font-bold text-purple-800">{formatCurrency(prevTotal)}</p>
                        <p className="mt-0.5 text-xs text-purple-400">{prevKpis.transactions} transactions</p>
                      </div>
                      <div className={`rounded-xl border p-4 ${diffVal >= 0 ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                        <p className={`text-xs font-medium ${diffVal >= 0 ? "text-emerald-600" : "text-red-500"}`}>Difference</p>
                        <p className={`mt-1 text-xl font-bold ${diffVal >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                          {diffVal >= 0 ? "+" : ""}{formatCurrency(diffVal)}
                        </p>
                      </div>
                      <div className={`rounded-xl border p-4 ${diffVal >= 0 ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                        <p className={`text-xs font-medium ${diffVal >= 0 ? "text-emerald-600" : "text-red-500"}`}>Change</p>
                        <p className={`mt-1 text-xl font-bold ${diffVal >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                          {diffPct !== null ? `${diffVal >= 0 ? "+" : ""}${diffPct}%` : "N/A"}
                        </p>
                      </div>
                    </div>

                    {/* Comparison Line Chart */}
                    <div className="h-[280px] sm:h-[320px]">
                      <Line
                        data={{
                          labels: comparisonChartData.labels,
                          datasets: [
                            {
                              label: currLbl,
                              data: comparisonChartData.curr,
                              borderColor: "#0ea5e9",
                              backgroundColor: "rgba(14,165,233,0.1)",
                              fill: true,
                              tension: 0.4,
                              pointRadius: comparisonChartData.labels.length <= 31 ? 3 : 1,
                              borderWidth: 2,
                            },
                            {
                              label: cmpLbl,
                              data: comparisonChartData.prev,
                              borderColor: "#8b5cf6",
                              backgroundColor: "rgba(139,92,246,0.07)",
                              fill: true,
                              tension: 0.4,
                              pointRadius: comparisonChartData.labels.length <= 31 ? 3 : 1,
                              borderWidth: 2,
                              borderDash: [5, 3],
                            },
                          ],
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: {
                              position: "top",
                              labels: { usePointStyle: true, padding: 16, font: { size: 11 } },
                            },
                            tooltip: {
                              callbacks: {
                                label: (ctx) => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`,
                              },
                            },
                          },
                          scales: {
                            y: {
                              beginAtZero: true,
                              ticks: {
                                callback: (v) => formatCurrency(Number(v || 0)),
                                font: { size: 10 },
                              },
                            },
                            x: {
                              grid: { display: false },
                              ticks: { font: { size: 10 } },
                            },
                          },
                        }}
                      />
                    </div>

                  </div>
                );
              })()}
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <TopProductsTable
                products={topProductsWithTrend}
                comparisonLabel={comparisonLabel}
                onViewMore={() => router.push("/reporting/reporting")}
              />

              <ChartCard
                title="Expenses Breakdown"
                onViewMore={() => router.push("/expenses/analysis")}
              >
                <Bar data={expenseChart} />
              </ChartCard>
            </section>

            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ListCard
                title="Recent Orders"
                emptyMessage={
                  selectedLocation === "All"
                    ? "No data available"
                    : "No location-tagged orders available for this location."
                }
                items={recentOrders.slice(0, 10).map((order) => ({
                  label: getOrderCustomerDisplayName(order),
                  meta: formatCurrency(order.total),
                }))}
              />

              <ListCard
                title="Top Staff"
                items={topStaff.map((staffItem) => ({
                  label: staffItem.staff,
                  meta: formatCurrency(staffItem.total),
                }))}
              />

              <ListCard
                title="Expenses"
                items={filteredExpenses.map((expense) => ({
                  label: expense.title,
                  meta: formatCurrency(expense.amount),
                }))}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/* =======================
   UI COMPONENTS
======================= */
function QuickActionTile({ label, icon: Icon, onClick }) {
  return (
    <button
      type="button"
      className="group flex items-center justify-between border border-gray-200 bg-white px-5 py-4 text-left transition-colors hover:border-gray-300 hover:bg-gray-50"
      style={{ borderRadius: 'var(--radius-lg)' }}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center border border-gray-200 bg-gray-50 text-gray-700"
          style={{ borderRadius: 'var(--radius-md)' }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold text-gray-900">{label}</span>
      </div>
      <ArrowRight className="h-4 w-4 flex-shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-gray-600" />
    </button>
  );
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <div className="relative min-w-[170px]">
      <span className="absolute left-3 -top-2.5 bg-white px-1.5 text-[11px] font-semibold text-gray-400 z-10 leading-none tracking-wide uppercase">
        {label}
      </span>
      <div className="relative border border-gray-200 bg-white shadow-sm px-3 py-2" style={{ borderRadius: 6 }}>
        <select
          className="w-full appearance-none bg-transparent pr-6 text-sm font-medium text-gray-800 outline-none cursor-pointer"
          value={value}
          onChange={onChange}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
      </div>
    </div>
  );
}

function MetricCard({ label, value, trend, comparisonLabel, detail, linkLabel, onClick }) {
  return (
    <div className="flex flex-col px-5 py-5">
      <div className="text-sm font-medium text-gray-600">{label}</div>
      <div className="mt-2 text-[1.85rem] font-bold leading-none tracking-tight text-gray-900 sm:text-[2.1rem]">
        {value}
      </div>
      {trend ? (
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold ${
              trend.direction === 'up'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-700'
            }`}
          >
            {trend.direction === 'up' ? (
              <TrendingUp className="h-3 w-3 flex-shrink-0" />
            ) : (
              <TrendingDown className="h-3 w-3 flex-shrink-0" />
            )}
            {trend.label}
          </span>
          {comparisonLabel && (
            <span className="text-xs text-gray-400">{comparisonLabel}</span>
          )}
        </div>
      ) : detail ? (
        <div className="mt-2 text-sm text-gray-500">{detail}</div>
      ) : null}
      {linkLabel && onClick ? (
        <button
          type="button"
          className="mt-auto pt-4 text-left text-sm font-semibold transition hover:opacity-75"
          style={{ color: 'var(--btn-primary-bg, #0284c7)' }}
          onClick={onClick}
        >
          {linkLabel}
        </button>
      ) : (
        <div className="mt-auto pt-3" />
      )}
    </div>
  );
}

function TrendBadge({ trend }) {
  if (!trend) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-gray-400">
        <Minus className="h-3 w-3" /> 0%
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
        trend.direction === 'up' ? 'text-emerald-600' : 'text-red-600'
      }`}
    >
      {trend.direction === 'up' ? (
        <TrendingUp className="h-3.5 w-3.5 flex-shrink-0" />
      ) : (
        <TrendingDown className="h-3.5 w-3.5 flex-shrink-0" />
      )}
      {trend.label}
    </span>
  );
}

function TopProductsTable({ products, comparisonLabel, onViewMore }) {
  return (
    <div
      className="border border-gray-200 bg-white overflow-hidden flex flex-col"
      style={{ borderRadius: 'var(--radius-lg)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3.5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-bold text-gray-900">Top Products By Quantity</h2>
        </div>
        <div className="flex items-center gap-2">
          {onViewMore && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-white hover:border-gray-300"
              style={{ borderRadius: 'var(--radius-md)' }}
              onClick={onViewMore}
            >
              <span className="text-gray-400 text-[10px]">&#9646;&#9646;</span> VIEW REPORT
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-4 py-2.5 text-left font-semibold text-gray-500 w-8">#</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-500">PRODUCT</th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500">
                QTY{" "}
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gray-300 text-[9px] font-bold text-white cursor-default" title="Units sold in selected period">i</span>
              </th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500">
                AMOUNT{" "}
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gray-300 text-[9px] font-bold text-white cursor-default" title="Revenue in selected period">i</span>
              </th>
              <th className="px-3 py-2.5 text-right font-semibold text-gray-500">
                TREND{" "}
                <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-gray-300 text-[9px] font-bold text-white cursor-default" title={comparisonLabel || 'vs previous period'}>i</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {products.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400 italic">
                  No sales data for this period
                </td>
              </tr>
            ) : (
              products.map((p, idx) => (
                <tr key={p.key} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-2.5 text-gray-500 font-medium">{idx + 1}</td>
                  <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[180px] truncate" title={p.name}>
                    {p.name}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-semibold ${
                    idx < 3 ? 'text-orange-500' : 'text-gray-800'
                  }`}>
                    {formatNumber(p.unitsSold)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-700 font-medium">
                    {formatCurrency(p.totalSales)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <TrendBadge trend={p.qtyTrend} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer note */}
      <div className="border-t border-gray-100 px-4 py-2 text-right flex-shrink-0">
        <span className="text-[10px] italic text-gray-400">
          Note: only standard products, refunds excluded
        </span>
      </div>
    </div>
  );
}

function ChartCard({ title, children, onViewMore }) {
  return (
    <div className="border border-gray-200 bg-white p-4 sm:p-5" style={{ borderRadius: 'var(--radius-lg)' }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {onViewMore && (
          <button
            type="button"
            className="btn-action-secondary !py-1.5 !px-3 text-xs"
            onClick={onViewMore}
          >
            View More
          </button>
        )}
      </div>
      <div className="h-[200px] sm:h-[250px] md:h-[300px] overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function ListCard({ title, items, emptyMessage = 'No data available' }) {
  return (
    <motion.div
      className="border border-gray-200 bg-white p-4 sm:p-5 flex flex-col h-[250px] sm:h-[280px] md:h-[320px]"
      style={{ borderRadius: 'var(--radius-lg)' }}
    >
      <h2 className="text-sm font-semibold mb-3 text-gray-900 flex-shrink-0">{title}</h2>
      <ul className="space-y-1.5 overflow-y-auto flex-1">
        {items.length ? (
          items.map((i, idx) => (
            <li
              key={idx}
              className="flex items-center justify-between p-2.5 border border-gray-200 bg-gray-50 text-xs hover:bg-gray-100 transition-colors"
              style={{ borderRadius: 'var(--radius-md)' }}
            >
              <span className="font-medium text-gray-900 truncate">{i.label}</span>
              <span className="text-gray-600 ml-2 flex-shrink-0">{i.meta}</span>
            </li>
          ))
        ) : (
          <li className="text-gray-400 italic text-xs py-8 text-center">{emptyMessage}</li>
        )}
      </ul>
    </motion.div>
  );
}




