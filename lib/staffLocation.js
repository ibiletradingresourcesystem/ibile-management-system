/**
 * The store location a staff member works at, in every field that reads it.
 *
 * This app shows `location`; the till reads `locationName` and `locationId` (its login picks the
 * staff member's location, its header shows the store name, and its staff list filters on it).
 * Only `location` used to be saved here, so the till showed "NO STORE" for staff whose location
 * was set in this app.
 */
import Store from "@/models/Store";

/** { location, locationName, locationId } for a location picked by name (or id). */
export async function staffLocationFields(value) {
  const wanted = String(value || "").trim();
  if (!wanted) return { location: "", locationName: "", locationId: null };

  const store = await Store.findOne({}).select("locations").lean();
  const match = (store?.locations || []).find(
    (loc) => String(loc._id) === wanted || String(loc.name || "").trim().toLowerCase() === wanted.toLowerCase()
  );
  if (!match) return { location: wanted, locationName: wanted, locationId: null };
  return { location: match.name, locationName: match.name, locationId: match._id };
}
