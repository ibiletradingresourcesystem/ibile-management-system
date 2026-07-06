import { mongooseConnect } from "@/lib/mongodb";
import SupportTicket from "@/models/SupportTicket";
import { authMiddleware, isAdmin, isStaff } from "@/lib/auth-middleware";

const ALLOWED_STATUS = ["open", "in_progress", "pending_customer", "resolved", "closed"];
const ALLOWED_PRIORITY = ["low", "medium", "high", "urgent"];
const ALLOWED_CATEGORY = ["general", "billing", "technical", "tax", "inventory", "other"];

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  await mongooseConnect();
  const { id } = req.query;
  const query = id.startsWith("ST-") ? { ticketNumber: id } : { _id: id };

  if (req.method === "GET") {
    try {
      const ticket = await SupportTicket.findOne(query).lean();
      if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found" });
      return res.status(200).json({ success: true, ticket });
    } catch (error) {
      console.error("Support ticket GET error:", error);
      return res.status(500).json({ success: false, error: "Failed to load ticket" });
    }
  }

  if (req.method === "PUT") {
    try {
      const { status, priority, category, assignedTo, comment, subject } = req.body || {};
      const ticket = await SupportTicket.findOne(query);
      if (!ticket) return res.status(404).json({ success: false, error: "Ticket not found" });

      if (status && ALLOWED_STATUS.includes(status)) {
        ticket.status = status;
        if (status === "closed" || status === "resolved") {
          ticket.closedAt = new Date();
        }
      }
      if (priority && ALLOWED_PRIORITY.includes(priority)) ticket.priority = priority;
      if (category && ALLOWED_CATEGORY.includes(category)) ticket.category = category;
      if (subject && String(subject).trim()) ticket.subject = String(subject).trim();

      if (assignedTo && typeof assignedTo === "object") {
        ticket.assignedTo = {
          userId: String(assignedTo.userId || ""),
          name: String(assignedTo.name || ""),
          email: String(assignedTo.email || ""),
        };
      }

      if (comment && String(comment).trim()) {
        ticket.comments.push({
          message: String(comment).trim(),
          byUserId: String(req.user?.id || ""),
          byName: req.user?.name || "",
          byEmail: req.user?.email || "",
          byRole: req.user?.role || "",
          internal: false,
        });
      }

      ticket.lastActivityAt = new Date();
      await ticket.save();
      return res.status(200).json({ success: true, ticket });
    } catch (error) {
      console.error("Support ticket PUT error:", error);
      return res.status(500).json({ success: false, error: "Failed to update ticket" });
    }
  }

  if (req.method === "DELETE") {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, error: "Only admin can delete tickets" });
    }
    try {
      const deleted = await SupportTicket.findOneAndDelete(query);
      if (!deleted) return res.status(404).json({ success: false, error: "Ticket not found" });
      return res.status(200).json({ success: true, message: "Ticket deleted" });
    } catch (error) {
      console.error("Support ticket DELETE error:", error);
      return res.status(500).json({ success: false, error: "Failed to delete ticket" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
