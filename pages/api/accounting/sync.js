import { mongooseConnect } from "@/lib/mongodb";
import { ensureAccountingEntriesSynced, getAccountingSyncStatus } from "@/lib/accounting";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();

  try {
    if (req.method === "GET") {
      return res.status(200).json({ success: true, status: getAccountingSyncStatus() });
    }

    if (req.method === "POST") {
      const result = await ensureAccountingEntriesSynced({ force: true });
      return res.status(200).json({ success: true, result, status: getAccountingSyncStatus() });
    }

    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error("Accounting sync API error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
}