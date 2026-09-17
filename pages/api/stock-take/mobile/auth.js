/**
 * API: POST /api/stock-take/mobile/auth
 * Authenticates a staff member for mobile stock take access.
 * Returns a session token for the mobile stock take page.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Staff from "@/models/Staff";
import bcrypt from "bcryptjs";
import { createToken } from "@/lib/jwt";
import crypto from "crypto";

/**
 * Staff passwords are set with bcrypt (see /api/staff), which is what a mobile sign-in has to
 * check against — comparing them as pbkdf2 never matched, so no one could open a mobile count.
 * The old "salt:hash" form is still accepted for any account saved before that.
 */
async function verifyPassword(password, stored) {
  if (!stored) return false;

  if (stored.startsWith("$2")) {
    return bcrypt.compare(password, stored);
  }

  if (stored.includes(":")) {
    const [salt, hash] = stored.split(":");
    const attempt = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
    return attempt === hash;
  }

  return false;
}

const MOBILE_SCOPE = "stock-take-mobile";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  const { username, password, stockTakeId } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  try {
    // Find staff by name (case-insensitive) or email
    const staff = await Staff.findOne({
      $or: [
        { name: { $regex: new RegExp(`^${username.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") } },
        { email: username.trim().toLowerCase() },
      ],
      isActive: { $ne: false },
    }).select("+password");

    if (!staff) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Verify password
    if (!staff.password || !(await verifyPassword(password, staff.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // A signed session token — a plain base64 payload could be written by anyone
    const token = createToken(
      {
        staffId: String(staff._id),
        staffName: staff.name,
        stockTakeId: stockTakeId ? String(stockTakeId) : null,
        scope: MOBILE_SCOPE,
      },
      "12h"
    );

    return res.status(200).json({
      success: true,
      token,
      staff: { _id: staff._id, name: staff.name },
    });
  } catch (err) {
    console.error("Mobile stock take auth error:", err.message);
    return res.status(500).json({ error: "Authentication failed" });
  }
}
