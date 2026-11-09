import { mongooseConnect } from "@/lib/mongodb";
import { Transaction } from "@/models/Transactions";
import PendingTransactionAction from "@/models/PendingTransactionAction";
import { applyInventoryDelta } from "@/lib/transaction-utils";
import { postRefundEntry } from "@/lib/accounting";

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Per product, how much more (or, negative, less) an edit sells than the sale it replaces. */
function editedQuantities(before = [], after = []) {
  const quantity = (item) => Number(item?.qty ?? item?.quantity) || 0;
  const change = new Map();
  for (const item of after) change.set(String(item.productId), (change.get(String(item.productId)) || 0) + quantity(item));
  for (const item of before) change.set(String(item.productId), (change.get(String(item.productId)) || 0) - quantity(item));
  return [...change.entries()].filter(([, qty]) => qty !== 0).map(([productId, qty]) => ({ productId, qty }));
}

/** Why a link can no longer be acted on, or null when it still can. */
function closedLinkPage(res, pendingAction) {
  if (!pendingAction) {
    return renderPage(res, "Action Not Found", "This confirmation link has expired or does not exist.", "error");
  }

  if (pendingAction.status !== "pending") {
    if (pendingAction.status === "expired") {
      return renderPage(res, "Link Expired", "This confirmation link has expired. The staff member will need to submit a new request.", "error");
    }
    const statusLabel = pendingAction.status === "approved" ? "already approved" : "already rejected";
    return renderPage(
      res,
      "Already Processed",
      `This action has been ${statusLabel} on ${new Date(pendingAction.processedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}.`,
      "info"
    );
  }

  if (new Date() > pendingAction.expiresAt) {
    return renderPage(res, "Link Expired", "This confirmation link has expired. The staff member will need to submit a new request.", "error");
  }

  return null;
}

export default async function handler(req, res) {
  // A link clicked from email — no auth token required, but secured via the unique confirmation
  // token. Mail scanners and link previews open every link in an email, so opening one only asks;
  // the action itself takes the POST from the button on that page.
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const { token, decision } = req.method === "POST" ? req.body || {} : req.query;

  if (typeof token !== "string" || !token || !["approve", "reject"].includes(decision)) {
    return renderPage(res, "Invalid Request", "The confirmation link is invalid or malformed.", "error");
  }

  try {
    await mongooseConnect();

    if (req.method === "GET") {
      const pendingAction = await PendingTransactionAction.findOne({ confirmationToken: token }).lean();
      const closed = closedLinkPage(res, pendingAction);
      if (closed !== null) return closed;
      return renderConfirmPage(res, { pendingAction, token, decision });
    }

    // Taken in one step so a double click, or two admins at once, cannot process it twice
    const pendingAction = await PendingTransactionAction.findOneAndUpdate(
      { confirmationToken: token, status: "pending", expiresAt: { $gt: new Date() } },
      { $set: { status: decision === "approve" ? "approved" : "rejected", processedAt: new Date() } },
      { new: true }
    );

    if (!pendingAction) {
      const latest = await PendingTransactionAction.findOne({ confirmationToken: token }).lean();
      return closedLinkPage(res, latest) ?? renderPage(res, "Action Not Found", "This confirmation link has expired or does not exist.", "error");
    }

    if (decision === "reject") {
      return renderPage(
        res,
        "Request Rejected",
        `The ${pendingAction.actionType} request for transaction has been rejected. No changes were made.`,
        "warning"
      );
    }

    try {
      return await applyApprovedAction(res, pendingAction);
    } catch (err) {
      // Nothing was finished: the link can be used again
      await PendingTransactionAction.updateOne(
        { _id: pendingAction._id },
        { $set: { status: "pending", processedAt: null } }
      ).catch(() => {});
      throw err;
    }
  } catch (err) {
    console.error("Confirm action error:", err);
    return renderPage(res, "Server Error", "An error occurred while processing this request. Please try again or contact support.", "error");
  }
}

async function applyApprovedAction(res, pendingAction) {
  const transaction = await Transaction.findById(pendingAction.transactionId);
  if (!transaction) {
    return renderPage(res, "Transaction Not Found", "The associated transaction no longer exists.", "error");
  }

  if (pendingAction.actionType === "edit") {
    // Apply edit changes
    const editPayload = pendingAction.editPayload || {};
    const updateData = {};

    if (editPayload.items) updateData.items = editPayload.items;
    if (editPayload.total !== undefined) updateData.total = editPayload.total;
    if (editPayload.subtotal !== undefined) updateData.subtotal = editPayload.subtotal;
    if (editPayload.tax !== undefined) updateData.tax = editPayload.tax;
    if (editPayload.discount !== undefined) updateData.discount = editPayload.discount;
    if (editPayload.customerName !== undefined) updateData.customerName = editPayload.customerName;
    if (editPayload.discountReason !== undefined) updateData.discountReason = editPayload.discountReason;

    updateData.status = "completed";
    updateData.subStatus = "edited";

    // Stock follows the edit: only the difference moves, so unchanged lines cost nothing
    if (editPayload.items && transaction.inventoryUpdated && !transaction.inventoryRestockedAt) {
      await applyInventoryDelta(editedQuantities(transaction.items || [], editPayload.items), "decrement");
    }

    await Transaction.findByIdAndUpdate(pendingAction.transactionId, updateData, {
      new: true,
      runValidators: true,
    });

    return renderPage(
      res,
      "Edit Approved ✅",
      "The transaction has been updated successfully with status: <strong>completed</strong>, subStatus: <strong>edited</strong>.",
      "success"
    );
  }

  if (pendingAction.actionType === "refund") {
    // Process refund — restock inventory if it was decremented
    const restock = transaction.status === "completed" && transaction.inventoryUpdated && !transaction.inventoryRestockedAt;
    if (restock) {
      await applyInventoryDelta(transaction.items || [], "increment");
    }

    const refunded = await Transaction.findByIdAndUpdate(pendingAction.transactionId, {
      status: "refunded",
      subStatus: "void",
      refundedAt: new Date(),
      refundReason: pendingAction.reason || "Admin-approved refund",
      inventoryRestockedAt: restock ? new Date() : transaction.inventoryRestockedAt,
    }, { new: true, runValidators: true });

    try {
      await postRefundEntry(refunded);
    } catch (acctErr) {
      console.error("Accounting auto-post failed for refund:", refunded._id, acctErr.message);
    }

    return renderPage(
      res,
      "Refund Approved ✅",
      "The transaction has been refunded with status: <strong>refunded</strong>, subStatus: <strong>void</strong>. Inventory has been restocked.",
      "success"
    );
  }

  return renderPage(res, "Unknown Action", "The action type is not recognized.", "error");
}

/** The page a link opens: what is being asked, and the button that does it. */
function renderConfirmPage(res, { pendingAction, token, decision }) {
  const approving = decision === "approve";
  const verb = approving ? "Approve" : "Reject";
  const action = pendingAction.actionType === "edit" ? "edit" : "refund";
  const details = `
    <p style="margin-bottom:8px;"><strong>${verb} this ${action} request?</strong></p>
    <p style="margin-bottom:4px;">Requested by: ${escapeHtml(pendingAction.requestedBy)}</p>
    ${pendingAction.reason ? `<p>Reason: ${escapeHtml(pendingAction.reason)}</p>` : ""}`;
  const form = `
    <form method="POST" action="/api/transactions/confirm-action" style="margin-top:20px;text-align:center;">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <input type="hidden" name="decision" value="${escapeHtml(decision)}" />
      <button type="submit" style="padding:12px 32px;border:0;border-radius:8px;font-size:15px;font-weight:600;color:white;cursor:pointer;background:${approving ? "#059669" : "#dc2626"};">
        ${verb} ${action}
      </button>
    </form>`;

  return renderPage(res, `${verb} ${action}`, details, approving ? "info" : "warning", form);
}

function renderPage(res, title, message, type = "info", actions = "") {
  const colors = {
    success: { bg: "#ecfdf5", border: "#059669", text: "#065f46", icon: "✅" },
    error: { bg: "#fef2f2", border: "#dc2626", text: "#991b1b", icon: "❌" },
    warning: { bg: "#fffbeb", border: "#d97706", text: "#92400e", icon: "⚠️" },
    info: { bg: "#eff6ff", border: "#2563eb", text: "#1e40af", icon: "ℹ️" },
  };

  const c = colors[type] || colors.info;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Transaction Action</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #f3f4f6;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.1);
      max-width: 480px;
      width: 100%;
      overflow: hidden;
    }
    .card-header {
      background: ${c.border};
      color: white;
      padding: 24px;
      text-align: center;
    }
    .card-header h1 {
      font-size: 1.5rem;
      font-weight: 700;
    }
    .card-body {
      padding: 32px 24px;
    }
    .alert {
      background: ${c.bg};
      border-left: 4px solid ${c.border};
      color: ${c.text};
      padding: 16px;
      border-radius: 8px;
      font-size: 15px;
      line-height: 1.6;
    }
    .footer {
      text-align: center;
      padding: 16px 24px 24px;
      color: #9ca3af;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <h1>${c.icon} ${title}</h1>
    </div>
    <div class="card-body">
      <div class="alert">${message}</div>
      ${actions}
    </div>
    <div class="footer">
      You can close this window. &mdash; Inventory Admin
    </div>
  </div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(html);
}
