import { connectToDatabase } from "@/lib/mongodb";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import Staff from "@/models/Staff";
import nodemailer from "nodemailer";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = getTokenFromRequest(req);
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { staffId, email } = req.body;
  if (!staffId || !email) {
    return res.status(400).json({ error: "Staff ID and email are required" });
  }

  try {
    await connectToDatabase();
    const staff = await Staff.findById(staffId);
    if (!staff || !staff.onboardingToken) {
      return res.status(404).json({ error: "Staff not found or no onboarding token" });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `https://${req.headers.host}`;
    const onboardingLink = `${baseUrl}/onboarding/${staff.onboardingToken}`;

    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || "smtp.gmail.com",
      port: parseInt(process.env.EMAIL_PORT || "587"),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: `Onboarding Form - ${staff.name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #1e40af;">Staff Onboarding Form</h2>
          <p>Hello <strong>${staff.name}</strong>,</p>
          <p>Please complete your onboarding form by clicking the link below. This form collects your personal details and guarantor information.</p>
          <div style="margin: 30px 0; text-align: center;">
            <a href="${onboardingLink}" style="background: #2563eb; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">
              Complete Onboarding Form
            </a>
          </div>
          <p style="color: #6b7280; font-size: 14px;">If the button doesn't work, copy and paste this link: <br/><a href="${onboardingLink}">${onboardingLink}</a></p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">This is an automated message. Please do not reply.</p>
        </div>
      `,
    });

    return res.status(200).json({ success: true, message: `Onboarding link sent to ${email}` });
  } catch (err) {
    console.error("Send onboarding email error:", err);
    const detail = err.code === "EAUTH" 
      ? "Email authentication failed. Check EMAIL_USER and EMAIL_PASS in .env" 
      : err.code === "ECONNREFUSED" 
        ? "Could not connect to email server. Check EMAIL_HOST and EMAIL_PORT in .env"
        : err.message || "Failed to send onboarding email";
    return res.status(500).json({ error: detail });
  }
}
