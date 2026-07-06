import { useState, useEffect, useRef } from "react";
import Layout from "@/components/Layout";
import SalaryMemo from "@/components/SalaryMemo";
import axios from "axios";

export default function SalaryMemoPage() {
  const memoRef = useRef();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState("Main Account");
  const [selectedDirector, setSelectedDirector] = useState("Director");
  const [selectedStaff, setSelectedStaff] = useState([]);

  useEffect(() => {
    async function loadStaff() {
      try {
        const { data } = await axios.get("/api/staff");
        const staffList = (data.staff || data || []).filter(
          (s) => s.salary > 0 && s.isActive !== false
        );
        setStaff(staffList);
        setSelectedStaff(staffList.map((s) => s._id));
      } catch (err) {
        console.error("Failed to load staff:", err);
      } finally {
        setLoading(false);
      }
    }
    loadStaff();
  }, []);

  const toggleStaff = (id) => {
    setSelectedStaff((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const payrollStaff = staff.filter((s) => selectedStaff.includes(s._id));

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <p className="text-gray-500">Loading staff...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto p-4 md:p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Salary Transfer Memo</h1>
            <p className="text-sm text-gray-500">
              Generate salary transfer instruction for selected staff.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="border rounded px-3 py-2 text-sm"
            >
              <option value="Main Account">Main Account</option>
              <option value="Savings Account">Savings Account</option>
            </select>
            <input
              value={selectedDirector}
              onChange={(e) => setSelectedDirector(e.target.value)}
              className="border rounded px-3 py-2 text-sm w-40"
              placeholder="Director name"
            />
            <button
              onClick={() => memoRef.current?.generatePDF()}
              disabled={downloading || !payrollStaff.length}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {downloading ? "Generating..." : "Download PDF"}
            </button>
          </div>
        </div>

        {/* Staff Selection */}
        <div className="bg-white border rounded-lg p-4 mb-6">
          <p className="text-sm font-semibold text-gray-600 mb-2">
            Select Staff for Payroll ({selectedStaff.length}/{staff.length})
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={() => setSelectedStaff(staff.map((s) => s._id))}
              className="text-xs text-blue-600 font-medium hover:underline"
            >
              Select All
            </button>
            <button
              onClick={() => setSelectedStaff([])}
              className="text-xs text-gray-500 font-medium hover:underline"
            >
              Deselect All
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
            {staff.map((s) => {
              const penalties = (s.penalty || []).reduce(
                (p, pen) => p + Number(pen.amount || 0),
                0
              );
              const net = Number(s.salary || 0) - penalties;
              return (
                <label
                  key={s._id}
                  className={`flex items-center gap-2 p-2 rounded border cursor-pointer text-sm ${
                    selectedStaff.includes(s._id)
                      ? "bg-blue-50 border-blue-300"
                      : "hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedStaff.includes(s._id)}
                    onChange={() => toggleStaff(s._id)}
                    className="rounded"
                  />
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto text-xs text-gray-500">
                    ₦{net.toLocaleString()}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Memo Preview */}
        {payrollStaff.length > 0 && (
          <div className="overflow-x-auto">
            <SalaryMemo
              ref={memoRef}
              staffPayroll={payrollStaff}
              selectedAccount={selectedAccount}
              selectedDirector={selectedDirector}
              onDownloading={setDownloading}
            />
          </div>
        )}
      </div>
    </Layout>
  );
}
