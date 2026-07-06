import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import { formatCurrency, formatNumber } from "@/lib/format";
import { isInTimeRange } from "@/lib/dateFilter";
import useProgress from "@/lib/useProgress";
import {
  getReportDevice,
  getReportLocation,
  getReportStaffName,
  getTransactionDiscount,
  getTransactionItemQuantity,
  getTransactionNetSales,
  getTransactionRefundValue,
  getTransactionTax,
  isCompletedSale,
  isRefundedSale,
} from "@/lib/sales-report-utils";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function EmployeesSales() {
  const [data, setData] = useState(null);
  const [allLocations, setAllLocations] = useState([]);
  const [allStaff, setAllStaff] = useState([]);
  const [timeRange, setTimeRange] = useState("last7");
  const [location, setLocation] = useState("All");
  const [device, setDevice] = useState("All");
  const [staff, setStaff] = useState("All");
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();

  useEffect(() => { fetchAllFilters(); }, []);
  useEffect(() => { if (allLocations.length > 0) fetchData(); }, [timeRange, location, device, staff, allLocations]);

  async function fetchAllFilters() {
    try {
      const res = await fetch("/api/transactions/transactions");
      const txRes = await res.json();
      if (txRes.success && txRes.transactions) {
        const locSet = new Set(); const staffSet = new Set();
        txRes.transactions.forEach((tx) => {
          const txLocation = getReportLocation(tx);
          const txStaff = getReportStaffName(tx);
          if (txLocation && txLocation !== "online") locSet.add(txLocation);
          if (txStaff) staffSet.add(txStaff);
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
      const res = await fetch("/api/transactions/transactions");
      onFetch();
      const txRes = await res.json();
      if (!txRes.success || !txRes.transactions) { setData(null); setLoading(false); complete(); return; }

      onProcess();
      const filteredTx = txRes.transactions.filter((tx) => {
        return isInTimeRange(tx.createdAt, timeRange)
          && (location === "All" || getReportLocation(tx) === location)
          && (device === "All" || getReportDevice(tx) === device)
          && (staff === "All" || getReportStaffName(tx) === staff);
      });

      const staffMap = {};
      filteredTx.forEach((tx) => {
        const staffName = getReportStaffName(tx);
        if (!staffMap[staffName]) {
          staffMap[staffName] = {
            name: staffName, mainLocation: getReportLocation(tx),
            transactionQty: 0, refundQty: 0, refundValue: 0,
            noSaleQty: 0, voidedQty: 0, voidedValue: 0,
            itemQty: 0, salesIncTax: 0, discounts: 0, taxAmount: 0,
          };
        }
        if (isCompletedSale(tx)) {
          staffMap[staffName].transactionQty += 1;
          staffMap[staffName].itemQty += getTransactionItemQuantity(tx);
          staffMap[staffName].salesIncTax += getTransactionNetSales(tx);
          staffMap[staffName].discounts += getTransactionDiscount(tx);
          staffMap[staffName].taxAmount += getTransactionTax(tx);
        } else if (isRefundedSale(tx)) {
          staffMap[staffName].refundQty += 1;
          staffMap[staffName].refundValue += getTransactionRefundValue(tx);
        }
      });

      const staffData = Object.values(staffMap).map((s) => {
        const netSales = s.salesIncTax;
        return {
          ...s,
          netSalesIncVat: netSales,
          netSalesExcTax: Math.max(0, netSales - s.taxAmount),
          avgTransaction: s.transactionQty > 0 ? netSales / s.transactionQty : 0,
          avgMargin: 0, grossMargin: 0, marginPercent: 0,
        };
      }).sort((a, b) => b.salesIncTax - a.salesIncTax);

      const rangeLabels = { today: "Today", yesterday: "Yesterday", last7: "Last 7 Days", last14: "Last 14 Days", last30: "Last 30 Days", last90: "Last 90 Days", thisMonth: "This Month", lastMonth: "Last Month", thisYear: "This Year", all: "All Time" };
      setData({ employees: staffData, dateRange: rangeLabels[timeRange] || timeRange });
      complete();
    } catch (err) { console.error("Error fetching data:", err); complete(); }
    finally { setLoading(false); }
  }

  const tableData = data?.employees || [];
  const totals = {
    transactionQty: tableData.reduce((s, r) => s + r.transactionQty, 0),
    refundQty: tableData.reduce((s, r) => s + r.refundQty, 0),
    refundValue: tableData.reduce((s, r) => s + r.refundValue, 0),
    noSaleQty: tableData.reduce((s, r) => s + r.noSaleQty, 0),
    voidedQty: tableData.reduce((s, r) => s + r.voidedQty, 0),
    voidedValue: tableData.reduce((s, r) => s + r.voidedValue, 0),
    itemQty: tableData.reduce((s, r) => s + r.itemQty, 0),
    salesIncTax: tableData.reduce((s, r) => s + r.salesIncTax, 0),
    discounts: tableData.reduce((s, r) => s + r.discounts, 0),
    avgTransaction: tableData.reduce((s, r) => s + r.transactionQty, 0) > 0
      ? tableData.reduce((s, r) => s + r.netSalesIncVat, 0) / tableData.reduce((s, r) => s + r.transactionQty, 0)
      : 0,
    netSalesIncVat: tableData.reduce((s, r) => s + r.netSalesIncVat, 0),
    netSalesExcTax: tableData.reduce((s, r) => s + r.netSalesExcTax, 0),
  };

  return (
    <Layout title="Sales By Employee">
      <div className="page-container">
        <div className="page-content">
          {/* Breadcrumb */}
          <div className="mb-6 text-sm text-gray-600">
            <Link href="/" className="text-cyan-600 hover:text-cyan-700">Home</Link>
            <span className="mx-2 text-gray-400">{">"}</span>
            <Link href="/reporting" className="text-cyan-600 hover:text-cyan-700">Reporting</Link>
            <span className="mx-2 text-gray-400">{">"}</span>
            <span className="text-gray-800 font-medium">Employees</span>
          </div>

          <div className="page-header">
            <h1 className="page-title">Sales By Employee</h1>
            <p className="page-subtitle">Staff performance analysis{data?.dateRange ? ` — ${data.dateRange}` : ""}</p>
          </div>

          {/* Filters */}
          <div className="content-card mb-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Show data from</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Location</label>
                <select value={location} onChange={(e) => setLocation(e.target.value)} className="form-select">
                  <option value="All">All Locations</option>
                  {allLocations.map((l) => (<option key={l} value={l}>{l}</option>))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Device</label>
                <select value={device} onChange={(e) => setDevice(e.target.value)} className="form-select">
                  <option value="All">All Devices</option>
                  <option value="POS">POS</option>
                  <option value="Mobile">Mobile</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Staff</label>
                <select value={staff} onChange={(e) => setStaff(e.target.value)} className="form-select">
                  <option value="All">All Staff</option>
                  {allStaff.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </div>
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="content-card">
              <Loader size="md" text="Loading employee data..." progress={progress} />
            </div>
          ) : tableData.length === 0 ? (
            <div className="content-card text-center py-12">
              <p className="text-lg font-medium text-gray-500">No employee data found</p>
              <p className="text-sm text-gray-400 mt-1">Try adjusting your filters to see results</p>
            </div>
          ) : (
            <div className="data-table-container">
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead className="sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Name</th>
                      <th className="px-4 py-3 text-left font-semibold">Location</th>
                      <th className="px-4 py-3 text-right font-semibold">Txn Qty</th>
                      <th className="px-4 py-3 text-right font-semibold">Refund Qty</th>
                      <th className="px-4 py-3 text-right font-semibold">Refund Value</th>
                      <th className="px-4 py-3 text-right font-semibold">No Sale</th>
                      <th className="px-4 py-3 text-right font-semibold">Voided Qty</th>
                      <th className="px-4 py-3 text-right font-semibold">Voided Value</th>
                      <th className="px-4 py-3 text-right font-semibold">Item Qty</th>
                      <th className="px-4 py-3 text-right font-semibold">Sales Inc. Tax</th>
                      <th className="px-4 py-3 text-right font-semibold">Discount</th>
                      <th className="px-4 py-3 text-right font-semibold">Avg Net Sales</th>
                      <th className="px-4 py-3 text-right font-semibold">Net Inc. VAT</th>
                      <th className="px-4 py-3 text-right font-semibold">Net Exc. Tax</th>
                      <th className="px-4 py-3 text-right font-semibold">Avg Margin</th>
                      <th className="px-4 py-3 text-right font-semibold">Gross Margin</th>
                      <th className="px-4 py-3 text-right font-semibold">Margin %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {tableData.map((row, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="px-4 py-3 font-medium text-gray-800">{row.name}</td>
                        <td className="px-4 py-3 text-gray-700">{row.mainLocation}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(row.transactionQty)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(row.refundQty)}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(row.refundValue)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(row.noSaleQty)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(row.voidedQty)}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(row.voidedValue)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(row.itemQty)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(row.salesIncTax)}</td>
                        <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(row.discounts)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(row.avgTransaction)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(row.netSalesIncVat)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(row.netSalesExcTax)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(row.avgMargin)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(row.grossMargin)}</td>
                        <td className="px-4 py-3 text-right">{row.marginPercent.toFixed(2)}%</td>
                      </tr>
                    ))}
                    {/* Total Row */}
                    <tr className="theme-table-summary-row font-bold border-t-2 border-gray-300">
                      <td className="px-4 py-3 text-gray-800">Total</td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3 text-right">{formatNumber(totals.transactionQty)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(totals.refundQty)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totals.refundValue)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(totals.noSaleQty)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(totals.voidedQty)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totals.voidedValue)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(totals.itemQty)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totals.salesIncTax)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totals.discounts)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totals.avgTransaction)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totals.netSalesIncVat)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(totals.netSalesExcTax)}</td>
                      <td className="px-4 py-3 text-right">0.00</td>
                      <td className="px-4 py-3 text-right">0.00</td>
                      <td className="px-4 py-3 text-right">0.00%</td>
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

