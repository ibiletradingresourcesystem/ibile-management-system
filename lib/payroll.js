/**
 * Payroll maths for the staff page, the salary memo and the salary email.
 *
 * What is actually paid is the salary less any penalties recorded against the
 * person, so that one figure is worked out here and used everywhere. The page was
 * showing gross salary while the penalties sat in a separate panel, which meant the
 * table, the memo and the email could each say something different.
 */

/** Everything taken off this person's pay. */
export function staffPenaltyTotal(staff) {
  return (staff?.penalty || []).reduce((sum, penalty) => sum + (Number(penalty?.amount) || 0), 0);
}

/** What they are actually paid: salary less penalties, never below zero. */
export function staffNetPay(staff) {
  const salary = Number(staff?.salary) || 0;
  return Math.max(0, salary - staffPenaltyTotal(staff));
}

/** One row per person, with the figures already worked out. */
export function payrollRow(staff) {
  const salary = Number(staff?.salary) || 0;
  const penalties = staffPenaltyTotal(staff);
  return {
    _id: staff?._id,
    name: staff?.name || "",
    location: staff?.location || "",
    accountName: staff?.accountName || "",
    accountNumber: staff?.accountNumber || "",
    bankName: staff?.bankName || "",
    salary,
    penalties,
    netPay: Math.max(0, salary - penalties),
  };
}

/**
 * The people to pay this month, biggest payment first.
 * Anyone whose pay nets out at zero — no salary set, or penalties that swallow it —
 * is left off: they are not being paid, so they do not belong on a transfer memo.
 */
export function payrollRows(staffList = []) {
  return (Array.isArray(staffList) ? staffList : [])
    .map(payrollRow)
    .filter((row) => row.netPay > 0)
    .sort((a, b) => b.netPay - a.netPay || a.name.localeCompare(b.name));
}

/** Those left off, and why, so the page can say so rather than quietly dropping them. */
export function payrollExclusions(staffList = []) {
  return (Array.isArray(staffList) ? staffList : [])
    .map(payrollRow)
    .filter((row) => row.netPay <= 0)
    .map((row) => ({
      ...row,
      reason: row.salary <= 0 ? "No salary set" : "Penalties cover the salary",
    }));
}

/** Split into tables of `size`, the way a transfer memo is written up. */
export function chunkPayroll(rows = [], size = 5) {
  const step = Number(size) > 0 ? Math.floor(size) : 5;
  const chunks = [];
  for (let i = 0; i < rows.length; i += step) chunks.push(rows.slice(i, i + step));
  return chunks;
}

export const payrollTotal = (rows = []) => rows.reduce((sum, row) => sum + (Number(row.netPay) || 0), 0);

/** Bank details missing on someone being paid — the transfer cannot be made without them. */
export function missingBankDetails(rows = []) {
  return rows.filter((row) => !row.accountNumber || !row.bankName);
}
