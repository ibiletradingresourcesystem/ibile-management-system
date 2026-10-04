import { mongooseConnect } from "@/lib/mongodb";
import DailyCash from "@/models/DailyCash";
import EndOfDayReport from "@/models/EndOfDayReport";
import Store from "@/models/Store";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { cashForReport, countedCash } from "@/lib/endOfDayCash";
import { findDayRow, typedByPerson, updateDailyCashChain } from "@/lib/dailyCashChain";
import { dayDate, dayDatesRange, dayKeyOf, tradingDayKey, tradingDaysRange } from "@/lib/tradingDay";

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

    // A day is a trading day, 6am to 6am: a till closed at 1:30am is the day before's cash
    const day = date ? dayKeyOf(date) : null;
    if (day) {
      cashFilter.date = dayDatesRange(day);
      eodFilter.closedAt = tradingDaysRange(day);
    }

    const [records, eodReports, store] = await Promise.all([
      DailyCash.find(cashFilter).sort({ date: -1 }).limit(60).lean(),
      EndOfDayReport.find(eodFilter)
        // openingBalance, physicalCount and tenderActual are what "counted" is read from
        .select("date locationId locationName staffName closedAt openingBalance physicalCount expectedClosingBalance totalSales tenderBreakdown tenderActual")
        .sort({ closedAt: -1 })
        .limit(60)
        .lean(),
      Store.findOne({}).select("locations").lean(),
    ]);

    // Merge closed EOD cash tender data for days without a manual DailyCash entry
    const locMap = {};
    if (store?.locations) {
      for (const loc of store.locations) locMap[String(loc._id)] = loc.name;
    }

    // Each entry says which day it is, so a page does not have to work it out of a date in its own
    // time zone
    for (const record of records) record.day = dayKeyOf(record.date);
    const seen = new Set(records.map((r) => `${r.location}|${r.day}`));

    // A day can have more than one till closing on it, so they are added up rather than the first
    // one standing for the day. The amount is what was counted in the drawer, not what the sales
    // say should have been there.
    const derived = new Map();
    for (const rpt of eodReports) {
      const locName = locMap[String(rpt.locationId)] || rpt.locationName;
      if (!locName || (location && locName !== location)) continue;
      const reportDay = tradingDayKey(rpt.closedAt);
      const key = `${locName}|${reportDay}`;
      if (!reportDay || seen.has(key)) continue;

      const entry = derived.get(key) || {
        _id: `eod-${rpt._id}`,
        date: dayDate(reportDay),
        day: reportDay,
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

    records.sort((a, b) => String(b.day).localeCompare(String(a.day)));
    return res.status(200).json(records);
  }

  if (req.method === "POST") {
    const { date, amount, location, staffName, source, posSessionId, mode } = req.body;
    if (!date || amount == null || !location) {
      return res.status(400).json({ error: "Date, amount, and location are required" });
    }
    const day = dayKeyOf(date);
    const value = Number(amount);
    if (!day) return res.status(400).json({ error: "Date is not a valid day" });
    if (!Number.isFinite(value)) return res.status(400).json({ error: "Amount must be a number" });

    // "Add to Existing" puts cash on top of the day's figure. On a day the tills set, it is kept
    // apart and added to their cash, so a till that closes afterwards still counts; on a day a
    // person set, it goes onto their figure. "Set / Replace" makes the figure the person's own.
    const adding = mode === "add";

    // One record per location per day
    const existing = await findDayRow(location, day);
    if (existing) {
      if (adding && typedByPerson(existing)) {
        existing.amount = (Number(existing.amount) || 0) + value;
      } else if (adding) {
        existing.addedCash = (Number(existing.addedCash) || 0) + value;
      } else {
        existing.amount = value;
        // Typed in here unless the caller says it came from a till
        existing.source = source === "pos" ? "pos" : "manual";
        // The figure typed is the whole day's cash, so what was added on top before is part of it
        existing.addedCash = 0;
      }
      existing.staffName = staffName || existing.staffName;
      if (posSessionId) existing.posSessionId = posSessionId;
      await existing.save();
      await updateDailyCashChain({ location, day }).catch((error) =>
        console.warn("Daily cash chain update failed:", error.message)
      );
      return res.status(200).json(await DailyCash.findById(existing._id).lean());
    }

    const record = await DailyCash.create({
      date: dayDate(day),
      amount: value,
      location,
      staffName: staffName || "",
      posSessionId: posSessionId || "",
      ...(adding
        ? { addedCash: value, source: "pos" }
        : { source: source === "pos" ? "pos" : "manual" }),
    });
    await updateDailyCashChain({ location, day }).catch((error) =>
      console.warn("Daily cash chain update failed:", error.message)
    );
    return res.status(201).json((await DailyCash.findById(record._id).lean()) || record);
  }

  return res.status(405).json({ error: "Method not allowed" });
}
