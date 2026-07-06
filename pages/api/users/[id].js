import User from "@/models/User";
import bcrypt from "bcryptjs";
import { connectToDatabase } from "@/lib/mongodb";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";

function requireAdmin(req) {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded || decoded.role !== "admin") return null;
  return decoded;
}

export default async function handler(req, res) {
  await connectToDatabase();
  const admin = requireAdmin(req);
  if (!admin) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const { id } = req.query;

  // PUT - Update a user
  if (req.method === "PUT") {
    try {
      const { name, email, password, role, permissions, isActive } = req.body;
      const updateData = {};

      if (name) updateData.name = name;
      if (email) updateData.email = String(email).trim().toLowerCase();
      if (typeof isActive === "boolean") updateData.isActive = isActive;

      const allowedRoles = ["admin", "sub-admin", "inventory", "account", "manager", "staff", "viewer"];
      if (role && allowedRoles.includes(role)) {
        updateData.role = role;
      }

      if (Array.isArray(permissions)) {
        // For admin, always set all permissions
        if (updateData.role === "admin" || (!updateData.role && (await User.findById(id))?.role === "admin")) {
          updateData.permissions = ["setup", "manage", "stock", "reporting", "expenses", "support", "staff", "assets", "users"];
        } else {
          updateData.permissions = permissions;
        }
      }

      if (password) {
        if (!/^\d{4}$/.test(password)) {
          return res.status(400).json({ error: "PIN must be exactly 4 digits" });
        }
        updateData.password = await bcrypt.hash(password, 10);
      }

      // Prevent admin from demoting themselves
      if (id === admin.id && updateData.role && updateData.role !== "admin") {
        return res.status(400).json({ error: "You cannot change your own role" });
      }

      if (id === admin.id && updateData.isActive === false) {
        return res.status(400).json({ error: "You cannot deactivate your own account" });
      }

      const user = await User.findByIdAndUpdate(id, updateData, { new: true, select: "-password" });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      return res.status(200).json({ success: true, user });
    } catch (err) {
      console.error("Update user error:", err);
      return res.status(500).json({ error: "Failed to update user" });
    }
  }

  // DELETE - Delete a user
  if (req.method === "DELETE") {
    try {
      if (id === admin.id) {
        return res.status(400).json({ error: "You cannot delete your own account" });
      }

      const user = await User.findByIdAndDelete(id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      return res.status(200).json({ success: true, message: "User deleted" });
    } catch (err) {
      console.error("Delete user error:", err);
      return res.status(500).json({ error: "Failed to delete user" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
