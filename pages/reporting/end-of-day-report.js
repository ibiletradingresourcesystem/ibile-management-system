"use client";

import Layout from "@/components/Layout";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Loader } from "@/components/ui";
import useProgress from "@/lib/useProgress";
import { Fragment, useState, useEffect } from "react";
import Link from "next/link";
import { Line, Bar, Pie } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export default function EndOfDayReporting() {
  const [summary, setSummary] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [period, setPeriod] = useState("thisMonth");
  const [selectedLocation, setSelectedLocation] = useState("All");
  const [locations, setLocations] = useState([]);
  const [expandedReportId, setExpandedReportId] = useState(null);

  useEffect(() => {
    fetchLocations();
  }, []);

  useEffect(() => {
    fetchData();
  }, [period, selectedLocation]);

  async function fetchLocations() {
    try {
      const res = await fetch("/api/setup/get");
      const data = await res.json();
      const locationsList = (data?.store?.locations || []).map((loc) => ({
        id: String(loc._id),
        name: loc.name,
      }));
      setLocations(locationsList);
    } catch (err) {
      console.error("Error fetching locations:", err);
    }
  }

  async function fetchData() {
    try {
      setLoading(true);
      start();
      const locationId = selectedLocation !== "All" ? selectedLocation : "";
      const locationParam = locationId ? `&locationId=${locationId}` : "";
      onFetch();
      const res = await fetch(`/api/reporting/end-of-day-summary?period=${period}${locationParam}`);
      const data = await res.json();

      onProcess();
      if (data.success) {
        setSummary(data.summary);
        const reportsList = data.reports || [];
        setReports(reportsList);
      } else {
        console.error(" API Error:", data.message);
      }
    } catch (err) {
      console.error(" Error fetching EOD data:", err);
    } finally {
      complete();
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader size="lg" text="Loading end of day report..." progress={progress} />
        </div>
      </Layout>
    );
  }

  if (!summary) {
    return (
      <Layout>
        <div className="p-6">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-yellow-800">No end-of-day reports available for this period.</p>
          </div>
        </div>
      </Layout>
    );
  }

  // Prepare chart data
  const dailyData = summary.dailyData || [];
  const lineChartData = {
    labels: dailyData.map((d) => d.date),
    datasets: [
      {
        label: "Daily Sales ()",
        data: dailyData.map((d) => d.sales),
        borderColor: "#06B6D4",
        backgroundColor: "rgba(6, 182, 212, 0.1)",
        fill: true,
        tension: 0.3,
      },
      {
        label: "Daily Transactions",
        data: dailyData.map((d) => d.transactions),
        borderColor: "#EC4899",
        backgroundColor: "rgba(236, 72, 153, 0.1)",
        fill: false,
        yAxisID: "y1",
        tension: 0.3,
      },
    ],
  };

  const barChartData = {
    labels: summary.byLocation.map((l) => l.location),
    datasets: [
      {
        label: "Sales by Location ()",
        data: summary.byLocation.map((l) => l.totalSales),
        backgroundColor: "#06B6D4",
      },
      {
        label: "Transactions by Location",
        data: summary.byLocation.map((l) => l.transactions),
        backgroundColor: "#8B5CF6",
      },
    ],
  };

  const tenderData = {
    labels: Object.keys(summary.tenderBreakdown || {}),
    datasets: [
      {
        label: "Tender Breakdown",
        data: Object.values(summary.tenderBreakdown || {}),
        backgroundColor: [
          "#06B6D4",
          "#EC4899",
          "#8B5CF6",
          "#F59E0B",
          "#10B981",
          "#EF4444",
        ],
      },
    ],
  };

  return (
    <Layout>
      {
        <div className="page-container">
        <div className="page-content">
          {/* Header */}
          <div className="page-header">
            <h1 className="page-title">End of Day Reports</h1>
            <Link
              href="/reporting"
              className="btn-action-secondary"
            >
               Back to Reporting
            </Link>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 md:mb-6">
            <div className="form-group">
              <label className="form-label">Period</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="form-select"
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="day">Last Day</option>
                <option value="week">Last 7 Days</option>
                <option value="thisWeek">This Week</option>
                <option value="month">Last Month</option>
                <option value="thisMonth">This Month</option>
                <option value="year">Last Year</option>
                <option value="thisYear">This Year</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Location</label>
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="form-select"
              >
                <option value="All">All Locations</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4 md:mb-6">
            <SummaryCard
              title="Total Reports"
              value={formatNumber(summary.totals.reports)}
              icon=""
            />
            <SummaryCard
              title="Total Sales"
              value={`${summary.totals.sales.toLocaleString("en-NG", {
                maximumFractionDigits: 0,
              })}`}
              icon=""
            />
            <SummaryCard
              title="Total Transactions"
              value={formatNumber(summary.totals.transactions)}
              icon=""
            />
            <SummaryCard
              title="Reconciled Tills"
              value={formatNumber(summary.status.reconciled)}
              subtext={`${summary.status.varianceNoted} with variance`}
              icon=""
            />
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-4 md:mb-6">
            {/* Daily Sales Trend */}
            <div className="content-card">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Sales Trend</h2>
              <Line
                data={lineChartData}
                options={{
                  responsive: true,
                  interaction: { mode: "index", intersect: false },
                  scales: {
                    y: { title: { display: true, text: "Sales ()" } },
                    y1: {
                      type: "linear",
                      position: "right",
                      title: { display: true, text: "Transactions" },
                    },
                  },
                }}
              />
            </div>

            {/* Tender Breakdown */}
            <div className="content-card">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Tender Breakdown</h2>
              <Pie
                data={tenderData}
                options={{
                  responsive: true,
                  plugins: {
                    legend: { position: "bottom" },
                  },
                }}
              />
            </div>
          </div>

          {/* By Location & Staff */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 mb-4 md:mb-6">
            {/* Sales by Location */}
            <div className="content-card">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Sales by Location</h2>
              <Bar
                data={barChartData}
                options={{
                  responsive: true,
                  scales: {
                    y: { beginAtZero: true },
                  },
                }}
              />
            </div>

            {/* Till reports, by whoever closed them */}
            <div className="content-card">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Till Reports by Staff</h2>
                <p className="text-xs text-gray-500">Who opened and closed the till — not necessarily who made the sales</p>
              </div>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                {(summary.byStaff || [])
                  .sort((a, b) => b.totalSales - a.totalSales)
                  .slice(0, 10)
                  .map((staff, idx) => (
                    <div key={idx} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">{staff.staff}</p>
                        <p className="text-sm text-gray-600">
                          {staff.reports} reports  {staff.transactions} transactions
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold theme-accent-text">
                          {staff.totalSales.toLocaleString("en-NG", {
                            maximumFractionDigits: 0,
                          })}
                        </p>
                        <p
                          className={`text-sm font-medium ${
                            staff.variance >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          Variance: {staff.variance.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* Who actually sold: a till is opened by one person and sold on by several */}
          <div className="content-card mb-4 md:mb-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Sales by Staff</h2>
              <p className="text-xs text-gray-500">
                Every completed sale in this period, credited to the staff member who rang it up
              </p>
            </div>
            {(summary.bySeller || []).length === 0 ? (
              <p className="text-sm text-gray-500 py-6 text-center">No sales recorded for this period.</p>
            ) : (
              <div className="data-table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th className="text-right">Transactions</th>
                      <th className="text-right">Sales</th>
                      <th className="text-right">Average sale</th>
                      <th className="text-right">Days sold</th>
                      <th>Locations</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(summary.bySeller || []).map((seller) => (
                      <tr key={seller.staff}>
                        <td className="font-medium text-gray-900 whitespace-nowrap">{seller.staff}</td>
                        <td className="text-right">{formatNumber(seller.transactions)}</td>
                        <td className="text-right font-medium">
                          {seller.totalSales.toLocaleString("en-NG", { maximumFractionDigits: 0 })}
                        </td>
                        <td className="text-right text-gray-600">
                          {(seller.transactions > 0 ? seller.totalSales / seller.transactions : 0).toLocaleString("en-NG", {
                            maximumFractionDigits: 0,
                          })}
                        </td>
                        <td className="text-right text-gray-600">{seller.days}</td>
                        <td className="text-gray-600 text-sm">{(seller.locations || []).join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent Reports Table */}
          <div className="content-card">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Reports</h2>
            <div className="data-table-container">
              <table className="data-table min-w-[900px]">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap">Date</th>
                    <th className="whitespace-nowrap">Location</th>
                    <th className="whitespace-nowrap">Staff</th>
                    <th className="text-right">Sales</th>
                    <th className="text-right">Transactions</th>
                    <th className="text-right">Variance</th>
                    <th className="text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                        <p className="text-lg font-medium">No reports found</p>
                        <p className="text-sm mt-1">Try adjusting your period or location filter</p>
                      </td>
                    </tr>
                  ) : reports.slice(0, 20).map((report, idx) => {
                    const reportKey = report._id || idx;
                    const reportVariance = Number(report.variance || 0);
                    const reportStatus = Math.abs(reportVariance) < 1 ? "RECONCILED" : "VARIANCE_NOTED";

                    return (
                    <Fragment key={reportKey}>
                      <tr
                        onClick={() => setExpandedReportId(expandedReportId === reportKey ? null : reportKey)}
                        className={`cursor-pointer hover:bg-gray-50 transition ${
                          reportStatus === "VARIANCE_NOTED" ? "bg-yellow-50" : ""
                        }`}
                      >
                        <td className="whitespace-nowrap">
                          {new Date(report.closedAt).toLocaleDateString()}
                        </td>
                        <td className="whitespace-nowrap">
                          {report.locationName || "Unknown"}
                        </td>
                        <td className="whitespace-nowrap">{report.staffName || "N/A"}</td>
                        <td className="text-right font-medium">
                          {(report.totalSales || 0).toLocaleString("en-NG", {
                            maximumFractionDigits: 0,
                          })}
                        </td>
                        <td className="text-right">
                          {formatNumber(report.transactionCount || 0)}
                        </td>
                        <td
                          className={`text-right font-medium ${
                            Math.abs(reportVariance) < 1
                              ? "text-gray-700"
                              : reportVariance > 0
                                ? "text-amber-700"
                                : "text-red-600"
                          }`}
                        >
                          {reportVariance.toLocaleString()}
                        </td>
                        <td className="text-center">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${
                              reportStatus === "RECONCILED"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {reportStatus === "RECONCILED" ? "Reconciled" : "Variance"}
                          </span>
                        </td>
                      </tr>
                      {expandedReportId === reportKey && (
                        <tr className="bg-gray-50">
                          <td colSpan={7} className="px-6 py-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
                              {/* Opening Info */}
                              <div>
                                <h4 className="font-semibold text-gray-800 mb-2">Opening Info</h4>
                                <div className="space-y-1 text-sm">
                                  <p><span className="text-gray-500">Opened At:</span> {report.openedAt ? new Date(report.openedAt).toLocaleString("en-NG") : "N/A"}</p>
                                  <p><span className="text-gray-500">Opening Balance:</span> {(report.openingBalance || 0).toLocaleString()}</p>
                                </div>
                              </div>
                              
                              {/* Closing Info */}
                              <div>
                                <h4 className="font-semibold text-gray-800 mb-2">Closing Info</h4>
                                <div className="space-y-1 text-sm">
                                  <p><span className="text-gray-500">Closed At:</span> {report.closedAt ? new Date(report.closedAt).toLocaleString("en-NG") : "N/A"}</p>
                                  <p><span className="text-gray-500">Counted (takings):</span> {(report.physicalCount || 0).toLocaleString()}</p>
                                  <p><span className="text-gray-500">Expected takings:</span> {Number(report.expectedTakings ?? ((report.expectedClosingBalance || 0) - (report.openingBalance || 0))).toLocaleString()}</p>
                                  <p><span className="text-gray-500">Drawer at close:</span> {(report.expectedClosingBalance || 0).toLocaleString()} <span className="text-gray-400">(incl. float)</span></p>
                                  <p>
                                    <span className="text-gray-500">Cash counted:</span>{" "}
                                    {report.countedCash === null || report.countedCash === undefined
                                      ? "not counted separately"
                                      : Number(report.countedCash).toLocaleString()}
                                    <span className="text-gray-400"> of {Number(report.expectedCash || 0).toLocaleString()} expected</span>
                                  </p>
                                </div>
                              </div>
                              
                              {/* Tender Breakdown */}
                              <div>
                                <h4 className="font-semibold text-gray-800 mb-2">Tender Breakdown</h4>
                                <div className="space-y-1 text-sm">
                                  {report.tenderBreakdown && Object.entries(report.tenderBreakdown).length > 0 ? (
                                    Object.entries(report.tenderBreakdown).map(([tender, amount]) => (
                                      <p key={tender}>
                                        <span className="text-gray-500">{tender}:</span> {(amount || 0).toLocaleString()}
                                      </p>
                                    ))
                                  ) : (
                                    <p className="text-gray-400">No breakdown available</p>
                                  )}
                                </div>
                              </div>
                              
                              {/* Who sold during this till session */}
                              <div className="md:col-span-3">
                                <h4 className="font-semibold text-gray-800 mb-2">
                                  Sold By {report.sellerCount > 0 ? `(${report.sellerCount})` : ""}
                                </h4>
                                {report.sellers?.length > 0 ? (
                                  <div className="flex flex-wrap gap-2">
                                    {report.sellers.map((seller) => (
                                      <span
                                        key={seller.staff}
                                        className="inline-flex items-center gap-2 border border-gray-200 bg-gray-50 px-3 py-1.5 rounded-lg text-sm"
                                      >
                                        <span className="font-medium text-gray-800">{seller.staff}</span>
                                        <span className="text-gray-500">
                                          {formatNumber(seller.transactions)} sale{seller.transactions === 1 ? "" : "s"}
                                        </span>
                                        <span className="font-semibold text-gray-900">
                                          {seller.totalSales.toLocaleString("en-NG", { maximumFractionDigits: 0 })}
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-gray-400">
                                    No sales matched to this till session — the report was closed by {report.staffName || "N/A"}.
                                  </p>
                                )}
                              </div>

                              {/* Notes */}
                              {report.closingNotes && (
                                <div className="md:col-span-3">
                                  <h4 className="font-semibold text-gray-800 mb-2">Closing Notes</h4>
                                  <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded">{report.closingNotes}</p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      }
    </Layout>
  );
}

function SummaryCard({ title, value, subtext, icon }) {
  return (
    <div className="stat-card border-l-4 theme-border-left-accent">
      <div className="flex items-center justify-between">
        <div>
          <p className="stat-card-label">{title}</p>
          <p className="stat-card-value">{value}</p>
          {subtext && <p className="text-xs text-gray-500 mt-1">{subtext}</p>}
        </div>
        <p className="text-3xl md:text-4xl opacity-40">{icon}</p>
      </div>
    </div>
  );
}
