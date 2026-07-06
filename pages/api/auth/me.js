import User from "@/models/User";
import { connectToDatabase } from "@/lib/mongodb";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { normalizePermissions } from "@/lib/permission-utils";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: "Missing authentication token" });
  }

  const decoded = verifyToken(token);
  if (!decoded?.id) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  await connectToDatabase();

  const user = await User.findById(decoded.id).select("name email role permissions isActive").lean();
  if (!user || !user.isActive) {
    return res.status(401).json({ error: "Account is unavailable" });
  }

  return res.status(200).json({
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      permissions: normalizePermissions(user.permissions || []),
    },
  });
}