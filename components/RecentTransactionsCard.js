import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import {
  TRANSACTION_TABS,
  countTransactionTabs,
  recentTransactions,
  transactionItems,
  transactionLabel,
  transactionStaffName,
  transactionTenders,
  transactionWhen,
} from "@/lib/transactionFeed";

/**
 * The latest sales on the dashboard.
 *
 * Small tabs split them into completed, held and voided, and a row opens to show how
 * the sale was paid and what was on it — the two things you would otherwise open the
 * report to see. It reads the transactions the dashboard already loaded for the
 * chosen period and location, so it costs no extra request.
 */
export default function RecentTransactionsCard({ transactions = [], limit = 8, onViewMore }) {
  const [tab, setTab] = useState("completed");
  const [openId, setOpenId] = useState(null);

  const counts = useMemo(() => countTransactionTabs(transactions), [transactions]);
  const rows = useMemo(() => recentTransactions(transactions, tab, limit), [transactions, tab, limit]);
  const activeTab = TRANSACTION_TABS.find((entry) => entry.key === tab) || TRANSACTION_TABS[0];

  const switchTab = (key) => {
    setTab(key);
    setOpenId(null);
  };

  return (
    <motion.div
      className="border border-gray-200 bg-white p-4 sm:p-5 flex flex-col h-[360px] sm:h-[420px]"
      style={{ borderRadius: "var(--radius-lg)" }}
    >
      <div className="flex items-center justify-between gap-2 mb-3 flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-900">Transactions</h2>
          {/* Mini tabs: which sales to show, and how many there are in the period */}
          <div className="flex items-center gap-1">
            {TRANSACTION_TABS.map((entry) => {
              const isActive = entry.key === tab;
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => switchTab(entry.key)}
                  className={`px-2 py-1 text-[11px] font-medium border transition-colors ${
                    isActive
                      ? "border-gray-800 bg-gray-900 text-white"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                  style={{ borderRadius: "var(--radius-md)" }}
                >
                  {entry.label}
                  <span className={isActive ? "ml-1 text-gray-300" : "ml-1 text-gray-400"}>{counts[entry.key]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onViewMore?.(activeTab.reportStatus)}
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors flex-shrink-0"
        >
          More <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      <ul className="space-y-1.5 overflow-y-auto flex-1">
        {rows.length > 0 ? (
          rows.map((tx) => {
            const isOpen = openId === tx._id;
            const staff = transactionStaffName(tx);
            const when = transactionWhen(tx);
            const tenders = transactionTenders(tx);
            const items = transactionItems(tx);

            return (
              <li
                key={tx._id}
                className="border border-gray-200 bg-gray-50 text-xs overflow-hidden"
                style={{ borderRadius: "var(--radius-md)" }}
              >
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : tx._id)}
                  className="w-full flex items-center justify-between gap-2 p-2.5 text-left hover:bg-gray-100 transition-colors"
                >
                  <span className="min-w-0 flex items-center gap-2">
                    {isOpen ? (
                      <ChevronUp className="h-3 w-3 flex-shrink-0 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-3 w-3 flex-shrink-0 text-gray-400" />
                    )}
                    <span className="min-w-0">
                      <span className="block font-medium text-gray-900 truncate">{transactionLabel(tx)}</span>
                      {(staff || when || items.length > 0) && (
                        <span className="block text-[11px] text-gray-500 truncate">
                          {[when, staff, items.length ? `${items.length} item${items.length === 1 ? "" : "s"}` : ""]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </span>
                  </span>
                  <span
                    className={`flex-shrink-0 font-semibold tabular-nums ${
                      tab === "void" ? "text-red-500 line-through" : "text-gray-700"
                    }`}
                  >
                    {formatCurrency(tx.total)}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-gray-200 bg-white px-3 py-2.5 space-y-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Tender</p>
                      {tenders.length > 0 ? (
                        <ul className="space-y-0.5">
                          {tenders.map((tender, index) => (
                            <li key={index} className="flex items-center justify-between gap-2 text-gray-700">
                              <span className="truncate">{tender.label}</span>
                              <span className="tabular-nums flex-shrink-0">{formatCurrency(tender.amount)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-gray-400 italic">Not recorded</p>
                      )}
                      {Number(tx.change) > 0 && (
                        <p className="flex items-center justify-between gap-2 text-gray-500 mt-0.5">
                          <span>Change</span>
                          <span className="tabular-nums">{formatCurrency(tx.change)}</span>
                        </p>
                      )}
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Items</p>
                      {items.length > 0 ? (
                        <ul className="space-y-0.5">
                          {items.map((item, index) => (
                            <li key={index} className="flex items-center justify-between gap-2 text-gray-700">
                              <span className="truncate">
                                {item.name}
                                <span className="text-gray-400"> × {item.quantity}</span>
                              </span>
                              <span className="tabular-nums flex-shrink-0">{formatCurrency(item.total)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-gray-400 italic">No items recorded</p>
                      )}
                    </div>

                    {(Number(tx.discount) > 0 || tx.location) && (
                      <p className="flex items-center justify-between gap-2 text-[11px] text-gray-500 pt-1 border-t border-gray-100">
                        <span>{tx.location || ""}</span>
                        {Number(tx.discount) > 0 && <span>Discount {formatCurrency(tx.discount)}</span>}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })
        ) : (
          <li className="text-gray-400 italic text-xs py-8 text-center">
            No {activeTab.label.toLowerCase()} transactions in this period
          </li>
        )}
      </ul>
    </motion.div>
  );
}
