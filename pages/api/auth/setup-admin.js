import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import nodemailer from "nodemailer";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, email, code, name, password } = req.body || {};

  await connectToDatabase();

  // Check if admin already exists
  const adminCount = await User.countDocuments({ role: "admin" });
  if (adminCount > 0) {
    return res.status(400).json({ error: "Admin account already exists. Use the login page." });
  }

  const adminEmail = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!adminEmail) {
    return res.status(500).json({ error: "ADMIN_EMAIL is not configured on the server." });
  }

  // Step 1: Send verification code
  if (action === "send-code") {
    const submittedEmail = String(email || "").trim().toLowerCase();

    if (!submittedEmail) {
      return res.status(400).json({ error: "Email is required." });
    }

    if (submittedEmail !== adminEmail) {
      return res.status(403).json({ error: "This email is not authorized to create an admin account." });
    }

    // Generate 6-digit code
    const verificationCode = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store code in a temporary collection or use a simple in-memory approach
    // Using a dedicated document in User collection with a special marker
    await User.findOneAndUpdate(
      { email: `__setup_pending__` },
      {
        email: `__setup_pending__`,
        name: "setup",
        password: verificationCode,
        role: "viewer",
        pendingEmail: submittedEmail,
        emailChangeExpiresAt: expiresAt,
        isActive: false,
      },
      { upsert: true, new: true }
    );

    // Send email
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.FROM_EMAIL || process.env.EMAIL_USER,
        to: submittedEmail,
        subject: "Admin Setup Verification Code",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1e40af;">Admin Setup Verification</h2>
            <p>Your verification code is:</p>
            <div style="background: #f0f4ff; border: 2px solid #1e40af; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e40af;">${verificationCode}</span>
            </div>
            <p style="color: #666; font-size: 14px;">This code expires in 10 minutes.</p>
            <p style="color: #666; font-size: 12px;">If you didn't request this, please ignore this email.</p>
          </div>
        `,
      });

      return res.status(200).json({ success: true, message: "Verification code sent to your email." });
    } catch (err) {
      console.error("Email send error:", err);
      return res.status(500).json({ error: "Failed to send verification email. Check server email configuration." });
    }
  }

  // Step 2: Verify code and create admin
  if (action === "verify-and-create") {
    if (!code || !name || !password) {
      return res.status(400).json({ error: "Verification code, name, and PIN are required." });
    }

    if (!/^\d{4}$/.test(password)) {
      return res.status(400).json({ error: "PIN must be exactly 4 digits." });
    }

    // Find pending setup
    const pending = await User.findOne({ email: `__setup_pending__`, isActive: false });
    if (!pending) {
      return res.status(400).json({ error: "No pending setup found. Please request a new code." });
    }

    // Check expiry
    if (pending.emailChangeExpiresAt && new Date() > pending.emailChangeExpiresAt) {
      await User.deleteOne({ email: `__setup_pending__` });
      return res.status(400).json({ error: "Verification code has expired. Please request a new one." });
    }

    // Check code
    if (pending.password !== String(code).trim()) {
      return res.status(400).json({ error: "Invalid verification code." });
    }

    const verifiedEmail = pending.pendingEmail;

    // Remove the temporary record
    await User.deleteOne({ email: `__setup_pending__` });

    // Create the admin user
    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = await User.create({
      email: verifiedEmail,
      password: hashedPassword,
      name: String(name).trim(),
      role: "admin",
      permissions: ["setup", "manage", "stock", "reporting", "expenses", "support", "staff", "assets", "users"],
      isActive: true,
    });

    return res.status(201).json({
      success: true,
      message: "Admin account created successfully. You can now log in.",
      user: { id: admin._id, name: admin.name, email: admin.email, role: admin.role },
    });
  }

  return res.status(400).json({ error: "Invalid action." });
}
