/**
 * API: /api/stock-take/mobile/auth
 *
 * GET  — the staff who may sign in to this count, so the phone can offer the
 *        same "pick your name, then type your PIN" flow as the main login
 *        instead of asking someone to type a username on a phone keyboard.
 *        Only display names are returned; no contact details, no credentials.
 * POST — authenticates a staff member and returns a scoped session token.
 */
import { mongooseConnect } from "@/lib/mongodb";
import Staff from "@/models/Staff";
import StockTake from "@/models/StockTake";
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
  await mongooseConnect();

  if (req.method === "GET") {
    const { stockTakeId } = req.query || {};

    try {
      let stockTake = null;
      if (stockTakeId && /^[0-9a-fA-F]{24}$/.test(String(stockTakeId))) {
        stockTake = await StockTake.findById(stockTakeId)
          .select("reference title locationName status")
          .lean();
      }

      // Staff names are only listed for a real count that is still open, so a
      // stale or guessed link cannot be used to enumerate the team.
      if (!stockTake || !["draft", "in-progress"].includes(stockTake.status)) {
        return res.status(200).json({
          success: true,
          staff: [],
          stockTake: null,
          message: stockTake
            ? "This stock take is no longer open for counting."
            : "This stock take link is not valid.",
        });
      }

      const staff = await Staff.find({ isActive: { $ne: false } })
        .select("name location role")
        .sort({ name: 1 })
        .lean();

      // Staff assigned to this location come first; the rest stay available so
      // cover staff are never locked out of a count.
      const locationName = stockTake?.locationName || "";
      const ranked = staff
        .map((member) => ({
          _id: String(member._id),
          name: member.name,
          location: member.location || "",
          assignedHere: Boolean(locationName) && member.location === locationName,
        }))
        .sort((a, b) => {
          if (a.assignedHere !== b.assignedHere) return a.assignedHere ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      return res.status(200).json({
        success: true,
        staff: ranked,
        stockTake: {
          reference: stockTake.reference,
          title: stockTake.title,
          locationName: stockTake.locationName,
          status: stockTake.status,
        },
      });
    } catch (err) {
      console.error("Mobile stock take staff list error:", err.message);
      return res.status(500).json({ error: "Could not load the staff list" });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
