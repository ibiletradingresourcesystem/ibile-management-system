import Layout from "@/components/Layout";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faSearch, faFilter, faCheckCircle, faClock, faTimes, faXmark, faBox, faArrowRight, faCalendar, faUser } from "@fortawesome/free-solid-svg-icons";
import Loader from "@/components/Loader";
import useProgress from "@/lib/useProgress";
import { formatCurrency } from "@/lib/format";
import { showToastMessage } from "@/lib/toast-state";

const reasons = [
  "* All Reasons",
  "Restock",
  "Return",
  "Transfer",
  "Adjustment",
  "Operational Loss",
];
const statuses = ["All Statuses", "Pending", "Sent", "Received"];

export default function StockMovement() {
  const [movements, setMovements] = useState([]);
  const [locations, setLocations] = useState([]);
  const [locationMap, setLocationMap] = useState({});
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [locationFilter, setLocationFilter] = useState("* All Locations");
  const [reason, setReason] = useState("* All Reasons");
  const [status, setStatus] = useState("All Statuses");
  const [barcode, setBarcode] = useState("");
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [error, setError] = useState(null);
  const [selectedMovement, setSelectedMovement] = useState(null);

  // Fetch locations on mount
  useEffect(() => {
    async function fetchLocations() {
      try {
        const res = await fetch("/api/setup/setup");
        const data = await res.json();
        if (data?.store?.locations) {
          const locArray = data.store.locations;
          setLocations(["* All Locations", ...locArray.map(loc => loc.name)]);
          
          // Create a map of location ID to name
          const map = {};
          locArray.forEach(loc => {
            map[loc._id] = loc.name;
            map[loc.name] = loc.name; // Also map name to name for filter compatibility
          });
          setLocationMap(map);
        }
      } catch (err) {
        console.error("Error fetching locations:", err);
      }
    }
    fetchLocations();
  }, []);

  // Fetch stock movements
  useEffect(() => {
    async function fetchStockMovements() {
      try {
        setLoading(true);
        start();
        setError(null);
        onFetch();
        const res = await fetch("/api/stock-movement/get");
        const data = await res.json();

        // Handle different response formats - data can be:
        // 1. An array (direct array response)
        // 2. An object with a data property containing an array
        // 3. An object with a movements property
        let movementsArray = [];
        
        if (Array.isArray(data)) {
          movementsArray = data;
        } else if (data?.data && Array.isArray(data.data)) {
          movementsArray = data.data;
        } else if (data?.movements && Array.isArray(data.movements)) {
          movementsArray = data.movements;
        } else {
          console.warn("Unexpected data format from API:", data);
          console.warn("Data type:", typeof data);
          console.warn("Data keys:", data ? Object.keys(data) : "null");
          setError("Invalid data format received from server");
          setMovements([]);
          setLoading(false);
          return;
        }

        // Additional validation - ensure all items are objects
        onProcess();
        if (!Array.isArray(movementsArray) || !movementsArray.every(item => typeof item === 'object' && item !== null)) {
          console.error("Data validation failed - not all items are valid objects");
          setError("Invalid data format received");
          setMovements([]);
          setLoading(false);
          return;
        }

        setMovements(movementsArray);
      } catch (err) {
        console.error("Error fetching stock movements:", err);
        setError(err.message || "Failed to fetch stock movements");
        setMovements([]);
      } finally {
        complete();
        setLoading(false);
      }
    }

    fetchStockMovements();
  }, []);

  useEffect(() => {
    if (!error) return;
    showToastMessage({ title: "Stock movements", text: error, fallbackTone: "danger" });
    setError(null);
  }, [error]);

  const parseDate = (dateStr) => (dateStr ? new Date(dateStr) : null);

  const filteredMovements = movements.filter((item) => {
    // Use fromLocation (resolved name) for location filter
    if (locationFilter !== "* All Locations" && item.fromLocation !== locationFilter)
      return false;
    if (reason !== "* All Reasons" && item.reason !== reason) return false;
    if (status !== "All Statuses" && item.status !== status) return false;
    if (barcode && !item.transRef?.includes(barcode)) return false;
    if (fromDate) {
      const from = parseDate(fromDate);
      const dateSent = parseDate(item.dateSent);
      if (!dateSent || dateSent < from) return false;
    }
    if (toDate) {
      const to = parseDate(toDate);
      const dateSent = parseDate(item.dateSent);
      if (!dateSent || dateSent > to) return false;
    }
    return true;
  });

  const getStatusIcon = (status) => {
    switch(status) {
      case "Received":
        return <FontAwesomeIcon icon={faCheckCircle} className="text-green-600" />;
      case "Sent":
        return <FontAwesomeIcon icon={faClock} className="text-yellow-600" />;
      case "Pending":
        return <FontAwesomeIcon icon={faClock} className="text-gray-600" />;
      default:
        return <FontAwesomeIcon icon={faTimes} className="text-red-600" />;
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case "Received":
        return "bg-green-50 text-green-700 border-green-200";
      case "Sent":
        return "bg-yellow-50 text-yellow-700 border-yellow-200";
      case "Pending":
        return "bg-gray-50 text-gray-700 border-gray-200";
      default:
        return "bg-red-50 text-red-700 border-red-200";
    }
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
        {/* Header */}
        <div className="page-header flex-row items-center justify-between">
          <div>
            <h1 className="page-title">Stock Movements</h1>
            <p className="page-subtitle">Track transfers, adjustments, and operational stock losses</p>
          </div>
          <Link href="../stock/add">
            <button className="btn-action btn-action-primary flex items-center gap-2">
              <FontAwesomeIcon icon={faPlus} />
              New Stock Movement
            </button>
          </Link>
        </div>

        {loading ? (
          <div className="content-card flex items-center justify-center min-h-96">
            <Loader size="md" text="Loading stock movements..." progress={progress} />
          </div>
        ) : (
          <>
            {/* Filters Section */}
            <div className="content-card mb-6">
              <div className="flex items-center gap-2 mb-4">
                <FontAwesomeIcon icon={faFilter} className="text-sky-600 text-lg" />
                <h3 className="text-lg font-semibold text-gray-900">Filter Movements</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Date Range */}
                <div className="form-group">
                  <label className="form-label">From Date</label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">To Date</label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="form-input"
                  />
                </div>

                {/* Location Filter */}
                <div className="form-group">
                  <label className="form-label">Location</label>
                  <select
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                    className="form-select"
                  >
                    {locations.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Reason Filter */}
                <div className="form-group">
                  <label className="form-label">Reason</label>
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="form-select"
                  >
                    {reasons.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Filter */}
                <div className="form-group">
                  <label className="form-label">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="form-select"
                  >
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Barcode Search */}
              <div className="mt-4">
                <label className="form-label flex items-center gap-2">
                  <FontAwesomeIcon icon={faSearch} className="text-sky-600" />
                  Search by Reference/Barcode
                </label>
                <input
                  type="text"
                  placeholder="Enter transaction reference or barcode..."
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            {/* Results Summary */}
            <div className="mb-6 flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Showing <span className="font-semibold text-gray-900">{filteredMovements.length}</span> of <span className="font-semibold text-gray-900">{movements.length}</span> movements
              </p>
            </div>

            {/* Table */}
            <div className="data-table-container">
              {filteredMovements.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Reference</th>
                        <th>From Location</th>
                        <th>To Location</th>
                        <th>Reason</th>
                        <th>Status</th>
                        <th>Date Sent</th>
                        <th>Total Items</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMovements.map((item, index) => (
                        <tr 
                          key={index} 
                          onClick={() => setSelectedMovement(item)}
                          className="cursor-pointer hover:bg-sky-50 transition-colors"
                        >
                          <td className="font-mono font-medium text-gray-900">{item.transRef}</td>
                          <td className="text-gray-700">{item.fromLocation || "Vendor"}</td>
                          <td className="text-gray-700">{item.toLocation || "Unknown"}</td>
                          <td>
                            <span className="inline-block bg-sky-100 text-gray-900 px-3 py-1 rounded-full text-xs font-semibold">
                              {item.reason}
                            </span>
                          </td>
                          <td>
                            <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(item.status)}`}>
                              {getStatusIcon(item.status)}
                              {item.status}
                            </span>
                          </td>
                          <td className="text-gray-700">
                            {item.dateSent ? new Date(item.dateSent).toLocaleDateString() : "N/A"}
                          </td>
                          <td className="font-semibold text-gray-900">
                            {item.products?.length || 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state-container">
                  <p className="empty-state-text">No stock movements found matching your filters</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Movement Details Modal */}
        {selectedMovement && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedMovement(null)}>
            <div 
              className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-4 border-b text-white" style={{ backgroundColor: 'var(--table-header-bg)', borderBottomColor: 'var(--table-header-border)' }}>
                <div>
                  <h2 className="text-xl font-bold">Movement Details</h2>
                  <p className="text-sky-100 text-sm font-mono">{selectedMovement.transRef}</p>
                </div>
                <button 
                  onClick={() => setSelectedMovement(null)}
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <FontAwesomeIcon icon={faXmark} className="text-xl" />
                </button>
              </div>

              {/* Modal Content - Scrollable */}
              <div className="overflow-y-auto max-h-[calc(90vh-80px)]">
                {/* Movement Info */}
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 border-b bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-sky-100 rounded-lg flex items-center justify-center">
                      <FontAwesomeIcon icon={faArrowRight} className="text-sky-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">From → To</p>
                      <p className="font-semibold text-gray-900">
                        {selectedMovement.fromLocation || "Vendor"} → {selectedMovement.toLocation || "Unknown"}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                      <FontAwesomeIcon icon={faCheckCircle} className="text-green-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Status</p>
                      <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(selectedMovement.status)}`}>
                        {getStatusIcon(selectedMovement.status)}
                        {selectedMovement.status}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                      <FontAwesomeIcon icon={faCalendar} className="text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Date Sent</p>
                      <p className="font-semibold text-gray-900">
                        {selectedMovement.dateSent ? new Date(selectedMovement.dateSent).toLocaleString("en-NG") : "N/A"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                      <FontAwesomeIcon icon={faUser} className="text-purple-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Staff</p>
                      <p className="font-semibold text-gray-900">{selectedMovement.staffName || "N/A"}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <FontAwesomeIcon icon={faBox} className="text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Reason</p>
                      <span className="inline-block bg-sky-100 text-gray-900 px-3 py-1 rounded-full text-xs font-semibold">
                        {selectedMovement.reason}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                      <span className="text-emerald-600 font-bold text-sm">₦</span>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Total Cost</p>
                      <p className="font-bold text-lg text-gray-900">{formatCurrency(selectedMovement.totalCostPrice || 0)}</p>
                    </div>
                  </div>
                </div>

                {/* Products Table */}
                <div className="p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <FontAwesomeIcon icon={faBox} className="text-sky-600" />
                    Products ({selectedMovement.products?.length || 0} items, {selectedMovement.totalQuantity || 0} units)
                  </h3>
                  
                  {selectedMovement.products && selectedMovement.products.length > 0 ? (
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="text-left p-3 font-semibold text-gray-700">Product Name</th>
                            <th className="text-right p-3 font-semibold text-gray-700">Quantity</th>
                            <th className="text-right p-3 font-semibold text-gray-700">Unit Cost</th>
                            <th className="text-right p-3 font-semibold text-gray-700">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {selectedMovement.products.map((product, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="p-3 font-medium text-gray-900">{product.productName || "Unknown"}</td>
                              <td className="p-3 text-right text-gray-700">{product.quantity || 0}</td>
                              <td className="p-3 text-right text-gray-700">{formatCurrency(product.costPrice || 0)}</td>
                              <td className="p-3 text-right font-semibold text-gray-900">
                                {formatCurrency((product.quantity || 0) * (product.costPrice || 0))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-gray-50 border-t-2">
                          <tr>
                            <td colSpan="3" className="p-3 text-right font-bold text-gray-700">Total:</td>
                            <td className="p-3 text-right font-bold text-lg text-sky-700">
                              {formatCurrency(selectedMovement.totalCostPrice || 0)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <FontAwesomeIcon icon={faBox} className="text-4xl mb-2 text-gray-300" />
                      <p>No products in this movement</p>
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="p-4 border-t bg-gray-50 flex justify-between items-center">
                  <Link href={`/stock/movement/${selectedMovement._id}`}>
                    <button className="btn-action btn-action-secondary">
                      View Full Details
                    </button>
                  </Link>
                  <button 
                    onClick={() => setSelectedMovement(null)}
                    className="btn-action btn-action-primary"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </Layout>
  );
}

