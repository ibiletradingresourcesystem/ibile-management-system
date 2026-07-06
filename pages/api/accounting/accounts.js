import { mongooseConnect } from "@/lib/mongodb";
import Account from "@/models/Account";
import { seedDefaultAccounts } from "@/lib/accounting";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();

  try {
    if (req.method === "GET") {
      // Seed defaults on first load
      await seedDefaultAccounts();

      const accounts = await Account.find()
        .populate("parent", "code name")
        .sort({ code: 1 })
        .lean();
      return res.status(200).json({ success: true, accounts });
    }

    if (req.method === "POST") {
      const { code, name, type, subType, normalBalance, parent, description, openingBalance } = req.body;

      if (!code || !name || !type || !normalBalance) {
        return res.status(400).json({ success: false, message: "Code, name, type, and normal balance are required" });
      }

      const existing = await Account.findOne({ code });
      if (existing) {
        return res.status(400).json({ success: false, message: `Account code "${code}" already exists` });
      }

      const account = await Account.create({
        code: code.trim(),
        name: name.trim(),
        type,
        subType: subType || "",
        normalBalance,
        parent: parent || null,
        description: description || "",
        openingBalance: parseFloat(openingBalance) || 0,
      });

      return res.status(201).json({ success: true, account });
    }

    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).json({ message: "Method not allowed" });
  } catch (error) {
    console.error("Accounts API error:", error);
    return res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
}
