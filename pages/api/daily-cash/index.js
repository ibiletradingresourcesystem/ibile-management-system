import { mongooseConnect } from "@/lib/mongodb";
import DailyCash from "@/models/DailyCash";
import Expense from "@/models/Expense";
import EndOfDayReport from "@/models/EndOfDayReport";
import Store from "@/models/Store";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();

  if (req.method === "GET") {
    const { location, date } = req.query;
    const cashFilter = {};
    if (location) cashFilter.location = location;
    const eodFilter = { closedAt: { $ne: null } };

    if (date) {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      cashFilter.date = { $gte: dayStart, $lt: dayEnd };
      eodFilter.date = { $gte: dayStart, $lt: dayEnd };
    }

    const [records, eodReports, store] = await Promise.all([
      DailyCash.find(cashFilter).sort({ date: -1 }).limit(60).lean(),
      EndOfDayReport.find(eodFilter)
        .select("date locationId staffName tenderBreakdown closedAt")
        .sort({ date: -1 })
        .limit(60)
        .lean(),
      Store.findOne({}).select("locations").lean(),
    ]);

    // Merge closed EOD cash tender data — sum all EOD reports per day+location
    const locMap = {};
    if (store?.locations) {
      for (const loc of store.locations) locMap[String(loc._id)] = loc.name;
    }

    const seen = new Set(records.map((r) => {
      const d = new Date(r.date); d.setHours(0, 0, 0, 0);
      return `${r.location}|${d.toISOString().split("T")[0]}`;
    }));

    // Group EOD reports by day+location and sum their cash
    const eodGrouped = {};
    for (const rpt of eodReports) {
      const locName = locMap[String(rpt.locationId)];
      if (!locName || (location && locName !== location)) continue;
      const d = new Date(rpt.date); d.setHours(0, 0, 0, 0);
      const key = `${locName}|${d.toISOString().split("T")[0]}`;
      if (seen.has(key)) continue;
      if (!eodGrouped[key]) eodGrouped[key] = { date: d, location: locName, amount: 0, staffName: rpt.staffName || "" };
      eodGrouped[key].amount += (rpt.tenderBreakdown?.CASH || 0);
    }

    for (const [key, entry] of Object.entries(eodGrouped)) {
      if (entry.amount <= 0) continue;
      seen.add(key);
      records.push({
        _id: `eod-${key}`,
        date: entry.date,
        amount: entry.amount,
        location: entry.location,
        staffName: entry.staffName,
        source: "pos",
      });
    }

    records.sort((a, b) => new Date(b.date) - new Date(a.date));
    return res.status(200).json(records);
  }

  if (req.method === "POST") {
    const { date, amount, location, staffName, source, posSessionId, mode } = req.body;
    if (!date || amount == null || !location) {
      return res.status(400).json({ error: "Date, amount, and location are required" });
    }

    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const existing = await DailyCash.findOne({ date: { $gte: dayStart, $lt: dayEnd }, location });
    if (existing) {
      if (mode === "add") {
        existing.amount = Number(existing.amount || 0) + Number(amount);
      } else {
        existing.amount = Number(amount);
      }
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
