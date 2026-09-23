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
import fs from "fs";
import path from "path";
import { mongooseConnect } from "@/lib/mongodb";
import Staff from "@/models/Staff";
import { createMailTransport, getMailEnvValue, getMailFromAddress } from "@/lib/mail";
import { authMiddleware, isAdmin } from "@/lib/auth-middleware";
import { missingBankDetails, payrollExclusions, payrollRows, payrollTotal } from "@/lib/payroll";

const money = (value) => `₦${Number(value || 0).toLocaleString("en-NG")}`;

/** Email clients render pasted markup, so anything from a record is escaped first. */
const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * The salary schedule as it goes out: letterhead logo, the month, and one table of
 * who is paid what. `logoCid` is the attached logo; without it the heading stands alone.
 */
function buildHtml({ rows, total, monthLabel, incomplete, logoCid }) {
  const tableRows = rows
    .map(
      (row) => `
          <tr>
            <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(row.name)}</td>
            <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(row.accountName || "N/A")}</td>
            <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(row.accountNumber || "N/A")}</td>
            <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(row.bankName || "N/A")}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:right;">${money(row.netPay)}</td>
          </tr>`
    )
    .join("");

  const warning =
    incomplete.length > 0
      ? `<p style="margin:24px 0 0;padding:10px 12px;background:#fef2f2;border-left:4px solid #ef4444;font-size:13px;color:#991b1b;">
           No account number or bank on file for: ${escapeHtml(incomplete.map((row) => row.name).join(", "))}.
           Those transfers cannot be made until the details are added.
         </p>`
      : "";

  return `
  <div style="font-family:'Segoe UI',Roboto,sans-serif;background:#f0f4f8;padding:30px;">
    <div style="max-width:700px;margin:auto;background:#ffffff;padding:40px 30px;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.1);border:1px solid #e1e1e1;">

      ${
        logoCid
          ? `<div style="text-align:center;margin-bottom:30px;">
               <img src="cid:${logoCid}" alt="Ibile Mart" style="max-width:120px;height:auto;" />
             </div>`
          : ""
      }

      <h2 style="text-align:center;color:#003366;font-size:22px;margin-bottom:10px;">Salary Payment Schedule</h2>
      <p style="text-align:center;color:#555;font-size:15px;margin-bottom:30px;"><strong>${monthLabel}</strong></p>

      <p style="font-size:14px;color:#444;line-height:1.6;margin-bottom:30px;">
        Dear Sir,<br><br>
        Please find below the salary schedule for the month of <strong>${monthLabel}</strong>. Kindly review and proceed accordingly.
      </p>

      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead style="background:#25476a;color:#fff;">
          <tr>
            <th style="border:1px solid #ccc;padding:10px;text-align:left;">Staff Name</th>
            <th style="border:1px solid #ccc;padding:10px;text-align:left;">Account Name</th>
            <th style="border:1px solid #ccc;padding:10px;text-align:left;">Bank Account</th>
            <th style="border:1px solid #ccc;padding:10px;text-align:left;">Bank Name</th>
            <th style="border:1px solid #ccc;padding:10px;text-align:right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
          <tr style="background:#f1f1f1;font-weight:bold;">
            <td colspan="4" style="border:1px solid #ccc;padding:10px;text-align:right;">Total</td>
            <td style="border:1px solid #ccc;padding:10px;text-align:right;">${money(total)}</td>
          </tr>
        </tbody>
      </table>

      ${warning}

      <p style="font-size:12px;color:#999;text-align:center;margin-top:40px;">
        Powered by Hetch Tech (Ayoola).<br/>
        &copy; ${new Date().getFullYear()} Ibile Trading Resources Limited. All rights reserved.
      </p>
    </div>
  </div>`;
}

/** The letterhead logo, attached so it shows even where remote images are blocked. */
function logoAttachment() {
  const logoPath = path.resolve(process.cwd(), "public", "images", "logoName.png");
  if (!fs.existsSync(logoPath)) {
    console.warn("Salary mail: logo not found at", logoPath);
    return null;
  }
  return { filename: "logo.png", path: logoPath, cid: "ibile_logo" };
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

    const logo = logoAttachment();

    await transporter.sendMail({
      from: getMailFromAddress("Ibile Mail"),
      to: recipient,
      cc: getMailEnvValue("SALARY_MAIL_CC") || undefined,
      subject: `${monthLabel} Salary Schedule`,
      html: buildHtml({ rows, total, monthLabel, incomplete, logoCid: logo?.cid }),
      attachments: logo ? [logo] : [],
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
