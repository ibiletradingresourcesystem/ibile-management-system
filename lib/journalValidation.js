/**
 * Shared validation for journal entry lines.
 *
 * The create endpoint checked that debits equalled credits, but the edit
 * endpoint assigned `entry.lines = lines` with no checks at all — so a draft
 * could be edited into an unbalanced state, posted, and quietly break the trial
 * balance. Both paths now run through here.
 */
import Account from "@/models/Account";

/**
 * Resolve each line's account and verify the entry balances.
 *
 * @param {Array} lines raw lines from the request body
 * @returns {Promise<{ok: true, lines: Array, totalDebit: number, totalCredit: number} | {ok: false, message: string}>}
 */
export async function resolveAndValidateLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    return { ok: false, message: "At least 2 journal lines are required" };
  }

  const resolved = [];

  for (const [index, line] of lines.entries()) {
    const accountId = line.account?._id || line.account;
    if (!accountId) {
      return { ok: false, message: `Line ${index + 1} has no account selected` };
    }

    const account = await Account.findById(accountId).lean();
    if (!account) {
      return { ok: false, message: `Account not found on line ${index + 1}` };
    }
    if (account.isActive === false) {
      return { ok: false, message: `Account "${account.name}" is inactive` };
    }

    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;

    // A negative debit is really a credit. Allowing it lets an entry look
    // balanced while pushing the wrong sign into every report downstream.
    if (debit < 0 || credit < 0) {
      return { ok: false, message: `Line ${index + 1} cannot have a negative amount` };
    }
    if (debit > 0 && credit > 0) {
      return {
        ok: false,
        message: `Line ${index + 1} has both a debit and a credit. Split it into two lines.`,
      };
    }
    if (debit === 0 && credit === 0) {
      return { ok: false, message: `Line ${index + 1} needs a debit or a credit amount` };
    }

    resolved.push({
      account: account._id,
      accountCode: account.code,
      accountName: account.name,
      debit: Math.round(debit * 100) / 100,
      credit: Math.round(credit * 100) / 100,
      description: line.description || "",
    });
  }

  const totalDebit = Math.round(resolved.reduce((sum, l) => sum + l.debit, 0) * 100) / 100;
  const totalCredit = Math.round(resolved.reduce((sum, l) => sum + l.credit, 0) * 100) / 100;

  if (totalDebit === 0) {
    return { ok: false, message: "An entry must move a non-zero amount" };
  }

  if (Math.abs(totalDebit - totalCredit) >= 0.01) {
    return {
      ok: false,
      message: `Debits (${totalDebit.toLocaleString()}) must equal credits (${totalCredit.toLocaleString()})`,
    };
  }

  return { ok: true, lines: resolved, totalDebit, totalCredit };
}

export default resolveAndValidateLines;
