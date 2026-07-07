import { mongooseConnect } from "@/lib/mongodb";
import DailyCash from "@/models/DailyCash";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();
  const { id } = req.query;

  if (req.method === "PUT") {
    const { amount, staffName } = req.body;
    const record = await DailyCash.findById(id);
    if (!record) return res.status(404).json({ error: "Record not found" });
    if (amount != null) record.amount = Number(amount);
    if (staffName != null) record.staffName = staffName;
    await record.save();
    return res.status(200).json(record);
  }

  if (req.method === "DELETE") {
    await DailyCash.findByIdAndDelete(id);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
