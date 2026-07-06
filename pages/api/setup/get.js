import { mongooseConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import User from "@/models/User";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

function sanitizeUser(user) {
  if (!user) return null;
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    const [store, user] = await Promise.all([
      Store.findOne({}),
      User.findOne({ role: "admin" }).select(
        "name email role isActive createdAt updatedAt"
      ),
    ]);

    if (store || user) {
      const authError = authMiddleware(req, res);
      if (authError) return authError;
      if (!isStaff(req)) {
        return res
          .status(403)
          .json({ success: false, message: "Insufficient permissions" });
      }
    }

    return res.status(200).json({
      store: store ? store.toObject() : null,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error("Fetch setup error:", err);
    if (res.headersSent || res.writableEnded) {
      return;
    }

    return res.status(500).json({
      message: "Internal Server Error",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}
