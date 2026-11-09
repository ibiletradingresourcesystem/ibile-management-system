import { mongooseConnect } from "@/lib/mongodb";
import { Staff } from "@/models/Staff";
import { authMiddleware, isAdmin, isStaff } from "@/lib/auth-middleware";
import { userCan } from "@/lib/permission-utils";
import {
  normalizePosPermissions,
  normalizeStaffRole,
} from "@/lib/pos-permissions";
import { staffLocationFields } from "@/lib/staffLocation";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  await mongooseConnect();

  const { id } = req.query;

  // Manage Staff changes everything about a staff member; POS Roles only their role and access
  const managesStaff = userCan(req.user, "manage.staff");
  if (!managesStaff && req.method !== "PUT") {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method === "PUT") {
    try {
      const {
        name,
        password,
        location,
        role,
        posPermissions,
        accountName,
        accountNumber,
        bankName,
        salary,
        isActive,
      } = req.body;

      if (!name) {
        return res.status(400).json({ error: "Name is required." });
      }

      const normalizedRole = normalizeStaffRole(role);

      // Only recalculate posPermissions if explicitly provided or role changed
      const existingStaff = await Staff.findById(id).select("role posPermissions").lean();
      if (normalizedRole === "admin" && normalizeStaffRole(existingStaff?.role) !== "admin" && !isAdmin(req)) {
        return res.status(403).json({ error: "Only an admin can give someone the admin role" });
      }
      let resolvedPermissions;
      if (posPermissions !== undefined) {
        // Explicit permissions sent — normalize them
        resolvedPermissions = normalizePosPermissions(normalizedRole, posPermissions);
      } else if (existingStaff && normalizeStaffRole(existingStaff.role) !== normalizedRole) {
        // Role changed but no explicit permissions — apply new role defaults
        resolvedPermissions = normalizePosPermissions(normalizedRole, {});
      } else {
        // Neither permissions nor role changed — preserve existing
        resolvedPermissions = existingStaff?.posPermissions || normalizePosPermissions(normalizedRole, {});
      }

      const updateData = managesStaff
        ? {
            name,
            // location, and the locationName and locationId the till reads
            ...(await staffLocationFields(location)),
            role: normalizedRole,
            posPermissions: resolvedPermissions,
            accountName: accountName || "",
            accountNumber: accountNumber || "",
            bankName: bankName || "",
            salary: salary ? parseInt(salary) : 0,
            isActive: isActive !== undefined ? isActive : true,
          }
        : { role: normalizedRole, posPermissions: resolvedPermissions };

      if (managesStaff && req.body.photo !== undefined) {
        updateData.photo = req.body.photo;
      }

      // Only hash password if provided
      if (managesStaff && password) {
        const bcrypt = require("bcryptjs");
        updateData.password = await bcrypt.hash(password, 10);
      }

      const updated = await Staff.findByIdAndUpdate(id, updateData, {
        new: true,
        select: "-password",
      });

      if (!updated) {
        return res.status(404).json({ error: "Staff not found." });
      }

      res.status(200).json(updated);
    } catch (err) {
      console.error("Update failed:", err);
      res.status(500).json({ error: "Server error." });
    }
  } else if (req.method === "DELETE") {
    try {
      const deleted = await Staff.findByIdAndDelete(id);
      if (!deleted) {
        return res.status(404).json({ error: "Staff not found." });
      }
      return res.status(200).json({ success: true, message: "Staff deleted." });
    } catch (err) {
      console.error("Delete failed:", err);
      return res.status(500).json({ error: "Server error." });
    }
  } else if (req.method === "PATCH") {
    try {
      const { showOnPos } = req.body;
      if (typeof showOnPos !== "boolean") {
        return res.status(400).json({ error: "showOnPos must be a boolean." });
      }
      const updated = await Staff.findByIdAndUpdate(
        id,
        { showOnPos },
        { new: true, select: "-password" }
      );
      if (!updated) {
        return res.status(404).json({ error: "Staff not found." });
      }
      return res.status(200).json(updated);
    } catch (err) {
      console.error("Patch failed:", err);
      return res.status(500).json({ error: "Server error." });
    }
  } else {
    res.setHeader("Allow", ["PUT", "DELETE", "PATCH"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
