import { mongooseConnect } from "@/lib/mongodb";
import DailyCash from "@/models/DailyCash";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { updateDailyCashChain } from "@/lib/dailyCashChain";
import { dayKeyOf } from "@/lib/tradingDay";

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
    if (amount != null) {
      record.amount = Number(amount);
      // A corrected figure is a person's count. Left as "pos", the next rebuild of the day would
      // put the tills' figure back over it without a word.
      record.source = "manual";
      // ...and it is the whole day's cash, so anything added on top before is part of it
      record.addedCash = 0;
    }
    if (staffName != null) record.staffName = staffName;
    await record.save();

    // Everything carried forward from this day changes with it
    if (amount != null) {
      await updateDailyCashChain({ location: record.location, day: dayKeyOf(record.date) }).catch((error) =>
        console.warn("Daily cash chain update failed:", error.message)
      );
    }
    return res.status(200).json(await DailyCash.findById(id).lean());
  }

  if (req.method === "DELETE") {
    await DailyCash.findByIdAndDelete(id);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
