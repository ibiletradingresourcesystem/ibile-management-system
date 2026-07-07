import { mongooseConnect } from "@/lib/mongodb";
import DailyCash from "@/models/DailyCash";
import Expense from "@/models/Expense";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();

  if (req.method === "GET") {
    const { location, date } = req.query;
    const filter = {};
    if (location) filter.location = location;
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      filter.date = { $gte: start, $lt: end };
    }
    const records = await DailyCash.find(filter).sort({ date: -1 }).limit(60).lean();
    return res.status(200).json(records);
  }

  if (req.method === "POST") {
    const { date, amount, location, staffName, source, posSessionId } = req.body;
    if (!date || amount == null || !location) {
      return res.status(400).json({ error: "Date, amount, and location are required" });
    }

    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Upsert: one record per location per day
    const existing = await DailyCash.findOne({ date: { $gte: dayStart, $lt: dayEnd }, location });
    if (existing) {
      existing.amount = Number(amount);
      existing.staffName = staffName || existing.staffName;
      if (source) existing.source = source;
      if (posSessionId) existing.posSessionId = posSessionId;
      await existing.save();
      return res.status(200).json(existing);
    }

    const record = await DailyCash.create({
      date: dayStart,
      amount: Number(amount),
      location,
      staffName: staffName || "",
      source: source || "manual",
      posSessionId: posSessionId || "",
    });
    return res.status(201).json(record);
  }

  return res.status(405).json({ error: "Method not allowed" });
}
