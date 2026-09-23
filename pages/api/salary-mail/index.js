/**
 * API: /api/salary-mail
 *
 * Emails the month's payroll: who is being paid, their bank details and the total.
 * The staff page's "Send Salary Mail" button called this and got a 404 — the route
 * had never been written.
 *
 * POST — send it now (admin, or a cron call carrying CRON_SECRET).
 * GET  — what would be sent, without sending (`?preview=true`).
 */
import { mongooseConnect } from "@/lib/mongodb";
import Staff from "@/models/Staff";
import { createMailTransport, getMailEnvValue, getMailFromAddress } from "@/lib/mail";
import { authMiddleware, isAdmin } from "@/lib/auth-middleware";
import { missingBankDetails, payrollExclusions, payrollRows, payrollTotal } from "@/lib/payroll";

const money = (value) => `₦${Number(value || 0).toLocaleString("en-NG")}`;

function buildHtml({ rows, total, monthLabel, incomplete }) {
  const tableRows = rows
    .map(
      (row, index) => `
        <tr style="background:${index % 2 ? "#f9fafb" : "#ffffff"}">
          <td style="padding:8px 10px;border:1px solid #e5e7eb;">${index + 1}</td>
          <td style="padding:8px 10px;border:1px solid #e5e7eb;">${row.name}</td>
          <td style="padding:8px 10px;border:1px solid #e5e7eb;">${row.accountName || "—"}</td>
          <td style="padding:8px 10px;border:1px solid #e5e7eb;">${row.accountNumber || "—"}</td>
          <td style="padding:8px 10px;border:1px solid #e5e7eb;">${row.bankName || "—"}</td>
          <td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:right;">${money(row.netPay)}</td>
        </tr>`
    )
    .join("");

  const warning =
    incomplete.length > 0
      ? `<p style="margin:16px 0 0;padding:10px 12px;background:#fef2f2;border-left:4px solid #ef4444;font-size:13px;color:#991b1b;">
           Missing bank details: ${incomplete.map((row) => row.name).join(", ")}. Those transfers cannot be made until the details are added.
         </p>`
      : "";

  return `
    <div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;padding:20px;">
      <div style="background:#1f2937;color:#ffffff;padding:20px;border-radius:8px;margin-bottom:20px;">
        <h1 style="margin:0;font-size:20px;">Salary Schedule</h1>
        <p style="margin:5px 0 0;opacity:0.8;font-size:13px;">${monthLabel}</p>
      </div>
      <p style="font-size:14px;color:#374151;">
        ${rows.length} staff to be paid, totalling <strong>${money(total)}</strong>. Penalties have already been taken off.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px;">
        <thead>
          <tr style="background:#dbeafe;">
            <th style="padding:10px;border:1px solid #bfdbfe;text-align:left;">#</th>
            <th style="padding:10px;border:1px solid #bfdbfe;text-align:left;">Staff</th>
            <th style="padding:10px;border:1px solid #bfdbfe;text-align:left;">Account Name</th>
            <th style="padding:10px;border:1px solid #bfdbfe;text-align:left;">Account Number</th>
            <th style="padding:10px;border:1px solid #bfdbfe;text-align:left;">Bank</th>
            <th style="padding:10px;border:1px solid #bfdbfe;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
        <tfoot>
          <tr style="background:#dbeafe;font-weight:bold;">
            <td colspan="5" style="padding:10px;border:1px solid #bfdbfe;text-align:right;">Total</td>
            <td style="padding:10px;border:1px solid #bfdbfe;text-align:right;">${money(total)}</td>
          </tr>
        </tfoot>
      </table>
      ${warning}
      <p style="margin-top:20px;font-size:11px;color:#6b7280;">Sent from Ibile Inventory · ${new Date().toLocaleString("en-NG")}</p>
    </div>`;
}

export default async function handler(req, res) {
  const cronKey = req.query.key || (req.headers.authorization || "").replace("Bearer ", "");
  const isCron = Boolean(process.env.CRON_SECRET) && cronKey === process.env.CRON_SECRET;

  if (!isCron) {
    const authError = authMiddleware(req, res);
    if (authError) return authError;
    // Payroll is pay data: only an administrator may send or preview it.
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  try {
    const staffList = await Staff.find({}).select("-password").lean();
    const rows = payrollRows(staffList);

    if (rows.length === 0) {
      return res.status(400).json({
        error: "Nobody is due to be paid: every staff member has no salary set, or penalties that cover it.",
        excluded: payrollExclusions(staffList).length,
      });
    }

    const total = payrollTotal(rows);
    const incomplete = missingBankDetails(rows);
    const monthLabel = new Date().toLocaleDateString("en-NG", { month: "long", year: "numeric" });
    const summary = {
      staff: rows.length,
      total,
      monthLabel,
      missingBankDetails: incomplete.map((row) => row.name),
      excluded: payrollExclusions(staffList).map((row) => ({ name: row.name, reason: row.reason })),
    };

    // A preview shows the figures without mailing anything.
    if (req.method === "GET" || req.query.preview === "true") {
      return res.status(200).json({ success: true, preview: true, summary });
    }

    const recipient = getMailEnvValue("SALARY_MAIL_TO", "MONTHLY_REPORT_MAIL_TO", "TEST_EMAIL", "FROM_EMAIL", "EMAIL_USER");
    if (!recipient) {
      return res.status(500).json({
        error: "No recipient for the salary email. Set SALARY_MAIL_TO in the server environment.",
      });
    }

    const transporter = createMailTransport();
    if (!transporter) {
      return res.status(500).json({
        error: "Email is not configured on the server. Set SMTP_HOST and SMTP_PORT, or EMAIL_USER and EMAIL_PASS.",
      });
    }

    await transporter.sendMail({
      from: getMailFromAddress("Ibile Inventory"),
      to: recipient,
      cc: getMailEnvValue("SALARY_MAIL_CC") || undefined,
      subject: `Salary schedule ${monthLabel} — ${money(total)} for ${rows.length} staff`,
      html: buildHtml({ rows, total, monthLabel, incomplete }),
    });

    return res.status(200).json({
      success: true,
      sentTo: recipient,
      message: `Salary schedule for ${rows.length} staff (${money(total)}) sent to ${recipient}`,
      summary,
    });
  } catch (err) {
    console.error("Salary mail error:", err);
    return res.status(500).json({ error: err.message || "Could not send the salary email" });
  }
}
