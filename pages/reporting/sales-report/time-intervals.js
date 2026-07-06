import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import useProgress from "@/lib/useProgress";
import { formatCurrency, formatNumber } from "@/lib/format";
import { getDateTimeParts, getTodayDateKey, getWeekStartDateKey, isInTimeRange } from "@/lib/dateFilter";
import {
  getReportDevice,
  getReportLocation,
  getReportStaffName,
  getTransactionDiscount,
  getTransactionItemQuantity,
  getTransactionNetSales,
  getTransactionRefundValue,
  isCompletedSale,
  isRefundedSale,
} from "@/lib/sales-report-utils";
import { useEffect, useState } from "react";
import Link from "next/link";
import { saveAs } from "file-saver";

export default function TimeIntervals() {
  const [data, setData] = useState(null);
  const [allLocations, setAllLocations] = useState([]);
  const [allStaff, setAllStaff] = useState([]);
  const [timeRange, setTimeRange] = useState("last7");
  const [location, setLocation] = useState("All");
  const [device, setDevice] = useState("All");
  const [staff, setStaff] = useState("All");
  const [intervalType, setIntervalType] = useState("daily");
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();

  useEffect(() => { fetchFilters(); }, []);
  useEffect(() => { if (allLocations.length >= 0) fetchData(); }, [timeRange, location, device, staff, intervalType]);

  async function fetchFilters() {
    try {
      const res = await fetch("/api/transactions/transactions");
      const txRes = await res.json();
      if (txRes.success && txRes.transactions) {
        const locSet = new Set(); const staffSet = new Set();
        txRes.transactions.forEach((tx) => {
          if (tx.location && tx.location !== "online") locSet.add(tx.location);
          if (tx.staff?.name) staffSet.add(tx.staff.name);
        });
        locSet.add("online");
        setAllLocations(Array.from(locSet).sort((a, b) => a === "online" ? -1 : b === "online" ? 1 : a.localeCompare(b)));
        setAllStaff(Array.from(staffSet).sort());
      }
    } catch (err) { console.error("Error fetching filters:", err); }
  }

  async function fetchData() {
    try {
      setLoading(true);
      start();
      onFetch();
      const res = await fetch("/api/transactions/transactions");
      const txRes = await res.json();
      if (!txRes.success || !txRes.transactions) { setData(null); setLoading(false); return; }

      const filteredTx = txRes.transactions.filter((tx) => {
        return isInTimeRange(tx.createdAt, timeRange)
          && (location === "All" || getReportLocation(tx) === location)
          && (device === "All" || getReportDevice(tx) === device)
          && (staff === "All" || getReportStaffName(tx) === staff);
      });

      const buckets = {};
      onProcess();
      filteredTx.forEach((tx) => {
        const parts = getDateTimeParts(tx.createdAt);
        if (!parts) return;

        let key;
        switch (intervalType) {
          case "yearly": key = parts.year; break;
          case "monthly": key = `${parts.year}-${parts.month}`; break;
          case "weekly": {
            const weekStart = getWeekStartDateKey(parts.dateKey);
            if (!weekStart) return;
            key = weekStart; break;
          }
          case "hourly": key = `${parts.dateKey} ${parts.hour}:00`; break;
          case "halfHourly": {
            const half = Number(parts.minute) < 30 ? "00" : "30";
            key = `${parts.dateKey} ${parts.hour}:${half}`; break;
          }
          default: key = parts.dateKey; break;
        }

        if (!buckets[key]) {
          buckets[key] = {
            date: key, transactionQty: 0, refundQty: 0, refundValue: 0,
            noSale: 0, voidedQty: 0, voidedValue: 0, itemQty: 0,
            salesIncTax: 0, discounts: 0, netSales: 0,
          };
        }
        if (isCompletedSale(tx)) {
          buckets[key].transactionQty += 1;
          buckets[key].itemQty += getTransactionItemQuantity(tx);
          buckets[key].salesIncTax += getTransactionNetSales(tx);
          buckets[key].discounts += getTransactionDiscount(tx);
        } else if (isRefundedSale(tx)) {
          buckets[key].refundQty += 1;
          buckets[key].refundValue += getTransactionRefundValue(tx);
        }
      });

      const rows = Object.values(buckets)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({
          ...r,
          avgTransaction: r.transactionQty > 0 ? r.salesIncTax / r.transactionQty : 0,
          netSales: r.salesIncTax,
        }));

      setData(rows);
    } catch (err) { console.error("Error fetching data:", err); }
    finally { complete(); setLoading(false); }
  }

  const tableData = data || [];
  const totals = {
    transactionQty: tableData.reduce((s, r) => s + r.transactionQty, 0),
    refundQty: tableData.reduce((s, r) => s + r.refundQty, 0),
    refundValue: tableData.reduce((s, r) => s + r.refundValue, 0),
    noSale: tableData.reduce((s, r) => s + r.noSale, 0),
    voidedQty: tableData.reduce((s, r) => s + r.voidedQty, 0),
    voidedValue: tableData.reduce((s, r) => s + r.voidedValue, 0),
    itemQty: tableData.reduce((s, r) => s + r.itemQty, 0),
    salesIncTax: tableData.reduce((s, r) => s + r.salesIncTax, 0),
    discounts: tableData.reduce((s, r) => s + r.discounts, 0),
    avgTransaction: 0, netSales: 0,
  };
  totals.netSales = totals.salesIncTax;
  totals.avgTransaction = totals.transactionQty > 0 ? totals.netSales / totals.transactionQty : 0;

  function exportCSV() {
    if (!tableData.length) return;
    const headers = ["Date", "Txn Qty", "Refund Qty", "Refund Value", "No Sale", "Voided Qty", "Voided Value", "Item Qty", "Sales Inc Tax", "Discounts", "Avg Transaction", "Net Sales"];
    const csvRows = [headers.join(",")];
    tableData.forEach((r) => {
      csvRows.push([
        r.date, r.transactionQty, r.refundQty, r.refundValue.toFixed(2),
        r.noSale, r.voidedQty, r.voidedValue.toFixed(2), r.itemQty,
        r.salesIncTax.toFixed(2), r.discounts.toFixed(2), r.avgTransaction.toFixed(2), r.netSales.toFixed(2),
      ].join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    saveAs(blob, `time-intervals-${getTodayDateKey() || "report"}.csv`);
  }

  return (
    <Layout title="Time Intervals">
      <div className="page-container">
        <div className="page-content">
          {/* Breadcrumb */}
          <div className="mb-6 text-sm text-gray-600">
            <Link href="/" className="text-cyan-600 hover:text-cyan-700">Home</Link>
            <span className="mx-2 text-gray-400">{">"}</span>
            <Link href="/reporting" className="text-cyan-600 hover:text-cyan-700">Reporting</Link>
            <span className="mx-2 text-gray-400">{">"}</span>
            <span className="text-gray-800 font-medium">Time Intervals</span>
          </div>

          <div className="page-header">
            <h1 className="page-title">Sales By Time Interval</h1>
            <p className="page-subtitle">Breakdown of sales across time intervals</p>
          </div>

          {/* Filters */}
          <div className="content-card mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Time Range</label>
                <select value={timeRange} onChange={(e) => setTimeRange(e.target.value)} className="form-select">
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="last7">Last 7 days</option>
                  <option value="last14">Last 14 days</option>
                  <option value="last30">Last 30 days</option>
                  <option value="last60">Last 60 days</option>
                  <option value="last90">Last 90 days</option>
                  <option value="thisWeek">This Week</option>
                  <option value="thisMonth">This Month</option>
                  <option value="thisYear">This Year</option>
                  <option value="lastWeek">Last Week</option>
                  <option value="lastMonth">Last Month</option>
                  <option value="lastYear">Last Year</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Interval</label>
                <select value={intervalType} onChange={(e) => setIntervalType(e.target.value)} className="form-select">
                  <option value="yearly">Yearly</option>
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="daily">Daily</option>
                  <option value="hourly">Hourly</option>
                  <option value="halfHourly">Half Hourly</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
                <select value={location} onChange={(e) => setLocation(e.target.value)} className="form-select">
                  <option value="All">All Locations</option>
                  {allLocations.map((l) => (<option key={l} value={l}>{l}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Device</label>
                <select value={device} onChange={(e) => setDevice(e.target.value)} className="form-select">
                  <option value="All">All Devices</option>
                  <option value="POS">POS</option>
                  <option value="Mobile">Mobile</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Staff</label>
                <select value={staff} onChange={(e) => setStaff(e.target.value)} className="form-select">
                  <option value="All">All Staff</option>
                  {allStaff.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </div>
            </div>
          </div>

          {/* Export Buttons */}
          <div className="flex flex-wrap gap-3 mb-6">
            <button onClick={exportCSV} className="btn-action btn-action-primary">
              Export CSV
            </button>
          </div>

          {/* Table */}
          {loading ? (
            <div className="content-card">
              <Loader size="md" text="Loading time interval data..." progress={progress} />
            </div>
          ) : tableData.length === 0 ? (
            <div className="content-card text-center py-12">
              <p className="text-lg font-medium text-gray-500">No interval data found</p>
              <p className="text-sm text-gray-400 mt-1">Try adjusting your time range or filters</p>
            </div>
          ) : (
            <div className="data-table-container">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead className="sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Date</th>
                      <th className="px-4 py-3 text-right font-semibold">Txn Qty</th>
                      <th className="px-4 py-3 text-right font-semibold">Refund Qty</th>
                      <th className="px-4 py-3 text-right font-semibold">Refund Value</th>
                      <th className="px-4 py-3 text-right font-semibold">No Sale</th>
                      <th className="px-4 py-3 text-right font-semibold">Voided Qty</th>
                      <th className="px-4 py-3 text-right font-semibold">Voided Value</th>
                      <th className="px-4 py-3 text-right font-semibold">Item Qty</th>
                      <th className="px-4 py-3 text-right font-semibold">Sales Inc Tax</th>
                      <th className="px-4 py-3 text-right font-semibold">Discounts</th>
                      <th className="px-4 py-3 text-right font-semibold">Avg Transaction</th>
                      <th className="px-4 py-3 text-right font-semibold">Net Sales</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {tableData.map((row, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="px-4 py-3 font-medium text-gray-800">{row.date}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(row.transactionQty)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(row.refundQty)}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(row.refundValue)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(row.noSale)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(row.voidedQty)}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(row.voidedValue)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(row.itemQty)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(row.salesIncTax)}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(row.discounts)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(row.avgTransaction)}</td>
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(row.netSales)}</td>
                      </tr>
                    ))}
                    {/* Total Row */}
                    <tr className="theme-table-summary-row font-bold border-t-2 border-gray-300">
                      <td className="px-4 py-3 text-gray-800">TOTAL</td>
                      <td className="px-4 py-3 text-right">{formatNumber(totals.transactionQty)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(totals.refundQty)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totals.refundValue)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(totals.noSale)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(totals.voidedQty)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totals.voidedValue)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(totals.itemQty)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totals.salesIncTax)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totals.discounts)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totals.avgTransaction)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totals.netSales)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

