import { mongooseConnect } from "@/lib/mongodb";
import Account from "@/models/Account";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { accountGuide, buildLiveEntries, entrySource } from "@/lib/accounting";
import { dayKeyOf, shopDaysBounds } from "@/lib/tradingDay";

/*
 * The statements are worked out from the records each time (lib/accounting.js buildLiveEntries):
 * the actual figures, never a copy posted earlier.
 */

/**
 * Accounts are read whether active or not: an account switched off still holds what was posted to
 * it, and leaving it out dropped one side of those entries, so the statements stopped balancing.
 */
const ALL_ACCOUNTS = {};

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  await mongooseConnect();

  try {
    const { report, from, to, accountId } = req.query;
    // "fresh=1" reads the records again rather than the last minute's copy
    const fresh = req.query.fresh === "1";

    // "From" and "To" are whole days in Lagos. Read as dates on the server they meant midnight UTC,
    // so everything on the "To" day after 1am was left out, and the first hour of "From" with it.
    const fromKey = from ? dayKeyOf(from) : null;
    const toKey = to ? dayKeyOf(to) : null;
    const periodStart = fromKey ? shopDaysBounds(fromKey).start : null;
    const periodEnd = toKey ? shopDaysBounds(toKey).end : null;

    // ───── TRIAL BALANCE ─────
    if (report === "trial-balance") {
      const accounts = await Account.find(ALL_ACCOUNTS).sort({ code: 1 }).lean();
      const entries = await buildLiveEntries({ start: periodStart, end: periodEnd, fresh });

      // Aggregate debits/credits per account
      const balances = {};
      for (const entry of entries) {
        for (const line of entry.lines) {
          const key = line.account.toString();
          if (!balances[key]) balances[key] = { debit: 0, credit: 0 };
          balances[key].debit += line.debit || 0;
          balances[key].credit += line.credit || 0;
        }
      }

      const rows = accounts.map((acc) => {
        const bal = balances[acc._id.toString()] || { debit: 0, credit: 0 };
        const opening = acc.openingBalance || 0;
        // Add opening balance based on normal balance
        if (acc.normalBalance === "DEBIT") {
          bal.debit += opening;
        } else {
          bal.credit += opening;
        }
        return {
          _id: acc._id,
          code: acc.code,
          name: acc.name,
          type: acc.type,
          normalBalance: acc.normalBalance,
          debit: Math.round(bal.debit * 100) / 100,
          credit: Math.round(bal.credit * 100) / 100,
          balance: Math.round((bal.debit - bal.credit) * 100) / 100,
        };
      }).filter((r) => r.debit !== 0 || r.credit !== 0);

      const totalDebit = Math.round(rows.reduce((s, r) => s + r.debit, 0) * 100) / 100;
      const totalCredit = Math.round(rows.reduce((s, r) => s + r.credit, 0) * 100) / 100;

      return res.status(200).json({ success: true, rows, totalDebit, totalCredit });
    }

    // ───── PROFIT & LOSS ─────
    if (report === "profit-loss") {
      const entries = await buildLiveEntries({ start: periodStart, end: periodEnd, fresh });
      const accounts = await Account.find({ ...ALL_ACCOUNTS, type: { $in: ["REVENUE", "EXPENSE"] } }).sort({ code: 1 }).lean();

      const balances = {};
      for (const entry of entries) {
        for (const line of entry.lines) {
          const key = line.account.toString();
          if (!balances[key]) balances[key] = { debit: 0, credit: 0 };
          balances[key].debit += line.debit || 0;
          balances[key].credit += line.credit || 0;
        }
      }

      const revenue = [];
      const expenses = [];
      let totalRevenue = 0;
      let totalExpenses = 0;
      let operatingRevenue = 0;
      let otherIncome = 0;
      let costOfSales = 0;
      let operatingExpenses = 0;
      let otherExpenses = 0;

      for (const acc of accounts) {
        const bal = balances[acc._id.toString()] || { debit: 0, credit: 0 };
        // Signed by the account's normal balance. Math.abs() here used to turn
        // a contra balance (a refund debited to revenue, a credited expense)
        // into a positive figure, which inflated both sides of the statement.
        const raw = acc.type === "REVENUE" ? bal.credit - bal.debit : bal.debit - bal.credit;
        const amount = Math.round(raw * 100) / 100;
        if (amount === 0) continue;

        const row = { code: acc.code, name: acc.name, subType: acc.subType, amount };

        if (acc.type === "REVENUE") {
          revenue.push(row);
          totalRevenue += amount;
          if (acc.subType === "Non-Operating Revenue" || acc.code === "4200") {
            otherIncome += amount;
          } else {
            operatingRevenue += amount;
          }
        } else {
          expenses.push(row);
          totalExpenses += amount;

          if (acc.code === "5000" || acc.subType === "Cost of Sales") {
            costOfSales += amount;
          } else if (!acc.subType || acc.subType === "Operating Expense") {
            operatingExpenses += amount;
          } else {
            otherExpenses += amount;
          }
        }
      }

      const grossProfit = Math.round((operatingRevenue - costOfSales) * 100) / 100;
      const operatingProfit = Math.round((grossProfit - operatingExpenses) * 100) / 100;
      const netIncome = Math.round((totalRevenue - totalExpenses) * 100) / 100;
      const grossMargin = operatingRevenue > 0 ? Math.round((grossProfit / operatingRevenue) * 10000) / 10000 : 0;
      const operatingMargin = operatingRevenue > 0 ? Math.round((operatingProfit / operatingRevenue) * 10000) / 10000 : 0;
      const netMargin = totalRevenue > 0 ? Math.round((netIncome / totalRevenue) * 10000) / 10000 : 0;

      return res.status(200).json({
        success: true,
        revenue,
        expenses,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalExpenses: Math.round(totalExpenses * 100) / 100,
        netIncome,
        summary: {
          operatingRevenue: Math.round(operatingRevenue * 100) / 100,
          otherIncome: Math.round(otherIncome * 100) / 100,
          costOfSales: Math.round(costOfSales * 100) / 100,
          operatingExpenses: Math.round(operatingExpenses * 100) / 100,
          otherExpenses: Math.round(otherExpenses * 100) / 100,
          grossProfit,
          operatingProfit,
          grossMargin,
          operatingMargin,
          netMargin,
        },
      });
    }

    // ───── BALANCE SHEET ─────
    if (report === "balance-sheet") {
      // Everything up to the balance sheet's date
      const entries = await buildLiveEntries({ end: periodEnd, fresh });
      const accounts = await Account.find({ ...ALL_ACCOUNTS, type: { $in: ["ASSET", "LIABILITY", "EQUITY"] } }).sort({ code: 1 }).lean();

      const balances = {};
      for (const entry of entries) {
        for (const line of entry.lines) {
          const key = line.account.toString();
          if (!balances[key]) balances[key] = { debit: 0, credit: 0 };
          balances[key].debit += line.debit || 0;
          balances[key].credit += line.credit || 0;
        }
      }

      const assets = [];
      const liabilities = [];
      const equity = [];
      let totalAssets = 0;
      let totalLiabilities = 0;
      let totalEquity = 0;

      for (const acc of accounts) {
        const bal = balances[acc._id.toString()] || { debit: 0, credit: 0 };
        const opening = acc.openingBalance || 0;
        if (acc.normalBalance === "DEBIT") bal.debit += opening;
        else bal.credit += opening;

        const amount = Math.round((bal.debit - bal.credit) * 100) / 100;
        if (amount === 0) continue;

        // `display` is the figure as the statement shows it, sign kept: an asset in credit (cash
        // paid out beyond what was recorded coming in), or a contra account, reads negative rather
        // than being shown as a positive the totals then disagreed with.
        const row = { code: acc.code, name: acc.name, subType: acc.subType, amount, display: acc.type === "ASSET" ? amount : -amount };

        if (acc.type === "ASSET") {
          assets.push(row);
          totalAssets += amount;
        } else if (acc.type === "LIABILITY") {
          liabilities.push(row);
          // Liabilities and equity are credit-normal, so their signed balance is
          // negative. Negating gives the positive figure a statement shows.
          // Math.abs() used to be applied instead, so a liability sitting in a
          // debit position (an overpaid supplier) still increased liabilities.
          totalLiabilities -= amount;
        } else {
          equity.push(row);
          totalEquity -= amount;
        }
      }

      // Add net income to retained earnings
      const revenueAccounts = await Account.find({ ...ALL_ACCOUNTS, type: "REVENUE" }).lean();
      const expenseAccounts = await Account.find({ ...ALL_ACCOUNTS, type: "EXPENSE" }).lean();
      let netIncome = 0;
      for (const acc of [...revenueAccounts, ...expenseAccounts]) {
        const bal = balances[acc._id.toString()] || { debit: 0, credit: 0 };
        if (acc.type === "REVENUE") netIncome += (bal.credit - bal.debit);
        else netIncome -= (bal.debit - bal.credit);
      }
      netIncome = Math.round(netIncome * 100) / 100;

      if (netIncome !== 0) {
        // Every profit and loss posted up to the balance sheet date: nothing closes it off into
        // retained earnings, so it is the profit to date, not this period's
        equity.push({ code: "", name: "Profit to date", subType: "Retained Earnings", amount: -netIncome, display: netIncome });
        // A loss has to reduce equity. Math.abs() used to be added here, so a
        // loss-making period inflated equity instead and the balance sheet
        // could not balance.
        totalEquity += netIncome;
      }

      const roundedAssets = Math.round(totalAssets * 100) / 100;
      const roundedLiabilities = Math.round(totalLiabilities * 100) / 100;
      const roundedEquity = Math.round(totalEquity * 100) / 100;

      return res.status(200).json({
        success: true,
        assets,
        liabilities,
        equity,
        totalAssets: roundedAssets,
        totalLiabilities: roundedLiabilities,
        totalEquity: roundedEquity,
        // Assets must equal liabilities plus equity. Surfacing the gap makes a
        // broken or half-synced ledger visible instead of silently wrong.
        balanceCheck: {
          balanced: Math.abs(roundedAssets - (roundedLiabilities + roundedEquity)) < 0.01,
          difference: Math.round((roundedAssets - (roundedLiabilities + roundedEquity)) * 100) / 100,
        },
      });
    }

    // ───── GENERAL LEDGER ─────
    if (report === "general-ledger") {
      if (!accountId) {
        return res.status(400).json({ success: false, message: "accountId is required for general ledger" });
      }

      const account = await Account.findById(accountId).lean();
      if (!account) return res.status(404).json({ success: false, message: "Account not found" });

      // Everything up to the end of the period: what came before it is the opening balance
      const entries = await buildLiveEntries({ end: periodEnd, fresh });
      const signed = (line) => (account.normalBalance === "DEBIT" ? line.debit - line.credit : line.credit - line.debit);

      let openingBalance = account.openingBalance || 0;
      let runningBalance = 0;
      const rows = [];

      for (const entry of entries) {
        const beforePeriod = periodStart && entry.date < periodStart;
        for (const line of entry.lines) {
          if (line.account.toString() !== accountId) continue;
          if (beforePeriod) {
            openingBalance += signed(line);
            continue;
          }

          runningBalance += signed(line);
          // Each line says which record it came from, and where to find it
          const source = entrySource(entry);
          rows.push({
            date: entry.date,
            description: entry.description,
            lineDescription: line.description,
            debit: line.debit,
            credit: line.credit,
            runningChange: runningBalance,
            reference: entry.reference,
            referenceType: entry.referenceType,
            referenceId: entry.referenceId,
            sourceLabel: source.label,
            sourceHref: source.href,
          });
        }
      }

      // The balance after each line, from the opening balance
      for (const row of rows) {
        row.balance = Math.round((openingBalance + row.runningChange) * 100) / 100;
        delete row.runningChange;
      }
      runningBalance += openingBalance;

      return res.status(200).json({
        success: true,
        account: { _id: account._id, code: account.code, name: account.name, type: account.type, guide: accountGuide(account.code) },
        openingBalance: Math.round(openingBalance * 100) / 100,
        rows,
        closingBalance: Math.round(runningBalance * 100) / 100,
      });
    }

    return res.status(400).json({ success: false, message: "Invalid report type. Use: trial-balance, profit-loss, balance-sheet, general-ledger" });
  } catch (error) {
    console.error("Accounting Reports API error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
}
