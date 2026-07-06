import crypto from "crypto";
import { mongooseConnect } from "@/lib/mongodb";
import User from "@/models/User";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function clearPendingEmailChange(user) {
  user.pendingEmail = "";
  user.emailChangeTokenHash = "";
  user.emailChangeExpiresAt = null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  const token = String(req.query.token || "").trim();
  if (!token) {
    return res.status(400).json({ success: false, message: "Verification token is required" });
  }

  try {
    await mongooseConnect();

    const user = await User.findOne({
      emailChangeTokenHash: hashToken(token),
    }).select("_id name email role pendingEmail emailChangeTokenHash emailChangeExpiresAt");

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "This email change link is invalid or has already been used.",
      });
    }

    if (!user.pendingEmail || !user.emailChangeExpiresAt || new Date(user.emailChangeExpiresAt) <= new Date()) {
      clearPendingEmailChange(user);
      await user.save();

      return res.status(400).json({
        success: false,
        message: "This email change link has expired. Request a new email change from setup.",
      });
    }

    const nextEmail = normalizeEmail(user.pendingEmail);
    if (!nextEmail) {
      clearPendingEmailChange(user);
      await user.save();

      return res.status(400).json({
        success: false,
        message: "The pending admin email is invalid. Request the change again from setup.",
      });
    }

    const existingUser = await User.findOne({
      email: nextEmail,
      _id: { $ne: user._id },
    }).select("_id");

    if (existingUser) {
      clearPendingEmailChange(user);
      await user.save();

      return res.status(409).json({
        success: false,
        message: "That new email address is already in use by another account. Request a different admin email from setup.",
      });
    }

    user.email = nextEmail;
    clearPendingEmailChange(user);
    await user.save();

    return res.status(200).json({
      success: true,
      message: `Admin email updated successfully to ${nextEmail}.`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Verify admin email change error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify admin email change",
    });
  }
}