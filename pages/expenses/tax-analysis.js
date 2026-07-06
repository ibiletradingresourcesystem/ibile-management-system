import Layout from "@/components/Layout";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useState, useEffect } from "react";
import Loader from "@/components/Loader";
import useProgress from "@/lib/useProgress";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { showToastMessage } from "@/lib/toast-state";
import {
  faScaleBalanced,
  faMoneyBillWave,
  faFileDownload,
  faChartLine,
  faCheckCircle,
  faExclamationTriangle,
} from "@fortawesome/free-solid-svg-icons";
import { theme } from "@/styles/theme";

export default function TaxAnalysisPage() {
  const [taxData, setTaxData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [period, setPeriod] = useState("last-month");
  const [error, setError] = useState(null);
  const [downloadingReport, setDownloadingReport] = useState(false);

  useEffect(() => {
    fetchTaxData();
  }, [period]);

  useEffect(() => {
    if (!error) return;
    showToastMessage({ title: "Tax analysis", text: error, fallbackTone: "danger" });
    setError(null);
  }, [error]);

  const fetchTaxData = async () => {
    setLoading(true);
    start();
    setError(null);
    try {
      console.log(" Fetching tax data for period:", period);
      onFetch();
      const response = await fetch(`/api/taxes/analysis?period=${period}`);
      console.log(" Response status:", response.status);
      
      if (!response.ok) {
        let errorMessage = "Failed to fetch tax data";
        try {
          const errorData = await response.json();
          console.error(" API error response:", errorData);
          errorMessage = errorData.message || errorData.details || errorMessage;
        } catch (e) {
          console.error(" Could not parse error response");
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      console.log(" Tax data received:", data);
      onProcess();
      setTaxData(data);
    } catch (err) {
      const errorMsg = err?.message || "Unknown error occurred";
      console.error(" Error fetching tax data:", errorMsg);
      setError(errorMsg);
    } finally {
      complete();
      setLoading(false);
    }
  };

  const downloadTaxReport = async () => {
    try {
      setDownloadingReport(true);
      const response = await fetch(`/api/taxes/report?period=${period}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to generate report");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().split("T")[0];
      a.href = url;
      a.download = `Official_Tax_Report_${period}_${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err?.message || "Failed to download report");
    } finally {
      setDownloadingReport(false);
    }
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          {/* Header Section */}
          <div className="page-header flex-col md:flex-row md:justify-between md:items-start gap-6">
            <div>
              <h1 className="page-title">Tax Analysis Dashboard</h1>
              <p className="page-subtitle max-w-2xl">
                Comprehensive tax performance summary and compliance tracking according to Nigeria Finance Act 2023.
              </p>
            </div>
            
            {/* Period Selector - Enhanced */}
            <div className="content-card min-w-max">
              <label className="form-label flex items-center gap-2">
                <FontAwesomeIcon icon={faChartLine} className="text-sky-600" />
                Reporting Period
              </label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="form-select md:w-48"
              >
                <optgroup label="Last Period" className="font-semibold">
                  <option value="last-month">Last 30 Days</option>
                  <option value="last-quarter">Last 3 Months</option>
                  <option value="last-year">Last Year</option>
                </optgroup>
                <optgroup label="This Period">
                  <option value="this-month">This Month (MTD)</option>
                  <option value="this-quarter">This Quarter (QTD)</option>
                  <option value="this-year">This Year (YTD)</option>
                </optgroup>
              </select>
            </div>
          </div>

          {/* Loading State */}
          {loading ? (
            <div className="content-card flex items-center justify-center min-h-96">
              <Loader size="md" text="Calculating tax analysis..." progress={progress} />
            </div>
          ) : !taxData ? (
            <div className="empty-state-container">
              <FontAwesomeIcon icon={faExclamationTriangle} className="text-gray-400 text-5xl mb-4" />
              <p className="empty-state-text">No tax data available for the selected period</p>
            </div>
          ) : (
            <>
              {/* Key Metrics - Top Section */}
              <div className="mb-6 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                <strong>Note:</strong> This dashboard calculates profit directly from completed transactions and product cost prices.
                For the authoritative accounting figures (which rely on posted journal entries), refer to <a href="/accounting/reports" className="font-semibold underline hover:text-sky-900">Financial Reports</a>.
                Values may differ if an accounting sync is pending.
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
                <StatBox
                  icon={faScaleBalanced}
                  label="Revenue Band"
                  value={taxData.band}
                  bgColor="bg-gray-50"
                  borderColor="border-gray-200"
                  iconColor="text-cyan-600"
                />
                <StatBox
                  icon={faChartLine}
                  label="CIT Rate"
                  value={`${taxData.citRate}%`}
                  bgColor="bg-amber-50"
                  borderColor="border-amber-200"
                  iconColor="text-amber-600"
                />
                <StatBox
                  icon={faMoneyBillWave}
                  label="VAT Rate"
                  value={`${taxData.vatRate}%`}
                  bgColor="bg-emerald-50"
                  borderColor="border-emerald-200"
                  iconColor="text-emerald-600"
                />
                <StatBox
                  icon={faMoneyBillWave}
                  label="Total Tax Liability"
                  value={`${(taxData.totalTaxLiability || 0).toLocaleString()}`}
                  bgColor="bg-rose-50"
                  borderColor="border-rose-200"
                  iconColor="text-rose-600"
                />
              </div>

              {/* Income Summary Section */}
              <div className="mb-10">
                <h2 className="text-2xl font-bold text-gray-900 mb-5 flex items-center gap-2">
                  <div className="w-1.5 h-8 bg-cyan-600 rounded-full"></div>
                  Financial Summary
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  <DetailBox
                    label="Total Revenue"
                    value={`${(taxData.totalRevenue || 0).toLocaleString()}`}
                    icon={faMoneyBillWave}
                    iconColor="text-cyan-600"
                  />
                  <DetailBox
                    label="Cost of Goods Sold"
                    value={`${(taxData.totalCOGS || 0).toLocaleString()}`}
                    icon={faMoneyBillWave}
                    iconColor="text-orange-600"
                  />
                  <DetailBox
                    label="Gross Profit (Revenue − COGS)"
                    value={`${(taxData.grossProfit || 0).toLocaleString()}`}
                    icon={faMoneyBillWave}
                    iconColor="text-emerald-600"
                  />
                  <DetailBox
                    label="Operating Expenses"
                    value={`${(taxData.totalExpenses || 0).toLocaleString()}`}
                    icon={faMoneyBillWave}
                    iconColor="text-red-600"
                  />
                  <DetailBox
                    label="Net Profit (Gross − Expenses)"
                    value={`${(taxData.netProfit || 0).toLocaleString()}`}
                    icon={faMoneyBillWave}
                    iconColor="text-green-600"
                  />
                  <DetailBox
                    label="VAT-able Revenue"
                    value={`${(taxData.vatableRevenue || 0).toLocaleString()}`}
                    icon={faMoneyBillWave}
                    iconColor="text-sky-600"
                    subtitle="Revenue from taxed products only"
                  />
                </div>
              </div>

              {/* Tax Details Section */}
              <div className="mb-10">
                <h2 className="text-2xl font-bold text-gray-900 mb-5 flex items-center gap-2">
                  <div className="w-1.5 h-8 bg-emerald-600 rounded-full"></div>
                  Tax Breakdown
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <DetailBox
                    label="VAT on Taxable Sales (7.5%)"
                    value={`${(taxData.vatOnSales || 0).toLocaleString()}`}
                    icon={faCheckCircle}
                    iconColor="text-emerald-600"
                    subtitle="Applied only to VAT-registered products"
                  />
                  <DetailBox
                    label="Company Income Tax"
                    value={`${(taxData.companyIncomeTax || 0).toLocaleString()}`}
                    icon={faCheckCircle}
                    iconColor="text-purple-600"
                  />
                  <DetailBox
                    label="National Health Insurance Levy (0.5%)"
                    value={`${(taxData.nhlAmount || 0).toLocaleString()}`}
                    icon={faCheckCircle}
                    iconColor="text-teal-600"
                  />
                </div>
              </div>

              {/* Breakdown Table Section */}
              <div className="mb-10">
                <h2 className="text-2xl font-bold text-gray-900 mb-5 flex items-center gap-2">
                  <div className="w-1.5 h-8 bg-purple-600 rounded-full"></div>
                  Period Breakdown
                </h2>
                <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="table-header-gradient text-white">
                        <tr>
                          <th className="px-6 py-4 text-left text-sm font-semibold">Period</th>
                          <th className="px-6 py-4 text-right text-sm font-semibold">Revenue (NGN)</th>
                          <th className="px-6 py-4 text-right text-sm font-semibold">Expenses (NGN)</th>
                          <th className="px-6 py-4 text-right text-sm font-semibold">VAT (NGN)</th>
                          <th className="px-6 py-4 text-right text-sm font-semibold">CIT (NGN)</th>
                          <th className="px-6 py-4 text-right text-sm font-semibold">NHL (NGN)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {taxData.breakdown && taxData.breakdown.length > 0 ? (
                          taxData.breakdown.map((item, index) => (
                            <tr key={index} className={`transition-colors ${index % 2 === 0 ? 'bg-gray-50 hover:bg-gray-100' : 'bg-white hover:bg-gray-50'}`}>
                              <td className="px-6 py-4 text-sm font-medium text-gray-900">{item.month}</td>
                              <td className="px-6 py-4 text-sm text-right text-gray-700 font-mono">{formatNumber(item.income || 0)}</td>
                              <td className="px-6 py-4 text-sm text-right text-gray-700 font-mono">{formatNumber(item.expenses || 0)}</td>
                              <td className="px-6 py-4 text-sm text-right text-gray-700 font-mono">{formatNumber(item.vat || 0)}</td>
                              <td className="px-6 py-4 text-sm text-right text-gray-700 font-mono font-semibold">{formatNumber(item.cit || 0)}</td>
                              <td className="px-6 py-4 text-sm text-right text-gray-700 font-mono">{formatNumber(item.nhl || 0)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="6" className="py-8 px-6 text-center text-gray-500">
                              <FontAwesomeIcon icon={faExclamationTriangle} className="text-gray-400 mr-2" />
                              No breakdown data available for this period
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                  <p className="text-xs text-gray-900 font-medium">
                     <strong>Tax Calculation Basis:</strong> Nigeria Finance Act 2023 - CIT exemption up to NGN 25M (0%), NGN 25M-NGN 100M (20%), above NGN 100M (30%). VAT at 7.5%, NHL at 0.5%.
                  </p>
                </div>
              </div>

              {/* Action Section */}
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="text-sm text-gray-600">
                  <p>Last updated: <span className="font-semibold text-gray-900">{new Date().toLocaleDateString()}</span></p>
                </div>
                <button
                  onClick={downloadTaxReport}
                  disabled={downloadingReport}
                  className="btn-action btn-action-primary flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <FontAwesomeIcon icon={faFileDownload} />
                  {downloadingReport ? "Generating Report..." : "Download Tax Report"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

function StatBox({ icon, label, value, bgColor, borderColor, iconColor }) {
  return (
    <div className={`${bgColor} border ${borderColor} rounded-xl p-6 shadow-sm hover:shadow-lg transition-all transform hover:scale-105`}>
      <div className="flex items-start gap-4">
        <div className={`text-3xl ${iconColor} bg-white bg-opacity-50 p-3 rounded-lg`}>
          <FontAwesomeIcon icon={icon} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-1">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

function DetailBox({ label, value, icon, iconColor, subtitle }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-all">
      <div className="flex items-start gap-3">
        <div className={`text-2xl ${iconColor} mt-1`}>
          <FontAwesomeIcon icon={icon} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-600 mb-2">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}

