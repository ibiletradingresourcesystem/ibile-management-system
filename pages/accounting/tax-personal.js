import Layout from "@/components/Layout";
import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import { calculatePersonalTax, RENT_RELIEF_CAP } from "@/lib/personalTax";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalculator,
  faMoneyBillWave,
  faScaleBalanced,
  faReceipt,
  faChartPie,
  faPlus,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";

// The deductions the Nigeria Tax Act 2025 allows (rent relief has its own field)
const DEDUCTION_OPTIONS = [
  "NHF (Housing Fund)",
  "NHIA (Health Insurance) contribution",
  "Life Assurance / Annuity Premium",
  "Voluntary Pension",
  "Mortgage Interest (home you live in)",
  "Other allowable deduction",
];

export default function PersonalTaxCalculator() {
  const [mode, setMode] = useState("yearly");
  const [grossIncome, setGrossIncome] = useState("");
  const [pension, setPension] = useState("");
  const [rent, setRent] = useState("");
  const [selectedDeduction, setSelectedDeduction] = useState("");
  const [deductionAmount, setDeductionAmount] = useState("");
  const [deductions, setDeductions] = useState([]);
  const [result, setResult] = useState(null);

  const formatCurrencyValue = (num) =>
    formatCurrency(num || 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const addDeduction = () => {
    if (!selectedDeduction || !deductionAmount) return;
    setDeductions((prev) => [
      ...prev,
      { name: selectedDeduction, amount: parseFloat(deductionAmount) },
    ]);
    setDeductionAmount("");
    setSelectedDeduction("");
  };

  const removeDeduction = (index) => {
    setDeductions((prev) => prev.filter((_, i) => i !== index));
  };

  // Everything is worked out for the year (lib/personalTax.js): monthly figures are taken x 12
  const calculateTax = () => {
    const multiplier = mode === "monthly" ? 12 : 1;
    setResult({
      mode,
      ...calculatePersonalTax({
        grossIncome: parseFloat(grossIncome || 0) * multiplier,
        pension: parseFloat(pension || 0) * multiplier,
        deductions: deductions.reduce((sum, d) => sum + d.amount, 0) * multiplier,
        annualRent: parseFloat(rent || 0) * multiplier,
      }),
      allDeductions: deductions,
    });
  };

  const resetForm = () => {
    setGrossIncome("");
    setPension("");
    setRent("");
    setDeductions([]);
    setSelectedDeduction("");
    setDeductionAmount("");
    setResult(null);
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          {/* Header Section */}
          <div className="page-header">
            <h1 className="page-title flex items-center gap-3">
              Personal Tax Calculator
            </h1>
            <p className="page-subtitle max-w-2xl">
              Calculate your estimated personal income tax in accordance with Nigeria&apos;s Tax Act (NTA) 2025.
            </p>
          </div>

          {/* Mode Selection Card */}
          <div className="content-card mb-6">
            <div className="content-card-header">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FontAwesomeIcon icon={faReceipt} className="theme-accent-text" />
                Salary Input Mode
              </h2>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setMode("monthly")}
                className={`flex-1 py-3 px-4 rounded-lg font-semibold text-sm transition-all duration-200 border-2 ${
                  mode === "monthly"
                    ? "theme-toggle-active"
                    : "theme-toggle-neutral"
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setMode("yearly")}
                className={`flex-1 py-3 px-4 rounded-lg font-semibold text-sm transition-all duration-200 border-2 ${
                  mode === "yearly"
                    ? "theme-toggle-active"
                    : "theme-toggle-neutral"
                }`}
              >
                Yearly
              </button>
            </div>
          </div>

          {/* Income & Pension Inputs */}
          <div className="content-card mb-6">
            <div className="content-card-header">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FontAwesomeIcon icon={faMoneyBillWave} className="text-emerald-600" />
                Income Details
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="form-group">
                <label className="form-label">
                  Gross {mode === "monthly" ? "Monthly" : "Annual"} Income (NGN)
                </label>
                <input
                  type="number"
                  placeholder="e.g. 500,000"
                  value={grossIncome}
                  onChange={(e) => setGrossIncome(e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">
                  Pension Contribution ({mode})
                </label>
                <input
                  type="number"
                  placeholder="e.g. 40,000"
                  value={pension}
                  onChange={(e) => setPension(e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label className="form-label">
                  Rent Paid ({mode}, home you live in)
                </label>
                <input
                  type="number"
                  placeholder="Leave empty if you own your home"
                  value={rent}
                  onChange={(e) => setRent(e.target.value)}
                  className="form-input"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Rent relief: 20% of the year&apos;s rent, up to {formatCurrencyValue(RENT_RELIEF_CAP)}.
                </p>
              </div>
            </div>
          </div>

          {/* Deduction Inputs */}
          <div className="content-card mb-6">
            <div className="content-card-header">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <FontAwesomeIcon icon={faScaleBalanced} className="text-amber-600" />
                Other Deductions
              </h2>
            </div>
            <div className="flex flex-wrap gap-4 items-end">
              <div className="form-group flex-1 min-w-[200px]">
                <label className="form-label">Deduction Type</label>
                <select
                  value={selectedDeduction}
                  onChange={(e) => setSelectedDeduction(e.target.value)}
                  className="form-select"
                >
                  <option value="">Select Deduction</option>
                  {DEDUCTION_OPTIONS.map((opt, i) => (
                    <option key={i} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div className="form-group w-40">
                <label className="form-label">Amount (NGN)</label>
                <input
                  type="number"
                  placeholder="Amount"
                  value={deductionAmount}
                  onChange={(e) => setDeductionAmount(e.target.value)}
                  className="form-input"
                />
              </div>
              <button
                onClick={addDeduction}
                disabled={!selectedDeduction || !deductionAmount}
                className="btn-action btn-action-success flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FontAwesomeIcon icon={faPlus} />
                Add
              </button>
            </div>

            {deductions.length > 0 && (
              <div className="mt-5 border-t border-gray-200 pt-4">
                <p className="text-sm font-medium text-gray-600 mb-3">Added Deductions:</p>
                <div className="space-y-2">
                  {deductions.map((d, i) => (
                    <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5 border border-gray-200">
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-800">{d.name}</span>
                        <span className="text-sm text-gray-500 ml-2">
                          &mdash; {formatCurrencyValue(d.amount * (mode === "monthly" ? 12 : 1))}
                          {mode === "monthly" && <span className="text-xs text-gray-400 ml-1">/yr</span>}
                        </span>
                      </div>
                      <button
                        onClick={() => removeDeduction(i)}
                        className="text-red-400 hover:text-red-600 transition-colors p-1"
                        title="Remove deduction"
                      >
                        <FontAwesomeIcon icon={faTrash} className="text-sm" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 mb-8">
            <button
              onClick={calculateTax}
              disabled={!grossIncome}
              className="btn-action btn-action-primary flex items-center justify-center gap-2 flex-1 sm:flex-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FontAwesomeIcon icon={faCalculator} />
              Calculate My Tax
            </button>
            <button
              onClick={resetForm}
              className="btn-action btn-action-secondary flex items-center justify-center gap-2"
            >
              Reset
            </button>
          </div>

          {/* Results Section */}
          {result && (
            <>
              {/* Key Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-cyan-50 border border-cyan-200 rounded-xl p-6 shadow-sm hover:shadow-lg transition-all">
                  <p className="text-sm font-medium text-gray-600 mb-1">Total Gross Income</p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">{formatCurrencyValue(result.gross)}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 shadow-sm hover:shadow-lg transition-all">
                  <p className="text-sm font-medium text-gray-600 mb-1">Total Deductions</p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">
                    {formatCurrencyValue(result.totalDeductions)}
                  </p>
                </div>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 shadow-sm hover:shadow-lg transition-all">
                  <p className="text-sm font-medium text-gray-600 mb-1">Chargeable Income</p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">{formatCurrencyValue(result.taxableIncome)}</p>
                </div>
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 shadow-sm hover:shadow-lg transition-all">
                  <p className="text-sm font-medium text-gray-600 mb-1">
                    {mode === "monthly" ? "Monthly Tax" : "Yearly Tax"}
                  </p>
                  <p className="text-xl sm:text-2xl font-bold text-gray-900">
                    {formatCurrencyValue(mode === "monthly" ? result.monthlyTax : result.yearlyTax)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Effective Rate: {result.effectiveRate.toFixed(2)}%
                  </p>
                </div>
              </div>

              {/* Deduction Breakdown */}
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-5 flex items-center gap-2">
                  <div className="w-1.5 h-8 bg-cyan-600 rounded-full"></div>
                  Deduction Summary
                </h2>
                <div className="content-card">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm text-gray-700">Pension Contribution</span>
                      <span className="text-sm font-semibold text-gray-900 font-mono">{formatCurrencyValue(result.pension)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm text-gray-700">Other Deductions</span>
                      <span className="text-sm font-semibold text-gray-900 font-mono">{formatCurrencyValue(result.other)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm text-gray-700">Rent Relief (20% of rent, max ₦500,000)</span>
                      <span className="text-sm font-semibold text-gray-900 font-mono">{formatCurrencyValue(result.rentRelief)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 border-t-2 border-gray-200 font-bold">
                      <span className="text-sm text-gray-900">Total Deductions</span>
                      <span className="text-sm text-gray-900 font-mono">{formatCurrencyValue(result.totalDeductions)}</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      The first ₦800,000 of chargeable income is taxed at 0% — see the bands below. The old
                      Consolidated Relief Allowance no longer applies from 2026.
                    </p>
                  </div>
                </div>
              </div>

              {/* Tax Band Breakdown Table */}
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-5 flex items-center gap-2">
                  <div className="w-1.5 h-8 bg-emerald-600 rounded-full"></div>
                  Tax Band Breakdown
                </h2>
                <div className="data-table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Income Band</th>
                        <th className="text-right">Rate</th>
                        <th className="text-right">Taxable Amount (NGN)</th>
                        <th className="text-right">Tax (NGN)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.bandBreakdown.map((band, i) => (
                        <tr key={i} className={band.taxable > 0 ? "" : "opacity-50"}>
                          <td className="font-medium">{band.label}</td>
                          <td className="text-right font-mono">{(band.rate * 100).toFixed(0)}%</td>
                          <td className="text-right font-mono">{formatCurrencyValue(band.taxable)}</td>
                          <td className="text-right font-mono font-semibold">{formatCurrencyValue(band.tax)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 font-bold">
                        <td colSpan={2} className="px-3 sm:px-4 py-3 text-sm text-gray-900">Total</td>
                        <td className="px-3 sm:px-4 py-3 text-sm text-right font-mono text-gray-900">{formatCurrencyValue(result.taxableIncome)}</td>
                        <td className="px-3 sm:px-4 py-3 text-sm text-right font-mono text-gray-900">{formatCurrencyValue(result.yearlyTax)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Full Summary Card */}
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-5 flex items-center gap-2">
                  <div className="w-1.5 h-8 bg-purple-600 rounded-full"></div>
                  Tax Summary
                </h2>
                <div className="content-card">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <div className="flex justify-between py-2">
                        <span className="text-sm text-gray-600">Gross Annual Income</span>
                        <span className="text-sm font-semibold text-gray-900 font-mono">{formatCurrencyValue(result.gross)}</span>
                      </div>
                      <div className="flex justify-between py-2">
                        <span className="text-sm text-gray-600">Deductions and Rent Relief</span>
                        <span className="text-sm font-semibold text-red-600 font-mono">-{formatCurrencyValue(result.totalDeductions)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-t border-gray-200">
                        <span className="text-sm font-bold text-gray-900">Chargeable Income</span>
                        <span className="text-sm font-bold text-gray-900 font-mono">{formatCurrencyValue(result.taxableIncome)}</span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="flex justify-between py-2">
                        <span className="text-sm text-gray-600">Estimated Yearly Tax</span>
                        <span className="text-sm font-semibold text-gray-900 font-mono">{formatCurrencyValue(result.yearlyTax)}</span>
                      </div>
                      <div className="flex justify-between py-2">
                        <span className="text-sm text-gray-600">Estimated Monthly Tax</span>
                        <span className="text-sm font-semibold text-gray-900 font-mono">{formatCurrencyValue(result.monthlyTax)}</span>
                      </div>
                      <div className="flex justify-between py-2 border-t border-gray-200">
                        <span className="text-sm font-bold text-gray-900">Effective Tax Rate</span>
                        <span className="text-sm font-bold theme-accent-text font-mono">{result.effectiveRate.toFixed(2)}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Disclaimer */}
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-xs text-gray-900 font-medium">
                  <strong>Disclaimer:</strong> This calculation follows the Nigeria Tax Act 2025 personal income tax rules in force from 1 January 2026: the first ₦800,000 at 0%, then 15%, 18%, 21%, 23% and 25%; rent relief of 20% of rent up to ₦500,000; and no Consolidated Relief Allowance. Actual tax liability may vary based on specific circumstances, additional reliefs, and the latest tax regulations. Consult a qualified tax professional for personalized advice.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}

