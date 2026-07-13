/**
 * API: /api/daily-mail
 * 
 * POST/GET - Sends a daily sales summary email.
 * Triggered by Vercel Cron at midnight or manually from the dashboard.
 */
import { mongooseConnect } from "@/lib/mongoose";
import { Transaction } from "@/models/Transactions";
import Expense from "@/models/Expense";
import { createMailTransport, getMailEnvValue, getMailFromAddress } from "@/lib/mail";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import jwt from "jsonwebtoken";

export default async function handler(req, res) {
  // Auth: Allow CRON_SECRET, JWT, or Vercel cron
  if (process.env.NODE_ENV === "production") {
    const key = req.query.key;
    const auth = req.headers.authorization;
    if (key === process.env.CRON_SECRET || auth === `Bearer ${process.env.CRON_SECRET}`) {
      // Cron authorized
    } else if (auth?.startsWith("Bearer ")) {
      try {
        jwt.verify(auth.substring(7), process.env.JWT_SECRET);
      } catch {
        return res.status(401).json({ error: "Unauthorized" });
      }
    } else {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  try {
    const recipient = getMailEnvValue("MONTHLY_REPORT_MAIL_TO", "TEST_EMAIL", "FROM_EMAIL", "EMAIL_USER");
    if (!recipient) {
      return res.status(500).json({ error: "No email recipient configured" });
    }

    // Get yesterday's data (or today if triggered manually)
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [salesResult, expenseResult, txCount] = await Promise.all([
      Transaction.aggregate([
        { $match: { status: "completed", subStatus: { $ne: "void" }, createdAt: { $gte: dayStart, $lt: dayEnd } } },
        { $group: { _id: null, total: { $sum: "$total" }, items: { $sum: { $sum: "$items.qty" } } } },
      ]),
      Expense.aggregate([
        { $match: { $or: [{ createdAt: { $gte: dayStart, $lt: dayEnd } }, { expenseDate: { $gte: dayStart, $lt: dayEnd } }] } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      Transaction.countDocuments({ status: "completed", subStatus: { $ne: "void" }, createdAt: { $gte: dayStart, $lt: dayEnd } }),
    ]);

    const totalSales = salesResult[0]?.total || 0;
    const totalItems = salesResult[0]?.items || 0;
    const totalExpenses = expenseResult[0]?.total || 0;
    const netPosition = totalSales - totalExpenses;
    const dateLabel = dayStart.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

    const formatMoney = (v) => `₦${Number(v || 0).toLocaleString("en-NG")}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #1f2937; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h1 style="margin: 0; font-size: 20px;">Daily Sales Summary</h1>
          <p style="margin: 5px 0 0 0; opacity: 0.8; font-size: 13px;">${dateLabel}</p>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
          <div style="background: #ecfdf5; padding: 16px; border-radius: 8px; border-left: 4px solid #10b981;">
            <p style="margin: 0; font-size: 11px; color: #6b7280; text-transform: uppercase;">Total Sales</p>
            <p style="margin: 4px 0 0 0; font-size: 22px; font-weight: bold; color: #065f46;">${formatMoney(totalSales)}</p>
          </div>
          <div style="background: #fef2f2; padding: 16px; border-radius: 8px; border-left: 4px solid #ef4444;">
            <p style="margin: 0; font-size: 11px; color: #6b7280; text-transform: uppercase;">Expenses</p>
            <p style="margin: 4px 0 0 0; font-size: 22px; font-weight: bold; color: #991b1b;">${formatMoney(totalExpenses)}</p>
          </div>
          <div style="background: #eff6ff; padding: 16px; border-radius: 8px; border-left: 4px solid #3b82f6;">
            <p style="margin: 0; font-size: 11px; color: #6b7280; text-transform: uppercase;">Transactions</p>
            <p style="margin: 4px 0 0 0; font-size: 22px; font-weight: bold; color: #1e40af;">${txCount}</p>
          </div>
          <div style="background: ${netPosition >= 0 ? "#ecfdf5" : "#fef2f2"}; padding: 16px; border-radius: 8px; border-left: 4px solid ${netPosition >= 0 ? "#10b981" : "#ef4444"};">
            <p style="margin: 0; font-size: 11px; color: #6b7280; text-transform: uppercase;">Net Position</p>
            <p style="margin: 4px 0 0 0; font-size: 22px; font-weight: bold; color: ${netPosition >= 0 ? "#065f46" : "#991b1b"};">${formatMoney(netPosition)}</p>
          </div>
        </div>
        <p style="font-size: 12px; color: #9ca3af; text-align: center;">Items sold: ${totalItems} | Generated: ${new Date().toLocaleString()}</p>
      </div>
    `;

    const transporter = createMailTransport();
    if (!transporter) {
      return res.status(500).json({ error: "Mail transport not configured" });
    }

    await transporter.sendMail({
      from: getMailFromAddress("Ibile Inventory"),
      to: recipient,
      subject: `Daily Summary: ${formatMoney(totalSales)} sales — ${dateLabel}`,
      html,
    });

    return res.status(200).json({
      success: true,
      sentTo: recipient,
      summary: { totalSales, totalExpenses, txCount, netPosition, date: dateLabel },
    });
  } catch (err) {
    console.error("[Daily Mail] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}
