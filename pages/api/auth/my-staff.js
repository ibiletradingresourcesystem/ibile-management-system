/**
 * API: /api/auth/my-staff
 *
 * GET — the staff member the signed-in user is linked to, with their store location:
 *       { staff: { _id, name, isActive, locationId, locationName } } or { staff: null }.
 *       Entry screens use it to fill in their staff and location fields.
 */
import { connectToDatabase } from "@/lib/mongodb";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { linkedStaffForUser } from "@/lib/linkedStaff";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const decoded = verifyToken(getTokenFromRequest(req) || "");
  if (!decoded?.id) return res.status(401).json({ error: "Invalid or expired token" });

  try {
    await connectToDatabase();
    const staff = await linkedStaffForUser(decoded.id);
    // A staff member who has left is not filled in on new entries
    return res.status(200).json({ staff: staff?.isActive ? staff : null });
  } catch (err) {
    console.error("Linked staff lookup failed:", err);
    return res.status(500).json({ error: "Could not load your staff details" });
  }
}
