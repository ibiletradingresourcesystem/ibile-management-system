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
import Store from "@/models/Store";
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

const dateLong = (value) =>
  new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });

/**
 * Digits a mail client would otherwise turn into a telephone link.
 *
 * Gmail and Outlook link anything that looks like a phone number, which is why the
 * account numbers arrived blue and underlined. The number is left intact so it can
 * still be copied into a banking app; the stylesheet in the head makes any link the
 * client invents inherit the surrounding text instead of announcing itself.
 */
const plainDigits = (value) =>
  `<span style="color:#111827;text-decoration:none;" class="no-autolink">${escapeHtml(value)}</span>`;

/** One block of figures at the top, so the reader sees the shape before the names. */
function summaryBand({ staffCount, total, grossTotal, deductions }) {
  const cell = (label, value, tone = "#111827") => `
    <td style="padding:12px 14px;border:1px solid #e5e7eb;background:#f9fafb;">
      <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;">${label}</p>
      <p style="margin:4px 0 0;font-size:17px;font-weight:700;color:${tone};">${value}</p>
    </td>`;

  return `
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px;font-family:inherit;">
      <tr>
        ${cell("Staff being paid", String(staffCount))}
        ${cell("Gross salary", money(grossTotal))}
        ${cell("Deductions", deductions > 0 ? `− ${money(deductions)}` : money(0), deductions > 0 ? "#b45309" : "#111827")}
        ${cell("Net to transfer", money(total), "#047857")}
      </tr>
    </table>`;
}

/** The people being paid, gathered by the place they work. */
function payrollTables(rows) {
  const byLocation = new Map();
  for (const row of rows) {
    const key = row.location || "Unassigned";
    if (!byLocation.has(key)) byLocation.set(key, []);
    byLocation.get(key).push(row);
  }

  const head = `
    <thead style="background:#25476a;color:#ffffff;">
      <tr>
        <th style="border:1px solid #ccc;padding:9px;text-align:left;">Staff Name</th>
        <th style="border:1px solid #ccc;padding:9px;text-align:left;">Account Name</th>
        <th style="border:1px solid #ccc;padding:9px;text-align:left;">Bank Account</th>
        <th style="border:1px solid #ccc;padding:9px;text-align:left;">Bank</th>
        <th style="border:1px solid #ccc;padding:9px;text-align:right;">Salary</th>
        <th style="border:1px solid #ccc;padding:9px;text-align:right;">Deductions</th>
        <th style="border:1px solid #ccc;padding:9px;text-align:right;">Net Pay</th>
      </tr>
    </thead>`;

  const sections = [...byLocation.entries()].map(([location, staffRows]) => {
    const subtotal = staffRows.reduce((sum, row) => sum + row.netPay, 0);
    const body = staffRows
      .map((row) => {
        const unpayable = !row.accountNumber || !row.bankName;
        return `
          <tr${unpayable ? ' style="background:#fef2f2;"' : ""}>
            <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(row.name)}</td>
            <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(row.accountName || "—")}</td>
            <td style="border:1px solid #ddd;padding:8px;">${row.accountNumber ? plainDigits(row.accountNumber) : "—"}</td>
            <td style="border:1px solid #ddd;padding:8px;">${escapeHtml(row.bankName || "—")}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:right;color:#6b7280;">${money(row.salary)}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:right;color:${row.penalties > 0 ? "#b45309" : "#9ca3af"};">${row.penalties > 0 ? `− ${money(row.penalties)}` : "—"}</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:right;font-weight:600;">${money(row.netPay)}</td>
          </tr>`;
      })
      .join("");

    return `
      <p style="margin:22px 0 6px;font-size:13px;font-weight:700;color:#25476a;">
        ${escapeHtml(location)} <span style="font-weight:400;color:#6b7280;">· ${staffRows.length} staff · ${money(subtotal)}</span>
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
        ${head}
        <tbody>${body}</tbody>
      </table>`;
  });

  return sections.join("");
}

/**
 * The salary schedule as it goes out: letterhead logo, the month, what the payroll
 * comes to, who is paid what and where, and everything the reader would otherwise
 * have to open the app to find — the transfers that cannot be made yet, and the
 * staff who are not being paid at all.
 */
function buildHtml({ rows, total, monthLabel, incomplete, excluded = [], logoCid, businessName = "", generatedAt = new Date() }) {
  const grossTotal = rows.reduce((sum, row) => sum + (Number(row.salary) || 0), 0);
  const deductions = rows.reduce((sum, row) => sum + (Number(row.penalties) || 0), 0);
  const blockedValue = incomplete.reduce((sum, row) => sum + (Number(row.netPay) || 0), 0);

  const blocked =
    incomplete.length > 0
      ? `<div style="margin:24px 0 0;padding:12px 14px;background:#fef2f2;border-left:4px solid #ef4444;">
           <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#991b1b;">
             ${incomplete.length} transfer${incomplete.length === 1 ? "" : "s"} cannot be made — ${money(blockedValue)} held up
           </p>
           <p style="margin:0;font-size:12.5px;color:#991b1b;line-height:1.5;">
             No account number or bank on file for ${escapeHtml(incomplete.map((row) => row.name).join(", "))}.
             Add the details on the staff page and send again.
           </p>
         </div>`
      : `<div style="margin:24px 0 0;padding:12px 14px;background:#ecfdf5;border-left:4px solid #10b981;">
           <p style="margin:0;font-size:13px;color:#065f46;">Every staff member on this schedule has bank details on file.</p>
         </div>`;

  const notPaid =
    excluded.length > 0
      ? `<div style="margin:16px 0 0;padding:12px 14px;background:#f9fafb;border-left:4px solid #9ca3af;">
           <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#374151;">
             ${excluded.length} staff member${excluded.length === 1 ? "" : "s"} not on this schedule
           </p>
           <p style="margin:0;font-size:12.5px;color:#4b5563;line-height:1.6;">
             ${excluded.map((row) => `${escapeHtml(row.name)} <span style="color:#6b7280;">(${escapeHtml(row.reason)})</span>`).join("<br/>")}
           </p>
         </div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<!-- Stops iOS and Outlook turning account numbers into telephone links. -->
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no" />
<title>${escapeHtml(monthLabel)} Salary Schedule</title>
<style>
  /* Where a client links the digits anyway, the link wears the text around it
     rather than the blue underline it would otherwise announce itself with. */
  a[x-apple-data-detectors],
  .no-autolink a,
  u + #body a,
  #MessageViewBody a {
    color: inherit !important;
    text-decoration: none !important;
    font-size: inherit !important;
    font-family: inherit !important;
    font-weight: inherit !important;
    line-height: inherit !important;
  }
</style>
</head>
<body id="body" style="margin:0;padding:0;background:#f0f4f8;">
  <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f0f4f8;padding:30px;">
    <div style="max-width:760px;margin:auto;background:#ffffff;padding:36px 30px;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.08);border:1px solid #e1e1e1;">

      ${
        logoCid
          ? `<div style="text-align:center;margin-bottom:26px;">
               <img src="cid:${logoCid}" alt="${escapeHtml(businessName || "Logo")}" style="max-width:120px;height:auto;" />
             </div>`
          : ""
      }

      <h2 style="text-align:center;color:#003366;font-size:22px;margin:0 0 6px;">Salary Payment Schedule</h2>
      <p style="text-align:center;color:#555;font-size:15px;margin:0 0 4px;"><strong>${escapeHtml(monthLabel)}</strong></p>
      <p style="text-align:center;color:#9ca3af;font-size:12px;margin:0 0 28px;">
        ${businessName ? `${escapeHtml(businessName)} · ` : ""}prepared ${dateLong(generatedAt)}
      </p>

      <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 24px;">
        Dear Sir,<br/><br/>
        Below is the salary schedule for <strong>${escapeHtml(monthLabel)}</strong>: ${rows.length} staff,
        ${money(grossTotal)} in salaries${deductions > 0 ? `, less ${money(deductions)} in deductions` : ""},
        leaving <strong>${money(total)}</strong> to transfer. Kindly review and proceed.
      </p>

      ${summaryBand({ staffCount: rows.length, total, grossTotal, deductions })}
      ${payrollTables(rows)}

      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:14px;">
        <tr style="background:#25476a;color:#ffffff;font-weight:bold;">
          <td style="border:1px solid #ccc;padding:11px;text-align:right;">Total to transfer</td>
          <td style="border:1px solid #ccc;padding:11px;text-align:right;width:160px;">${money(total)}</td>
        </tr>
      </table>

      ${blocked}
      ${notPaid}

      <p style="font-size:11.5px;color:#9ca3af;line-height:1.6;margin:26px 0 0;">
        Net pay is the salary less any penalties recorded against the person for the month.
        Anyone whose pay nets out at zero is left off the schedule and listed above.
      </p>

      <p style="font-size:12px;color:#999;text-align:center;margin-top:28px;">
        Powered by Hetch Tech (Ayoola).<br/>
        &copy; ${new Date().getFullYear()} Ibile Trading Resources Limited. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>`;
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
    const [staffList, store] = await Promise.all([
      Staff.find({}).select("-password").lean(),
      Store.findOne({}, { storeName: 1, companyName: 1 }).lean(),
    ]);
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
      subject: `${monthLabel} Salary Schedule — ${rows.length} staff, ${money(total)}`,
      html: buildHtml({
        rows,
        total,
        monthLabel,
        incomplete,
        excluded: payrollExclusions(staffList),
        logoCid: logo?.cid,
        businessName: store?.companyName || store?.storeName || "",
      }),
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
