import { mongooseConnect } from "@/lib/mongodb";
import { Transaction } from "@/models/Transactions";
import PendingTransactionAction from "@/models/PendingTransactionAction";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import nodemailer from "nodemailer";
import crypto from "crypto";

function getAppBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

async function sendConfirmationEmail({ actionType, transaction, token, reason, requestedBy, editPayload, baseUrl }) {
  const { EMAIL_USER, EMAIL_PASS, ADMIN_EMAIL, FROM_EMAIL } = process.env;
  if (!EMAIL_USER || !EMAIL_PASS || !ADMIN_EMAIL) {
    throw new Error("Email configuration missing (EMAIL_USER, EMAIL_PASS, or ADMIN_EMAIL)");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  });

  const approveUrl = `${baseUrl}/api/transactions/confirm-action?token=${token}&decision=approve`;
  const rejectUrl = `${baseUrl}/api/transactions/confirm-action?token=${token}&decision=reject`;

  const isEdit = actionType === "edit";
  const actionLabel = isEdit ? "Edit" : "Refund (Void)";
  const actionColor = isEdit ? "#2563eb" : "#dc2626";

  let editDetails = "";
  if (isEdit && editPayload) {
    const fields = [];
    if (editPayload.items) fields.push(`<li><strong>Items:</strong> ${editPayload.items.length} item(s) updated</li>`);
    if (editPayload.total !== undefined) fields.push(`<li><strong>New Total:</strong> ₦${Number(editPayload.total).toLocaleString()}</li>`);
    if (editPayload.discount !== undefined) fields.push(`<li><strong>New Discount:</strong> ₦${Number(editPayload.discount).toLocaleString()}</li>`);
    if (editPayload.customerName !== undefined) fields.push(`<li><strong>Customer:</strong> ${editPayload.customerName || "Walk-in"}</li>`);
    editDetails = fields.length > 0
      ? `<div style="background:#f0f9ff;padding:12px;border-radius:8px;margin:12px 0;"><strong>Proposed Changes:</strong><ul style="margin:8px 0;">${fields.join("")}</ul></div>`
      : "";
  }

  const html = `
    <div style="font-family:'Segoe UI',sans-serif;background:#f9fafb;padding:20px;">
      <div style="max-width:600px;margin:auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
        <div style="background:${actionColor};color:white;padding:20px;text-align:center;">
          <h2 style="margin:0;">Transaction ${actionLabel} Request</h2>
          <p style="margin:4px 0 0;opacity:0.9;">Confirmation Required</p>
        </div>
        <div style="padding:24px;">
          <p>A staff member has requested to <strong>${actionLabel.toLowerCase()}</strong> a completed transaction.</p>
          
          <div style="background:#f8fafc;padding:16px;border-radius:8px;margin:16px 0;border-left:4px solid ${actionColor};">
            <p style="margin:0 0 8px;"><strong>Transaction ID:</strong> ${transaction._id}</p>
            <p style="margin:0 0 8px;"><strong>Date:</strong> ${new Date(transaction.createdAt).toLocaleString("en-NG")}</p>
            <p style="margin:0 0 8px;"><strong>Staff:</strong> ${transaction.staffName || "N/A"}</p>
            <p style="margin:0 0 8px;"><strong>Location:</strong> ${transaction.location || "N/A"}</p>
            <p style="margin:0 0 8px;"><strong>Total:</strong> ₦${Number(transaction.total || 0).toLocaleString()}</p>
            <p style="margin:0 0 8px;"><strong>Items:</strong> ${transaction.items?.length || 0} item(s)</p>
            <p style="margin:0;"><strong>Requested By:</strong> ${requestedBy}</p>
            ${reason ? `<p style="margin:8px 0 0;"><strong>Reason:</strong> ${reason}</p>` : ""}
          </div>
          
          ${editDetails}

          <p style="color:#6b7280;font-size:14px;">This link expires in 24 hours. Please review and take action below:</p>

          <div style="text-align:center;margin:24px 0;">
            <a href="${approveUrl}" style="display:inline-block;padding:12px 32px;background:#059669;color:white;text-decoration:none;border-radius:8px;font-weight:600;margin-right:12px;">
              ✅ Approve
            </a>
            <a href="${rejectUrl}" style="display:inline-block;padding:12px 32px;background:#dc2626;color:white;text-decoration:none;border-radius:8px;font-weight:600;">
              ❌ Reject
            </a>
          </div>

          <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:24px;">
            If the buttons don't work, copy and paste this URL to approve:<br>
            <span style="word-break:break-all;">${approveUrl}</span>
          </p>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: FROM_EMAIL || EMAIL_USER,
    to: ADMIN_EMAIL,
    subject: `🔔 Transaction ${actionLabel} Request — Confirmation Needed`,
    html,
  });
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    const { transactionId, actionType, reason, editPayload } = req.body || {};

    if (!transactionId || !actionType) {
      return res.status(400).json({
        success: false,
        message: "transactionId and actionType are required",
      });
    }

    if (!["edit", "refund"].includes(actionType)) {
      return res.status(400).json({
        success: false,
        message: "actionType must be 'edit' or 'refund'",
      });
    }

    // Find the transaction
    const transaction = await Transaction.findById(transactionId).lean();
    if (!transaction) {
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }

    if (transaction.status !== "completed" && actionType === "edit") {
      return res.status(400).json({
        success: false,
        message: "Only completed transactions can be edited",
      });
    }

    if (transaction.status === "refunded") {
      return res.status(400).json({
        success: false,
        message: "Transaction is already refunded",
      });
    }

    // Check for existing pending action on this transaction
    const existingPending = await PendingTransactionAction.findOne({
      transactionId,
      status: "pending",
      expiresAt: { $gt: new Date() },
    });

    if (existingPending) {
      return res.status(409).json({
        success: false,
        message: "A pending action already exists for this transaction. Please wait for admin to process it.",
      });
    }

    // Generate confirmation token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const requestedBy = req.user?.name || req.user?.username || "Unknown Staff";

    // Create pending action
    await PendingTransactionAction.create({
      transactionId,
      actionType,
      editPayload: actionType === "edit" ? editPayload : null,
      reason: reason || "",
      requestedBy,
      requestedByStaffId: req.user?._id || req.user?.id || null,
      confirmationToken: token,
      status: "pending",
      expiresAt,
    });

    // Send email
    const baseUrl = getAppBaseUrl(req);
    await sendConfirmationEmail({
      actionType,
      transaction,
      token,
      reason,
      requestedBy,
      editPayload,
      baseUrl,
    });

    return res.status(200).json({
      success: true,
      message: `${actionType === "edit" ? "Edit" : "Refund"} request sent to admin for confirmation. You will be notified once approved.`,
    });
  } catch (err) {
    console.error("Transaction action request error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to process request",
    });
  }
}
