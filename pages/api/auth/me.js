import User from "@/models/User";
import { connectToDatabase } from "@/lib/mongodb";
import { authMiddleware } from "@/lib/auth-middleware";
import { normalizePermissions } from "@/lib/permission-utils";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Refuses a deactivated user, and fills in the role and permissions they have now
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  // Fast path: no database trip unless a refresh is asked for
  const wantRefresh = req.query.refresh === "1";
  if (!wantRefresh && req.user.permissions) {
    return res.status(200).json({
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        role: req.user.role,
        isActive: true,
        permissions: normalizePermissions(req.user.permissions),
      },
    });
  }

  // Full DB check (refresh or legacy token without permissions)
  await connectToDatabase();

  const user = await User.findById(req.user.id).select("name email role permissions isActive").lean();
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
