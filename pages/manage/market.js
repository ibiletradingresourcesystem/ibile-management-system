import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { ClipboardList, History, Store } from "lucide-react";
import Layout from "@/components/Layout";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/useAuth";
import { isBasicStaffRole } from "@/lib/permission-utils";
import { showToastMessage } from "@/lib/toast-state";
import MarketListTab from "@/components/market/MarketListTab";
import MarketHistoryTab from "@/components/market/MarketHistoryTab";
import MarketSetupTab from "@/components/market/MarketSetupTab";

const TABS = [
  { key: "list", label: "Next list", short: "Next list", icon: ClipboardList },
  { key: "history", label: "Market lists", short: "Lists", icon: History },
  { key: "setup", label: "Vendors & sections", short: "Setup", icon: Store },
];

// Where the product form leaves the product just created (components/ProductForm.js)
const PENDING_PRODUCT_KEY = "vendors:pendingProduct";

/**
 * Market: buying done in person at a market, from market vendors grouped by the section of the
 * market they trade in. Staff add what is needed to the next list (it sorts itself by vendor);
 * generating it gives the list to take; what was not in the system is added after buying.
 */
export default function MarketPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canSetup = Boolean(user) && !isBasicStaffRole(user.role);
  const [tab, setTab] = useState("list");
  const [openListId, setOpenListId] = useState(null);
  const [setup, setSetup] = useState({ markets: [], vendors: [] });

  const loadSetup = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/api/market/setup");
      setSetup({ markets: data.markets || [], vendors: data.vendors || [] });
    } catch {
      // The tabs say what they could not load
    }
  }, []);

  useEffect(() => {
    loadSetup();
  }, [loadSetup]);

  // Coming back from the product form: link the "other" item to the product just made
  useEffect(() => {
    if (!router.isReady) return;
    const { tab: queryTab, list, linkItem } = router.query;
    if (queryTab && TABS.some((t) => t.key === queryTab)) setTab(String(queryTab));
    if (list) setOpenListId(String(list));
    if (!linkItem) return;

    let pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING_PRODUCT_KEY) || "null");
      sessionStorage.removeItem(PENDING_PRODUCT_KEY);
    } catch {
      pending = null;
    }
    const productId = pending?.product?._id;
    const clean = () => router.replace({ pathname: "/manage/market", query: { tab: "history", ...(list ? { list } : {}) } }, undefined, { shallow: true });
    if (!productId) {
      clean();
      return;
    }
    apiClient
      .put(`/api/market/list/${linkItem}`, { productId })
      .then(() => {
        showToastMessage({ title: "Market", text: `${pending.product.name || "The product"} is in the system now`, fallbackTone: "success" });
        loadSetup();
      })
      .catch((error) => {
        showToastMessage({ title: "Market", text: error?.response?.data?.error || "The product was made, but could not be linked to the list.", fallbackTone: "danger" });
      })
      .finally(clean);
  }, [router.isReady, router.query, router, loadSetup]);

  const changeTab = (key) => {
    setTab(key);
    if (key !== "history") setOpenListId(null);
    router.replace({ pathname: "/manage/market", query: key === "list" ? {} : { tab: key } }, undefined, { shallow: true });
  };

  return (
    <Layout title="Market">
      <div className="page-container">
        {/* The same column as Vendors and Purchase Orders beside it */}
        <div className="page-content">
          <div className="page-header">
            <div>
              <h1 className="page-title">Market</h1>
              <p className="page-subtitle">What to buy at the market, sorted by section and vendor.</p>
            </div>
          </div>

          <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border theme-border-soft bg-white p-1" role="tablist">
            {TABS.map(({ key, label, short, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => changeTab(key)}
                className={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${tab === key ? "theme-badge-soft" : "text-gray-600 hover:bg-gray-50"}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          {tab === "list" && (
            <MarketListTab
              setup={setup}
              canSetup={canSetup}
              onOpenSetup={() => changeTab("setup")}
              onGenerated={(list) => {
                setTab("history");
                setOpenListId(String(list._id));
                router.replace({ pathname: "/manage/market", query: { tab: "history", list: String(list._id) } }, undefined, { shallow: true });
              }}
            />
          )}
          {tab === "history" && (
            <MarketHistoryTab
              setup={setup}
              openListId={openListId}
              onListChange={(id) => {
                setOpenListId(id);
                router.replace({ pathname: "/manage/market", query: id ? { tab: "history", list: id } : { tab: "history" } }, undefined, { shallow: true });
              }}
              onCarried={(count) => {
                showToastMessage({ title: "Market", text: `${count} item${count === 1 ? "" : "s"} put on the next list`, fallbackTone: "success" });
                changeTab("list");
              }}
            />
          )}
          {tab === "setup" && <MarketSetupTab setup={setup} reload={loadSetup} canSetup={canSetup} />}
        </div>
      </div>
    </Layout>
  );
}
