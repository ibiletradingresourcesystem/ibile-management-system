import { mongooseConnect } from "@/lib/mongodb";
import DailyCash from "@/models/DailyCash";
import Expense from "@/models/Expense";
import EndOfDayReport from "@/models/EndOfDayReport";
import Store from "@/models/Store";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { cashForReport, countedCash } from "@/lib/endOfDayCash";
import { updateDailyCashChain } from "@/lib/dailyCashChain";

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
        // openingBalance, physicalCount and tenderActual are what "counted" is read from
        .select("date locationId locationName staffName closedAt openingBalance physicalCount expectedClosingBalance totalSales tenderBreakdown tenderActual")
        .sort({ date: -1 })
        .limit(60)
        .lean(),
      Store.findOne({}).select("locations").lean(),
    ]);

    // Merge closed EOD cash tender data for days without a manual DailyCash entry
    const locMap = {};
    if (store?.locations) {
      for (const loc of store.locations) locMap[String(loc._id)] = loc.name;
    }

    // Days are kept in local time: a date stored at local midnight is the previous day in UTC,
    // so an ISO key would put an entry on the wrong day
    const dayKey = (value) => {
      const d = new Date(value);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    const seen = new Set(records.map((r) => {
      const d = new Date(r.date); d.setHours(0, 0, 0, 0);
      return `${r.location}|${dayKey(d)}`;
    }));

    // A day can have more than one till closing on it, so they are added up rather than the first
    // one standing for the day. The amount is what was counted in the drawer, not what the sales
    // say should have been there.
    const derived = new Map();
    for (const rpt of eodReports) {
      const locName = locMap[String(rpt.locationId)] || rpt.locationName;
      if (!locName || (location && locName !== location)) continue;
      const d = new Date(rpt.date || rpt.closedAt); d.setHours(0, 0, 0, 0);
      const key = `${locName}|${dayKey(d)}`;
      if (seen.has(key)) continue;

      const entry = derived.get(key) || {
        _id: `eod-${rpt._id}`,
        date: d,
        amount: 0,
        location: locName,
        staffName: rpt.staffName || "",
        source: "pos",
        counted: false,
      };
      entry.amount += cashForReport(rpt);
      entry.counted = entry.counted || countedCash(rpt) !== null;
      derived.set(key, entry);
    }
    for (const entry of derived.values()) {
      if (entry.amount <= 0) continue;
      records.push(entry);
    }

    records.sort((a, b) => new Date(b.date) - new Date(a.date));
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
      // Typed in here unless the caller says it came from a till
      existing.source = source === "pos" ? "pos" : "manual";
      if (posSessionId) existing.posSessionId = posSessionId;
      await existing.save();
      await updateDailyCashChain({ location, date: dayStart }).catch((error) =>
        console.warn("Daily cash chain update failed:", error.message)
      );
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
    await updateDailyCashChain({ location, date: dayStart }).catch((error) =>
      console.warn("Daily cash chain update failed:", error.message)
    );
    return res.status(201).json(record);
  }

  return res.status(405).json({ error: "Method not allowed" });
}
