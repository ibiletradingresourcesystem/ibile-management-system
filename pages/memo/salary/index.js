import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import SalaryMemo from "@/components/SalaryMemo";
import { apiClient } from "@/lib/api-client";
import { payrollRow, payrollTotal } from "@/lib/payroll";

/**
 * The payroll transfer memo for one table of staff.
 *
 * Who is on it comes from the URL (`?ids=…&part=1&of=2`), not from browser storage,
 * so the page can be refreshed, kept open in a tab or sent to someone else and still
 * show the same people. The figures are re-read from the staff records each time, so
 * a memo opened after a penalty was recorded shows what is really owed.
 */
export default function SalaryMemoPage() {
  const router = useRouter();
  const memoRef = useRef();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [directors, setDirectors] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedDirector, setSelectedDirector] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("");

  const part = Number(router.query.part) || 1;
  const partCount = Number(router.query.of) || 1;

  useEffect(() => {
    if (!router.isReady) return;

    const ids = String(router.query.ids || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      setError("This memo link has no staff on it. Open it again from Manage Staff.");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const [staffRes, setupRes] = await Promise.all([
          apiClient.get("/api/staff"),
          apiClient.get("/api/setup/get").catch(() => null),
        ]);

        const all = Array.isArray(staffRes.data) ? staffRes.data : staffRes.data?.data || [];
        const wanted = new Set(ids);
        // Kept in the order the memo was opened with, so part 2 is not part 1 reshuffled.
        const found = ids.map((id) => all.find((staff) => String(staff._id) === id)).filter(Boolean);
        setRows(found.map(payrollRow));

        const missing = ids.filter((id) => !all.some((staff) => String(staff._id) === id));
        if (missing.length > 0 && found.length === 0) {
          setError("Those staff records could not be found. They may have been deleted.");
        }
        if (wanted.size !== ids.length) {
          // The same person twice in one memo would be paid twice.
          setError("This memo link lists the same person more than once.");
        }

        const store = setupRes?.data?.store;
        const directorList = [...(store?.memoDirectors || [])];
        if (store?.directorName && !directorList.includes(store.directorName)) directorList.unshift(store.directorName);
        const accountList = [...(store?.memoAccounts || [])];
        if (store?.companyAccountName && !accountList.some((a) => a.accountName === store.companyAccountName)) {
          accountList.unshift({
            accountName: store.companyAccountName,
            accountNumber: store.companyAccountNumber,
            bankName: store.companyBankName,
          });
        }
        setDirectors(directorList);
        setAccounts(accountList);
        if (directorList.length > 0) setSelectedDirector(directorList[0]);
        if (accountList.length > 0) setSelectedAccount(accountList[0].accountNumber || accountList[0].accountName || "");
      } catch (err) {
        console.error("Failed to load the salary memo:", err);
        setError(err.response?.data?.error || "Could not load the staff records for this memo.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router.isReady, router.query.ids]);

  const total = useMemo(() => payrollTotal(rows), [rows]);
  const incomplete = rows.filter((row) => !row.accountNumber || !row.bankName);

  if (loading) return <div className="p-10 text-center text-gray-500">Loading memo…</div>;
  if (error && rows.length === 0) return <div className="p-10 text-center text-red-600">{error}</div>;

  return (
    <>
      <Head>
        <title>Salary Memo</title>
      </Head>
      <div className="pb-5">
        <div className="mt-5 pb-3 print:hidden">
          <div className="flex flex-wrap items-end justify-center gap-4 max-w-4xl mx-auto px-4">
            <div className="flex flex-col w-full sm:w-64">
              <label className="text-sm font-medium text-gray-700 mb-1">Debit account</label>
              {accounts.length > 0 ? (
                <select
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  className="w-full px-4 py-2 text-sm border border-gray-300 rounded-md shadow-sm"
                >
                  {accounts.map((account) => {
                    const value = account.accountNumber || account.accountName || "";
                    return (
                      <option key={value} value={value}>
                        {[account.accountNumber, account.accountName, account.bankName].filter(Boolean).join(" — ")}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <input
                  value={selectedAccount}
                  onChange={(e) => setSelectedAccount(e.target.value)}
                  placeholder="Account to debit"
                  className="w-full px-4 py-2 text-sm border border-gray-300 rounded-md shadow-sm"
                />
              )}
            </div>

            <div className="flex flex-col w-full sm:w-64">
              <label className="text-sm font-medium text-gray-700 mb-1">Signed by</label>
              {directors.length > 0 ? (
                <select
                  value={selectedDirector}
                  onChange={(e) => setSelectedDirector(e.target.value)}
                  className="w-full px-4 py-2 text-sm border border-gray-300 rounded-md shadow-sm"
                >
                  {directors.map((director) => (
                    <option key={director} value={director}>
                      {director}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={selectedDirector}
                  onChange={(e) => setSelectedDirector(e.target.value)}
                  placeholder="Director's name"
                  className="w-full px-4 py-2 text-sm border border-gray-300 rounded-md shadow-sm"
                />
              )}
            </div>

            <button
              onClick={() => memoRef.current?.generatePDF()}
              disabled={downloading || rows.length === 0}
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-md shadow transition disabled:opacity-50"
            >
              {downloading ? "Preparing…" : "Download PDF"}
            </button>
            <button
              onClick={() => window.print()}
              className="w-full sm:w-auto border border-gray-300 text-gray-700 font-medium px-6 py-2.5 rounded-md shadow-sm hover:bg-gray-50 transition"
            >
              Print
            </button>
          </div>

          <div className="max-w-4xl mx-auto px-4 mt-3 space-y-1 text-center">
            <p className="text-sm text-gray-600">
              {rows.length} staff · ₦{total.toLocaleString()}
              {partCount > 1 ? ` · part ${part} of ${partCount}` : ""}
            </p>
            {(accounts.length === 0 || directors.length === 0) && (
              <p className="text-xs text-amber-700">
                Set the company accounts and directors in Setup to have these filled in automatically.
              </p>
            )}
            {incomplete.length > 0 && (
              <p className="text-xs text-red-600">
                No account number or bank for: {incomplete.map((row) => row.name).join(", ")} — the bank cannot pay those.
              </p>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        </div>

        <SalaryMemo
          ref={memoRef}
          rows={rows}
          selectedAccount={selectedAccount}
          selectedDirector={selectedDirector}
          part={part}
          partCount={partCount}
          onDownloading={setDownloading}
        />
      </div>
    </>
  );
}
