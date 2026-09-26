import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import {
  TRANSACTION_TABS,
  countTransactionTabs,
  recentTransactions,
  transactionLabel,
  transactionStaffName,
  transactionWhen,
} from "@/lib/transactionFeed";

/**
 * The latest sales, on the dashboard beside the expenses card.
 *
 * Only the top few, with small tabs for completed, held and voided, and a More link
 * into the transactions report on the same tab. It reads the transactions the
 * dashboard already loaded for the chosen period and location, so it costs no extra
 * request and always agrees with the figures above it.
 */
export default function RecentTransactionsCard({ transactions = [], limit = 6, onViewMore }) {
  const [tab, setTab] = useState("completed");

  const counts = useMemo(() => countTransactionTabs(transactions), [transactions]);
  const rows = useMemo(() => recentTransactions(transactions, tab, limit), [transactions, tab, limit]);
  const activeTab = TRANSACTION_TABS.find((entry) => entry.key === tab) || TRANSACTION_TABS[0];

  return (
    <motion.div
      className="border border-gray-200 bg-white p-4 sm:p-5 flex flex-col h-[250px] sm:h-[280px] md:h-[320px]"
      style={{ borderRadius: "var(--radius-lg)" }}
    >
      <div className="flex items-center justify-between gap-2 mb-2 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-900">Transactions</h2>
        <button
          type="button"
          onClick={() => onViewMore?.(activeTab.reportStatus)}
          className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors"
        >
          More <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {/* Mini tabs: which sales to show, with how many there are in the period */}
      <div className="flex items-center gap-1 mb-3 flex-shrink-0">
        {TRANSACTION_TABS.map((entry) => {
          const isActive = entry.key === tab;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
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

      <ul className="space-y-1.5 overflow-y-auto flex-1">
        {rows.length > 0 ? (
          rows.map((tx) => {
            const staff = transactionStaffName(tx);
            const when = transactionWhen(tx);
            return (
              <li
                key={tx._id}
                className="flex items-center justify-between gap-2 p-2.5 border border-gray-200 bg-gray-50 text-xs hover:bg-gray-100 transition-colors"
                style={{ borderRadius: "var(--radius-md)" }}
              >
                <span className="min-w-0">
                  <span className="block font-medium text-gray-900 truncate">{transactionLabel(tx)}</span>
                  {(staff || when) && (
                    <span className="block text-[11px] text-gray-500 truncate">
                      {[when, staff].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
                <span
                  className={`flex-shrink-0 font-semibold tabular-nums ${
                    tab === "void" ? "text-red-500 line-through" : "text-gray-700"
                  }`}
                >
                  {formatCurrency(tx.total)}
                </span>
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
