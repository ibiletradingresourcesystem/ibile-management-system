/**
 * API: POST /api/stock-take/mobile/auth
 * Authenticates a staff member for mobile stock take access.
 * Returns a session token for the mobile stock take page.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Staff from "@/models/Staff";
import crypto from "crypto";

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const attempt = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
  return attempt === hash;
}

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
    if (!staff.password || !verifyPassword(password, staff.password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Generate a session token
    const payload = JSON.stringify({
      staffId: staff._id,
      staffName: staff.name,
      stockTakeId: stockTakeId || null,
      ts: Date.now(),
    });
    const token = Buffer.from(payload).toString("base64url");

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
