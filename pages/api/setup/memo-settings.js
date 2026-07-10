import { mongooseConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import { authMiddleware, isAdmin } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isAdmin(req)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  await mongooseConnect();

  try {
    const { directorName, companyBankName, companyBankBranch, companyAccountName, companyAccountNumber, companyAddress, companyRegNumber, memoDirectors, memoAccounts } = req.body;

    const store = await Store.findOne({});
    if (!store) {
      return res.status(404).json({ error: "Store not found" });
    }

    if (directorName !== undefined) store.directorName = directorName;
    if (companyBankName !== undefined) store.companyBankName = companyBankName;
    if (companyBankBranch !== undefined) store.companyBankBranch = companyBankBranch;
    if (companyAccountName !== undefined) store.companyAccountName = companyAccountName;
    if (companyAccountNumber !== undefined) store.companyAccountNumber = companyAccountNumber;
    if (companyAddress !== undefined) store.companyAddress = companyAddress;
    if (companyRegNumber !== undefined) store.companyRegNumber = companyRegNumber;
    if (Array.isArray(memoDirectors)) store.memoDirectors = memoDirectors.filter(Boolean);
    if (Array.isArray(memoAccounts)) store.memoAccounts = memoAccounts.filter(a => a?.accountName);

    await store.save();

    return res.status(200).json({
      success: true,
      message: "Memo settings saved",
      memoDirectors: store.memoDirectors || [],
      memoAccounts: store.memoAccounts || [],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
