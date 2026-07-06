import { mongooseConnect } from "@/lib/mongodb";
import { ensureAccountingEntriesSynced } from "@/lib/accounting";
import JournalEntry from "@/models/JournalEntry";
import Account from "@/models/Account";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  await mongooseConnect();

  try {
    // Trigger sync in background - don't block page load
    ensureAccountingEntriesSynced().catch(() => {});

    const { report, from, to, accountId } = req.query;

    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);

    // ───── TRIAL BALANCE ─────
    if (report === "trial-balance") {
      const accounts = await Account.find({ isActive: true }).sort({ code: 1 }).lean();
      const postedFilter = { status: "POSTED" };
      if (from || to) postedFilter.date = dateFilter;

      const entries = await JournalEntry.find(postedFilter, { lines: 1 }).lean();

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
      const postedFilter = { status: "POSTED" };
      if (from || to) postedFilter.date = dateFilter;

      const entries = await JournalEntry.find(postedFilter, { lines: 1 }).lean();
      const accounts = await Account.find({ isActive: true, type: { $in: ["REVENUE", "EXPENSE"] } }).sort({ code: 1 }).lean();

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
        const amount = Math.round(Math.abs(bal.credit - bal.debit) * 100) / 100;
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
      const postedFilter = { status: "POSTED" };
      if (to) postedFilter.date = { $lte: new Date(to) };

      const entries = await JournalEntry.find(postedFilter, { lines: 1 }).lean();
      const accounts = await Account.find({ isActive: true, type: { $in: ["ASSET", "LIABILITY", "EQUITY"] } }).sort({ code: 1 }).lean();

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

        const row = { code: acc.code, name: acc.name, subType: acc.subType, amount };

        if (acc.type === "ASSET") {
          assets.push(row);
          totalAssets += amount;
        } else if (acc.type === "LIABILITY") {
          liabilities.push(row);
          totalLiabilities += Math.abs(amount);
        } else {
          equity.push(row);
          totalEquity += Math.abs(amount);
        }
      }

      // Add net income to retained earnings
      const revenueAccounts = await Account.find({ isActive: true, type: "REVENUE" }).lean();
      const expenseAccounts = await Account.find({ isActive: true, type: "EXPENSE" }).lean();
      let netIncome = 0;
      for (const acc of [...revenueAccounts, ...expenseAccounts]) {
        const bal = balances[acc._id.toString()] || { debit: 0, credit: 0 };
        if (acc.type === "REVENUE") netIncome += (bal.credit - bal.debit);
        else netIncome -= (bal.debit - bal.credit);
      }
      netIncome = Math.round(netIncome * 100) / 100;

      if (netIncome !== 0) {
        equity.push({ code: "", name: "Net Income (Current Period)", subType: "Retained Earnings", amount: -netIncome });
        totalEquity += Math.abs(netIncome);
      }

      return res.status(200).json({
        success: true,
        assets,
        liabilities,
        equity,
        totalAssets: Math.round(totalAssets * 100) / 100,
        totalLiabilities: Math.round(totalLiabilities * 100) / 100,
        totalEquity: Math.round(totalEquity * 100) / 100,
      });
    }

    // ───── GENERAL LEDGER ─────
    if (report === "general-ledger") {
      if (!accountId) {
        return res.status(400).json({ success: false, message: "accountId is required for general ledger" });
      }

      const account = await Account.findById(accountId).lean();
      if (!account) return res.status(404).json({ success: false, message: "Account not found" });

      const postedFilter = { status: "POSTED", "lines.account": accountId };
      if (from || to) postedFilter.date = dateFilter;

      let openingBalance = account.openingBalance || 0;
      if (from) {
        const openingEntries = await JournalEntry.find({
          status: "POSTED",
          "lines.account": accountId,
          date: { $lt: new Date(from) },
        }, { lines: 1 }).lean();

        for (const entry of openingEntries) {
          for (const line of entry.lines) {
            if (line.account.toString() !== accountId) continue;
            if (account.normalBalance === "DEBIT") {
              openingBalance += (line.debit - line.credit);
            } else {
              openingBalance += (line.credit - line.debit);
            }
          }
        }
      }

      const entries = await JournalEntry.find(postedFilter)
        .sort({ date: 1, createdAt: 1 })
        .lean();

      // Build ledger rows with running balance
      let runningBalance = openingBalance;
      const rows = [];

      for (const entry of entries) {
        for (const line of entry.lines) {
          if (line.account.toString() !== accountId) continue;
          
          if (account.normalBalance === "DEBIT") {
            runningBalance += (line.debit - line.credit);
          } else {
            runningBalance += (line.credit - line.debit);
          }

          rows.push({
            date: entry.date,
            entryNumber: entry.entryNumber,
            entryId: entry._id,
            description: entry.description,
            lineDescription: line.description,
            debit: line.debit,
            credit: line.credit,
            balance: Math.round(runningBalance * 100) / 100,
            reference: entry.reference,
            referenceType: entry.referenceType,
          });
        }
      }

      return res.status(200).json({
        success: true,
        account: { _id: account._id, code: account.code, name: account.name, type: account.type },
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
