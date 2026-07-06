import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import Layout from '@/components/Layout';
import { Loader } from '@/components/ui';
import useProgress from '@/lib/useProgress';
import { showToastMessage } from '@/lib/toast-state';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faCalendarAlt, 
  faExclamationTriangle, 
  faCheckCircle,
  faSearch,
  faDownload,
  faClock,
  faBox,
  faExchangeAlt,
  faBell
} from '@fortawesome/free-solid-svg-icons';

export default function ExpirationReport() {
  const router = useRouter();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'soldOut', 'critical', 'warning', 'ok'
  const [sortBy, setSortBy] = useState('daysRemaining'); // 'daysRemaining', 'expiryDate', 'name'
  const [dismissedSoldOutAlert, setDismissedSoldOutAlert] = useState(false);

  // Fetch stock movements with batch details on mount
  useEffect(() => {
    const fetchBatches = async () => {
      try {
        setLoading(true);
        start();
        onFetch();
        const res = await fetch('/api/stock-movement/batches-with-expiry');
        if (!res.ok) throw new Error('Failed to fetch batches');
        
        const data = await res.json();
        console.log('Fetched batch data:', data);
        
        // Handle different API response formats
        let batchList = [];
        if (Array.isArray(data)) {
          batchList = data;
        } else if (data.data && Array.isArray(data.data)) {
          batchList = data.data;
        } else if (data.batches && Array.isArray(data.batches)) {
          batchList = data.batches;
        }
        
        console.log('Processed batch list:', batchList);
        console.log('Total batches:', batchList.length);
        
        // Get all batches with proper date formatting
        const allBatches = batchList.map(batch => {
          let expiryDate = null;
          
          if (batch.expiryDate) {
            if (typeof batch.expiryDate === 'string') {
              expiryDate = batch.expiryDate.split('T')[0];
            } else if (batch.expiryDate instanceof Date) {
              expiryDate = batch.expiryDate.toISOString().split('T')[0];
            } else if (typeof batch.expiryDate === 'object' && batch.expiryDate.$date) {
              expiryDate = new Date(batch.expiryDate.$date).toISOString().split('T')[0];
            }
          }
          
          console.log(`Batch: ${batch.batchId || batch.transRef}, Product: ${batch.productName}, ExpiryDate: ${expiryDate}, Qty: ${batch.quantity}, Location: ${batch.locationName}, Category: ${batch.category}`);
          
          return {
            ...batch,
            expiryDate: expiryDate,
          };
        });
        
        // Filter to only include batches with expiry dates
        onProcess();
        const expiringBatches = allBatches.filter(b => b.expiryDate);
        console.log(`Found ${expiringBatches.length} batches with expiry dates out of ${allBatches.length} total`);
        
        setBatches(expiringBatches);

        // Notify if there are sold-out batches
        const soldOutCount = expiringBatches.filter(b => b.soldOut || Number(b.remainingQuantity ?? b.quantity ?? 0) <= 0).length;
        if (soldOutCount > 0) {
          showToastMessage({
            title: "Sold-Out Products",
            text: `${soldOutCount} batch${soldOutCount > 1 ? 'es' : ''} sold out. Review the expiration report for details.`,
            fallbackTone: "warning",
          });
        }
      } catch (err) {
        console.error('Error fetching batches:', err);
        setBatches([]);
      } finally {
        complete();
        setLoading(false);
      }
    };

    fetchBatches();
  }, []);

  // Calculate days remaining and status
  const processedBatches = useMemo(() => {
    const now = new Date();
    
    return batches.map(batch => {
      const expiryDate = new Date(batch.expiryDate);
      const daysRemaining = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      
      let status = 'ok';
      if (batch.soldOut || Number(batch.remainingQuantity ?? batch.quantity ?? 0) <= 0) status = 'soldOut';
      else if (daysRemaining <= 0) status = 'expired';
      else if (daysRemaining <= 7) status = 'critical';
      else if (daysRemaining <= 30) status = 'warning';
      
      return {
        ...batch,
        daysRemaining,
        status,
        soldOut: status === 'soldOut',
        expiryDate: expiryDate.toISOString().split('T')[0],
        originalQuantity: Number(batch.originalQuantity ?? batch.quantity ?? 0) || 0,
        remainingQuantity: Number(batch.remainingQuantity ?? batch.quantity ?? 0) || 0,
      };
    });
  }, [batches]);

  // Filter and sort batches
  const filteredBatches = useMemo(() => {
    let filtered = [...processedBatches]; // Create a copy to avoid mutations

    // Apply status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(b => b.status === filterStatus);
    }

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(b =>
        (b.productName && b.productName.toLowerCase().includes(term)) ||
        (b.batchId && b.batchId.toLowerCase().includes(term)) ||
        (b.category && b.category.toLowerCase().includes(term)) ||
        (b.locationName && b.locationName.toLowerCase().includes(term))
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      if (sortBy === 'daysRemaining') {
        // Sort by days remaining (urgent/expired first)
        const daysA = a.daysRemaining !== undefined ? a.daysRemaining : Infinity;
        const daysB = b.daysRemaining !== undefined ? b.daysRemaining : Infinity;
        return daysA - daysB;
      } else if (sortBy === 'expiryDate') {
        // Sort by expiry date (earliest first)
        const dateA = new Date(a.expiryDate || '9999-12-31');
        const dateB = new Date(b.expiryDate || '9999-12-31');
        return dateA - dateB;
      } else if (sortBy === 'name') {
        // Sort alphabetically by product name
        return (a.productName || '').localeCompare(b.productName || '');
      }
      return 0;
    });

    return filtered;
  }, [processedBatches, filterStatus, searchTerm, sortBy]);

  // Calculate summary statistics
  const stats = useMemo(() => {
    return {
      total: processedBatches.length,
      soldOut: processedBatches.filter(b => b.status === 'soldOut').length,
      expired: processedBatches.filter(b => b.status === 'expired').length,
      critical: processedBatches.filter(b => b.status === 'critical').length,
      warning: processedBatches.filter(b => b.status === 'warning').length,
      ok: processedBatches.filter(b => b.status === 'ok').length,
    };
  }, [processedBatches]);

  // Get status badge styling
  const getStatusStyles = (status) => {
    switch (status) {
      case 'soldOut':
        return 'bg-gray-100 text-gray-700 border-gray-300';
      case 'expired':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'critical':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'ok':
        return 'bg-green-100 text-green-800 border-green-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'soldOut':
        return 'Sold out';
      case 'expired':
        return 'Expired';
      case 'critical':
        return 'Critical (≤7 days)';
      case 'warning':
        return 'Warning (8-30 days)';
      case 'ok':
        return 'OK (>30 days)';
      default:
        return 'Unknown';
    }
  };

  // Export to CSV
  const handleExport = () => {
    const headers = ['Batch ID', 'Product Name', 'Category', 'Location', 'Expiry Date', 'Days Remaining', 'Remaining Qty', 'Original Qty', 'Status'];
    const rows = filteredBatches.map(b => [
      b.batchId || b.transRef || 'N/A',
      b.productName || 'N/A',
      b.category || 'N/A',
      b.locationName || 'N/A',
      b.expiryDate,
      b.daysRemaining,
      b.remainingQuantity,
      b.originalQuantity,
      getStatusLabel(b.status),
    ]);

    let csvContent = headers.join(',') + '\n';
    rows.forEach(row => {
      csvContent += row.map(cell => `"${cell}"`).join(',') + '\n';
    });

    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent));
    element.setAttribute('download', `batch-expiration-report-${new Date().toISOString().split('T')[0]}.csv`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <Layout>
      {loading ? (
        <Loader size="lg" text="Loading expiration report..." progress={progress} />
      ) : (
        <div className="page-container">
          <div className="page-content">
          {/* Header */}
          <div className="page-header flex-row items-center justify-between">
            <div>
              <h1 className="page-title">
                Batch Expiration Report
              </h1>
              <p className="page-subtitle">Monitor and manage product batches approaching their expiration dates</p>
            </div>
            <button
              onClick={handleExport}
              className="btn-action btn-action-success flex items-center gap-2"
            >
              <FontAwesomeIcon icon={faDownload} className="w-5 h-5" />
              Export CSV
            </button>
          </div>

          {/* Sold-Out Alert Banner */}
          {stats.soldOut > 0 && !dismissedSoldOutAlert && (
            <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
              <FontAwesomeIcon icon={faBell} className="text-amber-600 text-lg mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-amber-800">Sold-Out Batches Detected</p>
                <p className="text-sm text-amber-700 mt-1">
                  {stats.soldOut} batch{stats.soldOut > 1 ? 'es have' : ' has'} been completely sold out.
                  These products may need restocking or the expired batch records can be reviewed.
                </p>
                <button
                  onClick={() => setFilterStatus('soldOut')}
                  className="mt-2 text-sm font-medium text-amber-800 underline hover:text-amber-900"
                >
                  View sold-out batches
                </button>
              </div>
              <button
                onClick={() => setDismissedSoldOutAlert(true)}
                className="text-amber-400 hover:text-amber-600 text-lg font-bold leading-none"
                aria-label="Dismiss"
              >
                &times;
              </button>
            </div>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            {/* Total Card */}
            <div className="stat-card border-t-4 border-sky-600">
              <div className="flex items-center justify-between">
                <div>
                  <p className="stat-card-label">Total Batches</p>
                  <p className="stat-card-value text-gray-900">{stats.total}</p>
                </div>
                <FontAwesomeIcon icon={faBox} className="text-3xl text-sky-200" />
              </div>
            </div>

            {/* Sold Out Card */}
            <div className="stat-card border-t-4 border-gray-500">
              <div className="flex items-center justify-between">
                <div>
                  <p className="stat-card-label">Sold Out</p>
                  <p className="stat-card-value text-gray-700">{stats.soldOut}</p>
                </div>
                <FontAwesomeIcon icon={faCheckCircle} className="text-3xl text-gray-300" />
              </div>
            </div>

            {/* Expired Card */}
            <div className="stat-card border-t-4 border-red-600">
              <div className="flex items-center justify-between">
                <div>
                  <p className="stat-card-label">Expired</p>
                  <p className="stat-card-value text-red-600">{stats.expired}</p>
                </div>
                <FontAwesomeIcon icon={faExclamationTriangle} className="text-3xl text-red-200" />
              </div>
            </div>

            {/* Critical Card */}
            <div className="stat-card border-t-4 border-orange-600">
              <div className="flex items-center justify-between">
                <div>
                  <p className="stat-card-label">Critical (≤7 days)</p>
                  <p className="stat-card-value text-orange-600">{stats.critical}</p>
                </div>
                <FontAwesomeIcon icon={faClock} className="text-3xl text-orange-200" />
              </div>
            </div>

            {/* Warning Card */}
            <div className="stat-card border-t-4 border-yellow-600">
              <div className="flex items-center justify-between">
                <div>
                  <p className="stat-card-label">Warning (8-30 days)</p>
                  <p className="stat-card-value text-yellow-600">{stats.warning}</p>
                </div>
                <FontAwesomeIcon icon={faExclamationTriangle} className="text-3xl text-yellow-200" />
              </div>
            </div>

            {/* OK Card */}
            <div className="stat-card border-t-4 border-green-600">
              <div className="flex items-center justify-between">
                <div>
                  <p className="stat-card-label">OK (&gt;30 days)</p>
                  <p className="stat-card-value text-green-600">{stats.ok}</p>
                </div>
                <FontAwesomeIcon icon={faCheckCircle} className="text-3xl text-green-200" />
              </div>
            </div>
          </div>

          {/* Filters and Search */}
          <div className="content-card mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Search */}
              <div className="form-group">
                <label className="form-label">Search Batches</label>
                <div className="search-input-wrapper">
                  <FontAwesomeIcon 
                    icon={faSearch} 
                    className="search-input-icon"
                  />
                  <input
                    type="text"
                    placeholder="Search by product, batch ID, category, or location..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                  />
                </div>
              </div>

              {/* Status Filter */}
              <div className="form-group">
                <label className="form-label">Filter by Status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="form-select"
                >
                  <option value="all">All Products</option>
                  <option value="soldOut">Sold Out</option>
                  <option value="expired">Expired</option>
                  <option value="critical">Critical (≤7 days)</option>
                  <option value="warning">Warning (8-30 days)</option>
                  <option value="ok">OK (&gt;30 days)</option>
                </select>
              </div>

              {/* Sort By */}
              <div className="form-group">
                <label className="form-label">Sort By</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="form-select"
                >
                  <option value="daysRemaining">Days Remaining (Urgent First)</option>
                  <option value="expiryDate">Expiry Date</option>
                  <option value="name">Product Name</option>
                </select>
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="data-table-container">
            {loading ? (
              <div className="p-12 text-center">
                <div className="skeleton h-8 w-48 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading batches...</p>
              </div>
            ) : filteredBatches.length === 0 ? (
              <div className="empty-state-container">
                <FontAwesomeIcon icon={faCheckCircle} className="text-6xl text-green-400 mb-4" />
                <p className="empty-state-text">No batches found matching your criteria</p>
                {searchTerm && <p className="text-gray-500 text-sm mt-2">Try adjusting your search terms</p>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Batch ID</th>
                      <th>Product Name</th>
                      <th>Category</th>
                      <th>Location</th>
                      <th>Expiry Date</th>
                      <th className="text-center">Days Remaining</th>
                      <th className="text-center">Batch Qty</th>
                      <th className="text-center">Status</th>
                      <th className="text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBatches.map((batch, idx) => (
                      <tr 
                        key={idx} 
                        className={`
                          ${batch.status === 'expired' ? 'bg-red-50' :
                            batch.status === 'soldOut' ? 'bg-gray-50' :
                          batch.status === 'critical' ? 'bg-orange-50' :
                          batch.status === 'warning' ? 'bg-yellow-50' : ''}
                        `}
                      >
                        <td className="font-mono text-gray-900">{batch.batchId || batch.transRef || 'N/A'}</td>
                        <td>
                          <p className="font-semibold text-gray-900">{batch.productName || 'N/A'}</p>
                        </td>
                        <td className="text-gray-600">{batch.category || 'N/A'}</td>
                        <td className="text-gray-600">{batch.locationName || 'N/A'}</td>
                        <td className="font-medium text-gray-900">{batch.expiryDate}</td>
                        <td className="text-center">
                          <span className={`font-bold ${
                            batch.daysRemaining <= 0 ? 'text-red-600' :
                            batch.daysRemaining <= 7 ? 'text-orange-600' :
                            batch.daysRemaining <= 30 ? 'text-yellow-600' :
                            'text-green-600'
                          }`}>
                            {batch.daysRemaining} {batch.daysRemaining === 1 ? 'day' : 'days'}
                          </span>
                        </td>
                        <td className="text-center font-medium text-gray-900">
                          {batch.remainingQuantity} / {batch.originalQuantity}
                        </td>
                        <td className="text-center">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusStyles(batch.status)}`}>
                            {getStatusLabel(batch.status)}
                          </span>
                        </td>
                        <td className="text-center">
                          <button
                            onClick={() => {
                              if (batch.soldOut) return;
                              router.push(`/stock/add?adjustProductId=${batch.productId}&adjustQty=${batch.remainingQuantity}&reason=Adjustment`);
                            }}
                            disabled={batch.soldOut}
                            className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border rounded transition ${
                              batch.soldOut
                                ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-500'
                                : 'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200'
                            }`}
                            title={batch.soldOut ? "This FIFO batch is sold out" : "Create stock adjustment for this expiring batch"}
                          >
                            <FontAwesomeIcon icon={faExchangeAlt} className="w-3 h-3" />
                            {batch.soldOut ? 'Sold out' : 'Adjust'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Footer with count */}
            {filteredBatches.length > 0 && (
              <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
                <p className="text-sm text-gray-600">
                  Showing <span className="font-semibold">{filteredBatches.length}</span> of <span className="font-semibold">{stats.total}</span> batches
                </p>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="content-card mt-6">
            <h3 className="font-semibold text-gray-900 mb-4">Status Legend</h3>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-300">Sold Out</span>
                <span className="text-sm text-gray-600">Batch fully sold — restock needed</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 border border-red-300">Expired</span>
                <span className="text-sm text-gray-600">Product has already expired</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-800 border border-orange-300">Critical</span>
                <span className="text-sm text-gray-600">Expires within 7 days</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800 border border-yellow-300">Warning</span>
                <span className="text-sm text-gray-600">Expires within 30 days</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-300">OK</span>
                <span className="text-sm text-gray-600">Expires after 30 days</span>
              </div>
            </div>
          </div>
        </div>
        </div>
      )}
    </Layout>
  );
}
