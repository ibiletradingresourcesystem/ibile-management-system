import { mongooseConnect } from "@/lib/mongodb";
import { Transaction } from "@/models/Transactions";
import PendingTransactionAction from "@/models/PendingTransactionAction";
import { applyInventoryDelta } from "@/lib/transaction-utils";

export default async function handler(req, res) {
  // This is a GET endpoint clicked from email — no auth token required,
  // but secured via the unique confirmation token.
  if (req.method !== "GET") {
    return res.status(405).send("Method not allowed");
  }

  const { token, decision } = req.query;

  if (!token || !["approve", "reject"].includes(decision)) {
    return renderPage(res, "Invalid Request", "The confirmation link is invalid or malformed.", "error");
  }

  try {
    await mongooseConnect();

    const pendingAction = await PendingTransactionAction.findOne({
      confirmationToken: token,
    });

    if (!pendingAction) {
      return renderPage(res, "Action Not Found", "This confirmation link has expired or does not exist.", "error");
    }

    if (pendingAction.status !== "pending") {
      const statusLabel = pendingAction.status === "approved" ? "already approved" : "already rejected";
      return renderPage(
        res,
        "Already Processed",
        `This action has been ${statusLabel} on ${new Date(pendingAction.processedAt).toLocaleString("en-NG")}.`,
        "info"
      );
    }

    if (new Date() > pendingAction.expiresAt) {
      pendingAction.status = "expired";
      await pendingAction.save();
      return renderPage(res, "Link Expired", "This confirmation link has expired. The staff member will need to submit a new request.", "error");
    }

    const transaction = await Transaction.findById(pendingAction.transactionId);
    if (!transaction) {
      pendingAction.status = "rejected";
      pendingAction.processedAt = new Date();
      await pendingAction.save();
      return renderPage(res, "Transaction Not Found", "The associated transaction no longer exists.", "error");
    }

    if (decision === "reject") {
      pendingAction.status = "rejected";
      pendingAction.processedAt = new Date();
      await pendingAction.save();

      return renderPage(
        res,
        "Request Rejected",
        `The ${pendingAction.actionType} request for transaction has been rejected. No changes were made.`,
        "warning"
      );
    }

    // ---- APPROVE ----
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

      await Transaction.findByIdAndUpdate(pendingAction.transactionId, updateData, {
        new: true,
        runValidators: true,
      });

      pendingAction.status = "approved";
      pendingAction.processedAt = new Date();
      await pendingAction.save();

      return renderPage(
        res,
        "Edit Approved ✅",
        "The transaction has been updated successfully with status: <strong>completed</strong>, subStatus: <strong>edited</strong>.",
        "success"
      );
    }

    if (pendingAction.actionType === "refund") {
      // Process refund — restock inventory if it was decremented
      if (transaction.status === "completed" && transaction.inventoryUpdated) {
        await applyInventoryDelta(transaction.items || [], "increment");
      }

      await Transaction.findByIdAndUpdate(pendingAction.transactionId, {
        status: "refunded",
        subStatus: "void",
        refundedAt: new Date(),
        refundReason: pendingAction.reason || "Admin-approved refund",
        inventoryRestockedAt: transaction.inventoryUpdated ? new Date() : undefined,
      }, { new: true, runValidators: true });

      pendingAction.status = "approved";
      pendingAction.processedAt = new Date();
      await pendingAction.save();

      return renderPage(
        res,
        "Refund Approved ✅",
        "The transaction has been refunded with status: <strong>refunded</strong>, subStatus: <strong>void</strong>. Inventory has been restocked.",
        "success"
      );
    }

    return renderPage(res, "Unknown Action", "The action type is not recognized.", "error");
  } catch (err) {
    console.error("Confirm action error:", err);
    return renderPage(res, "Server Error", "An error occurred while processing this request. Please try again or contact support.", "error");
  }
}

function renderPage(res, title, message, type = "info") {
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
