import { mongooseConnect } from "@/lib/mongodb";
import Account from "@/models/Account";
import JournalEntry from "@/models/JournalEntry";
import { authMiddleware, isStaff, isAdmin } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();
  const { id } = req.query;

  try {
    if (req.method === "PUT") {
      const account = await Account.findById(id);
      if (!account) return res.status(404).json({ success: false, message: "Account not found" });

      const { name, subType, description, isActive, openingBalance } = req.body;

      // Don't allow changing code or type on system accounts
      if (!account.isSystem) {
        if (req.body.code) account.code = req.body.code.trim();
        if (req.body.type) account.type = req.body.type;
        if (req.body.normalBalance) account.normalBalance = req.body.normalBalance;
      }

      if (name) account.name = name.trim();
      if (subType !== undefined) account.subType = subType;
      if (description !== undefined) account.description = description;
      if (isActive !== undefined) account.isActive = isActive;
      if (openingBalance !== undefined) account.openingBalance = parseFloat(openingBalance) || 0;

      await account.save();
      return res.status(200).json({ success: true, account });
    }

    if (req.method === "DELETE") {
      if (!isAdmin(req)) return res.status(403).json({ error: "Only admins can delete accounts" });

      const account = await Account.findById(id);
      if (!account) return res.status(404).json({ success: false, message: "Account not found" });
      if (account.isSystem) return res.status(400).json({ success: false, message: "Cannot delete system accounts" });

      // Check if account has journal entries
      const hasEntries = await JournalEntry.exists({ "lines.account": id, status: "POSTED" });
      if (hasEntries) {
        return res.status(400).json({ success: false, message: "Cannot delete account with posted journal entries. Deactivate it instead." });
      }

      await Account.findByIdAndDelete(id);
      return res.status(200).json({ success: true, message: "Account deleted" });
    }

    res.setHeader("Allow", ["PUT", "DELETE"]);
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error("Account API error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
}
