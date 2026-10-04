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
      return res.status(200).json({ success: true, status: await getAccountingSyncStatus() });
    }

    if (req.method === "POST") {
      // { auto: true } is a page bringing the books up to date as it opens: skipped if they were
      // synced in the last few minutes. Without it, it is the Sync button, and it runs now.
      const auto = Boolean(req.body?.auto);
      const result = await ensureAccountingEntriesSynced({ force: !auto });
      if (result?.running && !auto) {
        return res.status(409).json({
          success: false,
          message: "The books are already being brought up to date. Give it a minute and look again.",
          status: await getAccountingSyncStatus(),
        });
      }
      return res.status(200).json({ success: true, result, status: await getAccountingSyncStatus() });
    }

    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error("Accounting sync API error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
}