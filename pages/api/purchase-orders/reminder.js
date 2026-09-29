/**
 * API: /api/purchase-orders/reminder
 *
 * Emails the overdue vendor payments to whoever watches the money.
 *
 * The button on the payment tracker used to do nothing but open WhatsApp with a
 * line of text, so a reminder only existed if somebody had WhatsApp open and a
 * chat to paste it into. This sends the same list as mail, the way the expense app
 * has always sent its overdue orders.
 *
 * GET  — what would be sent, and to whom. Nothing leaves.
 * POST — send it.
 */
import { mongooseConnect } from "@/lib/mongodb";
import PurchaseOrder from "@/models/PurchaseOrder";
import Store from "@/models/Store";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { createMailTransport, getMailEnvValue, getMailFromAddress } from "@/lib/mail";
import { amountStoreOwes, derivePaymentState } from "@/lib/orderPayments";

/** An order is chased once it is a fortnight past its date and still owed for. */
const DAYS_BEFORE_OVERDUE = 14;

const money = (value) =>
  `NGN ${(Number(value) || 0).toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const day = (value) => (value ? new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—");

/** The orders that are late, oldest first, with what is actually still owed. */
export function overdueFrom(orders = [], now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - DAYS_BEFORE_OVERDUE);

  return orders
    .map((order) => ({ ...order, ...derivePaymentState(order) }))
    .filter((order) => {
      const owed = amountStoreOwes(order);
      if (owed <= 0) return false;
      const raised = order.date || order.createdAt;
      return raised ? new Date(raised) < cutoff : false;
    })
    .map((order) => ({
      vendorName: order.vendorName || "Unknown vendor",
      orderRef: order.orderRef || "",
      date: order.date || order.createdAt || null,
      grandTotal: Number(order.grandTotal) || 0,
      paymentMade: Number(order.paymentMade) || 0,
      owed: amountStoreOwes(order),
      status: order.status,
    }))
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
}

/** The same list as a line per order, for WhatsApp or a notes field. */
export function reminderText(rows = [], businessName = "") {
  const head = businessName ? `${businessName} — vendor payments due` : "Vendor payments due";
  const lines = rows.map(
    (row) => `• ${row.vendorName} — ${money(row.owed)} outstanding (order of ${day(row.date)}, ${money(row.grandTotal)} total)`
  );
  return [head, "", ...lines].join("\n");
}

function buildHtml({ rows, businessName, total }) {
  const body = rows
    .map(
      (row) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${row.vendorName}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${day(row.date)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(row.grandTotal)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#16a34a;">${money(row.paymentMade)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;color:#b91c1c;">${money(row.owed)}</td>
        </tr>`
    )
    .join("");

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f9fafb;padding:24px;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="background:#b91c1c;color:#ffffff;padding:18px 20px;">
        <h1 style="margin:0;font-size:18px;">Vendor payments due</h1>
        <p style="margin:4px 0 0;font-size:13px;opacity:.9;">
          ${businessName ? `${businessName} · ` : ""}${rows.length} order${rows.length === 1 ? "" : "s"} past ${DAYS_BEFORE_OVERDUE} days
        </p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f3f4f6;color:#374151;text-align:left;">
            <th style="padding:10px 12px;">Vendor</th>
            <th style="padding:10px 12px;">Ordered</th>
            <th style="padding:10px 12px;text-align:right;">Total</th>
            <th style="padding:10px 12px;text-align:right;">Paid</th>
            <th style="padding:10px 12px;text-align:right;">Outstanding</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr>
            <td colspan="4" style="padding:12px;text-align:right;font-weight:600;">Total outstanding</td>
            <td style="padding:12px;text-align:right;font-weight:700;color:#b91c1c;">${money(total)}</td>
          </tr>
        </tfoot>
      </table>
      <p style="margin:0;padding:14px 20px;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb;">
        Sent from the Vendor Payment Tracker.
      </p>
    </div>
  </div>`;
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    const [orders, store] = await Promise.all([
      PurchaseOrder.find({}).select("orderRef vendorName date createdAt grandTotal paymentMade payBeforeSupply receivedStatus status").lean(),
      Store.findOne({}, { storeName: 1, companyName: 1 }).lean(),
    ]);

    const rows = overdueFrom(orders);
    const total = rows.reduce((sum, row) => sum + row.owed, 0);
    const businessName = store?.companyName || store?.storeName || "";
    const recipient = getMailEnvValue("VENDOR_REMINDER_MAIL_TO", "REMINDER_EMAIL", "MONTHLY_REPORT_MAIL_TO", "TEST_EMAIL", "FROM_EMAIL", "EMAIL_USER");

    const summary = {
      count: rows.length,
      total,
      businessName,
      recipient: recipient || "",
      // Ready to paste into a chat, for whoever would rather send it that way.
      text: reminderText(rows, businessName),
      orders: rows,
    };

    // A look at what would go out, without sending anything.
    if (req.method === "GET") {
      return res.status(200).json({ success: true, preview: true, summary });
    }

    if (rows.length === 0) {
      return res.status(200).json({ success: true, sent: false, message: "Nothing is overdue, so no reminder was sent.", summary });
    }
    if (!recipient) {
      return res.status(500).json({
        error: "No recipient for the reminder. Set VENDOR_REMINDER_MAIL_TO in the server environment.",
      });
    }

    const transporter = createMailTransport();
    if (!transporter) {
      return res.status(500).json({
        error: "Email is not configured on the server. Set SMTP_HOST and SMTP_PORT, or EMAIL_USER and EMAIL_PASS.",
      });
    }

    await transporter.sendMail({
      from: getMailFromAddress("Ibile Mail"),
      to: recipient,
      cc: getMailEnvValue("VENDOR_REMINDER_MAIL_CC") || undefined,
      subject: `Vendor payments due — ${rows.length} order${rows.length === 1 ? "" : "s"}, ${money(total)}`,
      html: buildHtml({ rows, businessName, total }),
    });

    return res.status(200).json({
      success: true,
      sent: true,
      sentTo: recipient,
      message: `${rows.length} overdue order${rows.length === 1 ? "" : "s"} (${money(total)}) sent to ${recipient}`,
      summary,
    });
  } catch (err) {
    console.error("Vendor reminder failed:", err);
    return res.status(500).json({ error: "Failed to send the reminder", message: err?.message || "Unknown error" });
  }
}
