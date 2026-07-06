import { mongooseConnect } from "@/lib/mongodb";
import path from "path";
import fs from "fs";
import { Staff } from "@/models/Staff";
import { authMiddleware, isAdmin } from "@/lib/auth-middleware";
import { createMailTransport, getMailEnvValue, getMailFromAddress } from "@/lib/mail";

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const key = req.query.key;
  const authHeader = req.headers.authorization || "";
  const cronAuthorized =
    !!cronSecret &&
    (key === cronSecret || authHeader === `Bearer ${cronSecret}`);

  if (!cronAuthorized) {
    const authError = authMiddleware(req, res);
    if (authError) return authError;
    if (!isAdmin(req)) {
      return res.status(403).json({ error: "Admin access required" });
    }
  }

  // 1. Check method
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 2. Check schedule (or force with query param)
  const forceSend = req.query.force === "true";
  const today = new Date();
  const isTargetDate = today.getDate() === 11 && today.getHours() >= 9;

  if (!forceSend && !isTargetDate) {
    return res.status(200).json({
      message: "Not the scheduled date/time, skipping email.",
      nextRun: `11th of month at 09:00 (or use ?force=true to send now)`,
      currentTime: today.toISOString(),
    });
  }

  try {
    await mongooseConnect();

    // 3. Validate required env vars
    const salaryMailTo = getMailEnvValue("SALARY_MAIL_TO");
    const salaryMailCc = getMailEnvValue("SALARY_MAIL_CC");

    if (!salaryMailTo) {
      return res.status(500).json({
        error: "Missing SALARY_MAIL_TO in .env",
      });
    }

    const transporter = createMailTransport();
    if (!transporter) {
      return res.status(500).json({
        error: "Mail transport is not configured",
        required: ["SMTP_HOST/SMTP_PORT", "or EMAIL_USER/EMAIL_PASS"],
        hint: "Use SMTP_* variables or Gmail EMAIL_USER with an app password",
      });
    }

    // 5. Test connection
    console.log("🔗 Testing SMTP connection...");
    await transporter.verify();
    console.log("✅ SMTP verified");

    // 6. Fetch staff
    const staffList = await Staff.find({});
    if (!staffList || staffList.length === 0) {
      return res.status(400).json({ error: "No staff records found" });
    }

    const currentMonth = new Date().toLocaleString("default", {
      month: "long",
    });
    const currentYear = new Date().getFullYear();

    // 7. Calculate total net salary
    const totalNetSalary = staffList.reduce((sum, staff) => {
      const totalPenalty = (staff.penalty || []).reduce(
        (penSum, p) => penSum + (p.amount || 0),
        0
      );
      const net = (staff.salary || 0) - totalPenalty;
      return sum + net;
    }, 0);

    const formattedTotal = Number(totalNetSalary || 0).toLocaleString();

    // 8. Build table rows
    const tableRows = staffList
      .map((staff) => {
        const totalPenalty = (staff.penalty || []).reduce(
          (sum, p) => sum + (p.amount || 0),
          0
        );
        const netSalary = Number(
          (staff.salary || 0) - totalPenalty
        ).toLocaleString();

        return `
          <tr>
            <td style="border:1px solid #ddd;padding:8px;">${staff.name}</td>
            <td style="border:1px solid #ddd;padding:8px;">${
              staff.accountName || "N/A"
            }</td>
            <td style="border:1px solid #ddd;padding:8px;">${
              staff.accountNumber || "N/A"
            }</td>
            <td style="border:1px solid #ddd;padding:8px;">${
              staff.bankName || "N/A"
            }</td>
            <td style="border:1px solid #ddd;padding:8px;text-align:right;">₦${netSalary}</td>
          </tr>
        `;
      })
      .join("");

    const mailHtml = `
  <div style="font-family:'Segoe UI',Roboto,sans-serif;background:#f0f4f8;padding:30px;">
    <div style="max-width:700px;margin:auto;background:#ffffff;padding:40px 30px;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.1);border:1px solid #e1e1e1;">
      
      <!-- Logo -->
      <div style="text-align:center;margin-bottom:30px;">
        <img src="cid:logo_cid" alt="Company Logo" style="max-width:120px;height:auto;" />
      </div>

      <!-- Title -->
      <h2 style="text-align:center;color:#003366;font-size:22px;margin-bottom:10px;">Salary Payment Schedule</h2>
      <p style="text-align:center;color:#555;font-size:15px;margin-bottom:30px;">
        <strong>${currentMonth} ${currentYear}</strong>
      </p>

      <!-- Intro -->
      <p style="font-size:14px;color:#444;line-height:1.6;margin-bottom:30px;">
        Dear Sir,<br><br>
        Please find below the salary schedule for the month of <strong>${currentMonth} ${currentYear}</strong>. Kindly review and proceed accordingly.
      </p>

      <!-- Table -->
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead style="background:#25476a;color:#fff;">
          <tr>
            <th style="border:1px solid #ccc;padding:10px;text-align:left;">Staff Name</th>
            <th style="border:1px solid #ccc;padding:10px;text-align:left;">Account Name</th>
            <th style="border:1px solid #ccc;padding:10px;text-align:left;">Bank Account</th>
            <th style="border:1px solid #ccc;padding:10px;text-align:left;">Bank Name</th>
            <th style="border:1px solid #ccc;padding:10px;text-align:right;">Net Salary</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
          <tr style="background:#f1f1f1;font-weight:bold;">
            <td colspan="4" style="border:1px solid #ccc;padding:10px;text-align:right;">Total</td>
            <td style="border:1px solid #ccc;padding:10px;text-align:right;">₦${formattedTotal}</td>
          </tr>
        </tbody>
      </table>

      <!-- Footer -->
      <p style="font-size:12px;color:#999;text-align:center;margin-top:40px;">
        Powered by St's Micheals Admin.<br/>
        &copy; ${new Date().getFullYear()} St's Micheals. All rights reserved.
      </p>
    </div>
  </div>
`;

    // 9. Check if logo exists
    const logoPath = path.resolve(
      process.cwd(),
      "public",
      "image",
      "LogoName.png"
    );
    const attachments = [];

    if (fs.existsSync(logoPath)) {
      attachments.push({
        filename: "logo.png",
        path: logoPath,
        cid: "logo_cid",
      });
      console.log("📎 Logo attached");
    } else {
      console.warn("⚠️ Logo not found at:", logoPath);
    }

    // 10. Build mail options
    const mailOptions = {
      from: getMailFromAddress("St's Micheals"),
      to: salaryMailTo,
      cc: salaryMailCc || undefined,
      subject: `${currentMonth} ${currentYear} Salary Schedule`,
      html: mailHtml,
      attachments,
    };

    // 11. Send email
  console.log("📧 Sending salary email to:", salaryMailTo);
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Email sent:", info.messageId);

    return res.status(200).json({
      message: "Salary email sent successfully.",
      staffCount: staffList.length,
      totalSalary: formattedTotal,
      sentTo: salaryMailTo,
      messageId: info.messageId,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ Error sending salary email:", err);
    return res.status(500).json({
      error: "Failed to send salary email.",
      code: err.code,
      message: err.message,
      hint:
        err.code === "ESOCKET"
          ? "SMTP connection failed. Check EMAIL_USER/EMAIL_PASS."
          : err.code === "EAUTH"
          ? "Invalid email credentials. Verify EMAIL_USER and EMAIL_PASS."
          : "Check server logs for details",
    });
  }
}
