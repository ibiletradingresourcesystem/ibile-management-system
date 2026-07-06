import nodemailer from "nodemailer";
import { mongooseConnect } from "@/lib/mongodb";
import SupportTicket from "@/models/SupportTicket";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

function todayToken() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

async function generateTicketNumber() {
  const token = todayToken();
  const count = await SupportTicket.countDocuments({
    ticketNumber: { $regex: `^ST-${token}-` },
  });
  const seq = String(count + 1).padStart(4, "0");
  return `ST-${token}-${seq}`;
}

async function notifySupportByEmail(ticket) {
  const to = process.env.SUPPORT_EMAIL || process.env.EMAIL_USER;
  if (!to || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) return;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: `[Support] New Ticket ${ticket.ticketNumber} - ${ticket.subject}`,
    html: `
      <h3>New Support Ticket</h3>
      <p><strong>Ticket:</strong> ${ticket.ticketNumber}</p>
      <p><strong>Priority:</strong> ${ticket.priority}</p>
      <p><strong>Category:</strong> ${ticket.category}</p>
      <p><strong>From:</strong> ${ticket.createdBy?.name || "Unknown"} (${ticket.createdBy?.email || "N/A"})</p>
      <p><strong>Location:</strong> ${ticket.location || "N/A"}</p>
      <p><strong>Subject:</strong> ${ticket.subject}</p>
      <p><strong>Description:</strong><br/>${ticket.description}</p>
    `,
  });
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const {
        status,
        priority,
        category,
        search,
        mine,
        page = "1",
        limit = "20",
      } = req.query;

      const filter = {};
      if (status && status !== "all") filter.status = status;
      if (priority && priority !== "all") filter.priority = priority;
      if (category && category !== "all") filter.category = category;
      if (mine === "true") filter["createdBy.userId"] = String(req.user?.id || "");
      if (search) {
        filter.$or = [
          { ticketNumber: { $regex: String(search), $options: "i" } },
          { subject: { $regex: String(search), $options: "i" } },
          { description: { $regex: String(search), $options: "i" } },
        ];
      }

      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const skip = (pageNum - 1) * pageSize;

      const [tickets, total] = await Promise.all([
        SupportTicket.find(filter).sort({ lastActivityAt: -1, createdAt: -1 }).skip(skip).limit(pageSize).lean(),
        SupportTicket.countDocuments(filter),
      ]);

      return res.status(200).json({
        success: true,
        tickets,
        pagination: {
          page: pageNum,
          limit: pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    } catch (error) {
      console.error("Support GET error:", error);
      return res.status(500).json({ success: false, error: "Failed to fetch tickets" });
    }
  }

  if (req.method === "POST") {
    try {
      const { subject, description, category, priority, location, tags } = req.body || {};
      if (!subject || !String(subject).trim() || !description || !String(description).trim()) {
        return res.status(400).json({ success: false, error: "Subject and description are required" });
      }

      const ticketNumber = await generateTicketNumber();
      const ticket = await SupportTicket.create({
        ticketNumber,
        subject: String(subject).trim(),
        description: String(description).trim(),
        category: category || "general",
        priority: priority || "medium",
        location: location || req.user?.location || "",
        tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
        createdBy: {
          userId: String(req.user?.id || ""),
          name: req.user?.name || "",
          email: req.user?.email || "",
          role: req.user?.role || "",
        },
        comments: [
          {
            message: "Ticket created",
            byUserId: String(req.user?.id || ""),
            byName: req.user?.name || "",
            byEmail: req.user?.email || "",
            byRole: req.user?.role || "",
            internal: true,
          },
        ],
      });

      notifySupportByEmail(ticket).catch(() => {});

      return res.status(201).json({ success: true, ticket });
    } catch (error) {
      console.error("Support POST error:", error);
      return res.status(500).json({ success: false, error: "Failed to create ticket" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
