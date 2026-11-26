import { customRange, getTodayDateKey, parseCustomRange } from "@/lib/dateFilter";

/** The periods every sales report offers, in the order they are listed. */
const PERIODS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["last7", "Last 7 days"],
  ["last14", "Last 14 days"],
  ["last30", "Last 30 days"],
  ["last60", "Last 60 days"],
  ["last90", "Last 90 days"],
  ["thisWeek", "This Week"],
  ["lastWeek", "Last Week"],
  ["thisMonth", "This Month"],
  ["lastMonth", "Last Month"],
  ["thisYear", "This Year"],
  ["lastYear", "Last Year"],
];

/**
 * The "Show data from" choice on the sales reports: a set period, or dates picked by hand. Picking
 * starts on today; set both dates the same for one day. The value is a time range lib/dateFilter.js
 * reads like any other.
 */
export default function ReportTimeRange({ value, onChange, label = "Show data from" }) {
  const picked = parseCustomRange(value);

  const choosePeriod = (next) => {
    if (next !== "custom") return onChange(next);
    const today = getTodayDateKey();
    return onChange(customRange(today, today));
  };
  // Keep the range the right way round whichever end moves
  const setFrom = (from) => from && onChange(customRange(from, from > picked.to ? from : picked.to));
  const setTo = (to) => to && onChange(customRange(to < picked.from ? to : picked.from, to));

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <select value={picked ? "custom" : value} onChange={(e) => choosePeriod(e.target.value)} className="form-select">
        {PERIODS.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
        <option value="custom">Pick dates…</option>
      </select>
      {picked && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input type="date" value={picked.from} onChange={(e) => setFrom(e.target.value)} className="form-input" aria-label="From date" title="From" />
          <input type="date" value={picked.to} onChange={(e) => setTo(e.target.value)} className="form-input" aria-label="To date" title="To" />
        </div>
      )}
    </div>
  );
}
