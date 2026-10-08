/**
 * The staff member a sign-in is linked to (Setup → Users), so the entries that user makes can
 * name them and their location without anyone picking either.
 *
 * A staff member's location is kept by name (`location`, set in Manage Staff) and by the till as
 * `locationName` / `locationId`. Entry screens pick store locations by id, so it is matched to
 * the store's own list here: by id first, then by name.
 */
import { isValidObjectId } from "mongoose";
import User from "@/models/User";
import Staff from "@/models/Staff";
import Store from "@/models/Store";

/** { _id, name, isActive, locationId, locationName } for a staff member, or null. */
export async function staffSummary(staffId) {
  if (!staffId || !isValidObjectId(staffId)) return null;
  const staff = await Staff.findById(staffId).select("name location locationName locationId isActive").lean();
  if (!staff) return null;

  const store = await Store.findOne({}).select("locations").lean();
  const locations = store?.locations || [];
  const savedName = String(staff.location || staff.locationName || "").trim();
  const match =
    (staff.locationId && locations.find((loc) => String(loc._id) === String(staff.locationId))) ||
    (savedName && locations.find((loc) => String(loc.name || "").trim().toLowerCase() === savedName.toLowerCase())) ||
    null;

  return {
    _id: String(staff._id),
    name: staff.name || "",
    isActive: staff.isActive !== false,
    locationId: match ? String(match._id) : "",
    locationName: match ? match.name : savedName,
  };
}

/**
 * The staff member to link a user to, from Setup → Users: null for none, else an id that names
 * a staff member. Returns { staffId } or { error }.
 */
export async function resolveStaffLink(value) {
  if (value === null || value === undefined || value === "") return { staffId: null };
  const staff = await staffSummary(String(value));
  if (!staff) return { error: "That staff member was not found" };
  return { staffId: staff._id };
}

/** The staff member linked to this user, or null (none linked, or since removed). */
export async function linkedStaffForUser(userId) {
  if (!userId || !isValidObjectId(userId)) return null;
  const user = await User.findById(userId).select("staffId").lean();
  return user?.staffId ? staffSummary(user.staffId) : null;
}
