import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { Loader } from '@/components/ui';
import useProgress from '@/lib/useProgress';
import ExportMenu from '@/components/ExportMenu';
import { showAlertDialog } from '@/lib/dialogs';
import { combinePackQuantity, formatPackQuantity, splitPackQuantity } from '@/lib/packUnits';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faExclamationTriangle,
  faCheckCircle,
  faSearch, faClock,
  faBox,
  faTrashAlt,
} from '@fortawesome/free-solid-svg-icons';

const DAY_MS = 1000 * 60 * 60 * 24;

/** A batch's figure the way it is counted: "2 packs · 5 units" for a pack, the number otherwise. */
function qtyText(value, packSize) {
  if (value === null || value === undefined) return '—';
  return Number(packSize) > 1 ? formatPackQuantity(value, packSize) : String(Math.round(Number(value) * 100) / 100);
}

function sourceLabel(batch) {
  if (batch.source === 'recorded') return 'Recorded on product';
  if (batch.source === 'no-quantity') return 'Product expiry date';
  return batch.transRef || batch.batchId || 'N/A';
}

const STATUS_LABELS = {
  noQuantity: 'No quantity',
  disposed: 'Disposed',
  soldOut: 'Sold out',
  expired: 'Expired',
  critical: 'Critical (≤7 days)',
  warning: 'Warning (8-30 days)',
  ok: 'OK (>30 days)',
};

const STATUS_STYLES = {
  noQuantity: 'bg-amber-50 text-amber-800 border-amber-300',
  disposed: 'bg-slate-100 text-slate-700 border-slate-300',
  soldOut: 'bg-gray-100 text-gray-700 border-gray-300',
  expired: 'bg-red-100 text-red-800 border-red-300',
  critical: 'bg-orange-100 text-orange-800 border-orange-300',
  warning: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  ok: 'bg-green-100 text-green-800 border-green-300',
};

export default function ExpirationReport() {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('daysRemaining');
  const [locations, setLocations] = useState([]);
  // The batch being disposed of, and what is typed for it
  const [disposing, setDisposing] = useState(null);

  const fetchBatches = useCallback(async ({ fresh = false } = {}) => {
    try {
      if (!fresh) {
        setLoading(true);
        start();
        onFetch();
      }
      // Always worked out afresh here: the minute's copy is for the notification bell, and a batch
      // recorded on a product page a moment ago belongs on this page now
      const res = await fetch('/api/stock-movement/batches-with-expiry?fresh=1', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch batches');
      const data = await res.json();
      if (!fresh) onProcess();
      const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      setBatches(list.filter((batch) => batch.expiryDate));
    } catch (err) {
      console.error('Error fetching batches:', err);
      if (!fresh) setBatches([]);
    } finally {
      if (!fresh) {
        complete();
        setLoading(false);
      }
    }
  }, [start, onFetch, onProcess, complete]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  useEffect(() => {
    fetch('/api/setup/get')
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data?.store?.locations) ? data.store.locations : [];
        setLocations(list.filter((loc) => loc?._id && loc.isActive !== false).map((loc) => ({ _id: String(loc._id), name: loc.name || '' })));
      })
      .catch(() => {});
  }, []);

  // Days left and the band each batch is in
  const processedBatches = useMemo(() => {
    const now = new Date();
    return batches.map((batch) => {
      const expiry = new Date(batch.expiryDate);
      const daysRemaining = Math.ceil((expiry - now) / DAY_MS);
      let status = 'ok';
      if (batch.needsQuantity) status = 'noQuantity';
      else if (batch.finished) status = batch.finishedBy === 'disposed' ? 'disposed' : 'soldOut';
      else if (daysRemaining <= 0) status = 'expired';
      else if (daysRemaining <= 7) status = 'critical';
      else if (daysRemaining <= 30) status = 'warning';
      return { ...batch, daysRemaining, status, expiryDate: expiry.toISOString().split('T')[0] };
    });
  }, [batches]);

  const filteredBatches = useMemo(() => {
    let filtered = [...processedBatches];
    if (filterStatus !== 'all') filtered = filtered.filter((b) => b.status === filterStatus);
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((b) =>
        (b.productName && b.productName.toLowerCase().includes(term)) ||
        (b.batchId && b.batchId.toLowerCase().includes(term)) ||
        (b.category && b.category.toLowerCase().includes(term)) ||
        (b.locationName && b.locationName.toLowerCase().includes(term))
      );
    }
    filtered.sort((a, b) => {
      if (sortBy === 'daysRemaining') return (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity);
      if (sortBy === 'expiryDate') return new Date(a.expiryDate || '9999-12-31') - new Date(b.expiryDate || '9999-12-31');
      if (sortBy === 'name') return (a.productName || '').localeCompare(b.productName || '');
      return 0;
    });
    return filtered;
  }, [processedBatches, filterStatus, searchTerm, sortBy]);

  const stats = useMemo(() => {
    const count = (status) => processedBatches.filter((b) => b.status === status).length;
    return {
      total: processedBatches.length,
      soldOut: count('soldOut'),
      disposed: count('disposed'),
      noQuantity: count('noQuantity'),
      expired: count('expired'),
      critical: count('critical'),
      warning: count('warning'),
      ok: count('ok'),
    };
  }, [processedBatches]);

  /* ── Disposing of a batch ── */

  const openDispose = (batch) => {
    const size = Number(batch.packSize) > 1 ? Number(batch.packSize) : 1;
    const { packs, units } = splitPackQuantity(batch.remainingQuantity, size);
    setDisposing({
      batch,
      size,
      packs: String(size > 1 ? packs : Math.round(batch.remainingQuantity * 10000) / 10000),
      units: String(size > 1 ? units : 0),
      locationId: batch.locationId || locations[0]?._id || '',
      saving: false,
      error: '',
    });
  };

  const disposeQuantity = disposing
    ? disposing.size > 1
      ? combinePackQuantity(disposing.packs, disposing.units, disposing.size)
      : Number(disposing.packs)
    : 0;

  const confirmDispose = async () => {
    if (!disposing) return;
    const { batch } = disposing;
    if (!Number.isFinite(disposeQuantity) || disposeQuantity <= 0) {
      setDisposing({ ...disposing, error: 'Enter how many were thrown away.' });
      return;
    }
    // In whole units for a pack: fractions of a carton never add up exactly
    const tooMany = disposing.size > 1
      ? Math.round(disposeQuantity * disposing.size) > Math.round(batch.remainingQuantity * disposing.size)
      : disposeQuantity > batch.remainingQuantity + 1e-6;
    if (tooMany) {
      setDisposing({ ...disposing, error: `Only ${qtyText(batch.remainingQuantity, batch.packSize)} of this batch is left.` });
      return;
    }
    if (!disposing.locationId) {
      setDisposing({ ...disposing, error: 'Choose the location it was thrown away from.' });
      return;
    }
    setDisposing({ ...disposing, saving: true, error: '' });
    try {
      const res = await fetch('/api/stock-movement/stock-movement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromLocationId: disposing.locationId,
          reason: 'Operational Loss',
          notes: `Expired stock disposed of: ${batch.productName}, expiry ${batch.expiryDate}`,
          products: [{
            id: batch.productId,
            quantity: Math.round(disposeQuantity * 1e9) / 1e9,
            batchKey: batch.batchId,
            notes: `Disposed from expiry batch ${batch.batchId}`,
          }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error || 'Could not record the disposal');
      setDisposing(null);
      await fetchBatches({ fresh: true });
      await showAlertDialog({
        title: 'Disposed',
        message: `${qtyText(disposeQuantity, batch.packSize)} of ${batch.productName} written off as an operational loss. The batch shows what was disposed of.`,
        tone: 'success',
      });
    } catch (err) {
      setDisposing((prev) => (prev ? { ...prev, saving: false, error: err.message } : prev));
    }
  };

  const expiryExportColumns = [
    { key: 'batchId', label: 'Batch', width: 1.3, value: (b) => sourceLabel(b) },
    { key: 'productName', label: 'Product', width: 2.4 },
    { key: 'category', label: 'Category', width: 1.3 },
    { key: 'locationName', label: 'Location', width: 1.3 },
    { key: 'expiryDate', label: 'Expiry Date', type: 'date', width: 1.2 },
    { key: 'daysRemaining', label: 'Days Left', width: 1, value: (b) => (b.finished ? '' : b.daysRemaining) },
    { key: 'remainingQuantity', label: 'Left', width: 1.2, value: (b) => qtyText(b.remainingQuantity, b.packSize) },
    { key: 'originalQuantity', label: 'Batch', width: 1.2, value: (b) => qtyText(b.originalQuantity, b.packSize) },
    { key: 'soldQuantity', label: 'Sold', width: 1, value: (b) => qtyText(b.soldQuantity, b.packSize) },
    { key: 'disposedQuantity', label: 'Disposed', width: 1, value: (b) => qtyText(b.disposedQuantity, b.packSize) },
    { key: 'status', label: 'Status', width: 1.2, value: (b) => STATUS_LABELS[b.status] },
  ];

  const card = (status, label, value, color, icon) => (
    <button
      type="button"
      onClick={() => setFilterStatus(status)}
      className={`stat-card !p-4 text-left w-full border-t-4 ${color.border} transition hover:-translate-y-0.5 ${filterStatus === status ? 'ring-2 ring-sky-300' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="stat-card-label truncate">{label}</p>
          <p className={`stat-card-value !text-xl ${color.text}`}>{value}</p>
        </div>
        <FontAwesomeIcon icon={icon} className={`text-lg ${color.icon} flex-shrink-0`} />
      </div>
    </button>
  );

  return (
    <Layout>
      {loading ? (
        <Loader size="lg" text="Loading expiration report..." progress={progress} />
      ) : (
        <div className="page-container">
          <div className="page-content">
          <div className="page-header flex-row items-center justify-between">
            <div>
              <h1 className="page-title">Batch Expiration Report</h1>
              <p className="page-subtitle">
                Each batch and what is left of it. Sales use up the batch that expires first; dispose of expired stock here.
              </p>
            </div>
            <ExportMenu
              title="Batch Expiration Report"
              subtitle="Batches approaching or past their expiry date"
              columns={expiryExportColumns}
              rows={filteredBatches}
              summary={[
                { label: 'Batches', value: String(filteredBatches.length) },
                { label: 'Expired', value: String(stats.expired) },
                { label: 'Disposed', value: String(stats.disposed) },
              ]}
              orientation="l"
            />
          </div>

          {/* Summary cards — each one filters the list below it */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-6">
            {card('all', 'Total Batches', stats.total, { border: 'border-sky-600', text: 'text-gray-900', icon: 'text-sky-300' }, faBox)}
            {card('expired', 'Expired', stats.expired, { border: 'border-red-600', text: 'text-red-600', icon: 'text-red-300' }, faExclamationTriangle)}
            {card('critical', 'Critical (≤7 days)', stats.critical, { border: 'border-orange-600', text: 'text-orange-600', icon: 'text-orange-300' }, faClock)}
            {card('warning', 'Warning (8-30 days)', stats.warning, { border: 'border-yellow-600', text: 'text-yellow-600', icon: 'text-yellow-300' }, faExclamationTriangle)}
            {card('ok', 'OK (>30 days)', stats.ok, { border: 'border-green-600', text: 'text-green-600', icon: 'text-green-300' }, faCheckCircle)}
            {card('soldOut', 'Sold Out', stats.soldOut, { border: 'border-gray-600', text: 'text-gray-700', icon: 'text-gray-300' }, faCheckCircle)}
            {card('disposed', 'Disposed', stats.disposed, { border: 'border-slate-500', text: 'text-slate-700', icon: 'text-slate-300' }, faTrashAlt)}
            {card('noQuantity', 'No Quantity', stats.noQuantity, { border: 'border-amber-500', text: 'text-amber-700', icon: 'text-amber-300' }, faExclamationTriangle)}
          </div>

          <div className="content-card mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="form-group">
                <label className="form-label">Search Batches</label>
                <div className="search-input-wrapper">
                  <FontAwesomeIcon icon={faSearch} className="search-input-icon" />
                  <input
                    type="text"
                    placeholder="Search by product, batch ID, category, or location..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="search-input"
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Filter by Status</label>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="form-select">
                  <option value="all">All batches</option>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Sort By</label>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="form-select">
                  <option value="daysRemaining">Days Remaining (Urgent First)</option>
                  <option value="expiryDate">Expiry Date</option>
                  <option value="name">Product Name</option>
                </select>
              </div>
            </div>
          </div>

          <div className="data-table-container">
            {filteredBatches.length === 0 ? (
              <div className="empty-state-container">
                <FontAwesomeIcon icon={faCheckCircle} className="text-3xl text-green-400 mb-3" />
                <p className="empty-state-text">No batches found matching your criteria</p>
                {searchTerm && <p className="text-gray-500 text-sm mt-2">Try adjusting your search terms</p>}
              </div>
            ) : (
              <div className="overflow-auto max-h-[560px]">
                <table className="data-table">
                  <thead className="sticky top-0 z-10 bg-white">
                    <tr>
                      <th>Batch</th>
                      <th>Product Name</th>
                      <th>Category</th>
                      <th>Location</th>
                      <th>Expiry Date</th>
                      <th className="text-center">Days Remaining</th>
                      <th className="text-center">Left / Batch</th>
                      <th className="text-center">Status</th>
                      <th className="text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBatches.map((batch) => {
                      const used = [
                        batch.soldQuantity > 0 ? `${qtyText(batch.soldQuantity, batch.packSize)} sold` : null,
                        batch.disposedQuantity > 0 ? `${qtyText(batch.disposedQuantity, batch.packSize)} disposed` : null,
                        batch.otherQuantity > 0 ? `${qtyText(batch.otherQuantity, batch.packSize)} moved out` : null,
                      ].filter(Boolean);
                      const live = !batch.finished && !batch.needsQuantity;
                      return (
                        <tr
                          key={batch.batchId}
                          data-batch={batch.batchId}
                          className={
                            batch.status === 'expired' ? 'bg-red-50'
                              : batch.status === 'soldOut' || batch.status === 'disposed' ? 'bg-gray-50'
                              : batch.status === 'critical' ? 'bg-orange-50'
                              : batch.status === 'warning' ? 'bg-yellow-50'
                              : batch.status === 'noQuantity' ? 'bg-amber-50/60' : ''
                          }
                        >
                          <td className="font-mono text-xs text-gray-900">{sourceLabel(batch)}</td>
                          <td><p className="font-semibold text-gray-900">{batch.productName || 'N/A'}</p></td>
                          <td className="text-gray-600">{batch.category || 'N/A'}</td>
                          <td className="text-gray-600">{batch.locationName || '—'}</td>
                          <td className="font-medium text-gray-900">{batch.expiryDate}</td>
                          <td className="text-center">
                            {live ? (
                              <span className={`font-bold ${
                                batch.daysRemaining <= 0 ? 'text-red-600'
                                  : batch.daysRemaining <= 7 ? 'text-orange-600'
                                  : batch.daysRemaining <= 30 ? 'text-yellow-600' : 'text-green-600'
                              }`}>
                                {batch.daysRemaining} {batch.daysRemaining === 1 ? 'day' : 'days'}
                              </span>
                            ) : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="text-center text-gray-900" data-qty>
                            {batch.needsQuantity ? (
                              <span className="text-amber-700">Not set</span>
                            ) : (
                              <>
                                <span className="font-medium">{qtyText(batch.remainingQuantity, batch.packSize)}</span>
                                <span className="text-gray-500"> / {qtyText(batch.originalQuantity, batch.packSize)}</span>
                                {used.length > 0 && <span className="block text-xs text-gray-500">{used.join(' · ')}</span>}
                              </>
                            )}
                          </td>
                          <td className="text-center">
                            <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLES[batch.status]}`}>
                              {STATUS_LABELS[batch.status]}
                            </span>
                          </td>
                          <td className="text-center">
                            {batch.needsQuantity ? (
                              <Link href={`/products/edit/${batch.productId}`} className="inline-flex items-center px-2 py-1 text-xs font-medium border rounded text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200">
                                Set quantity
                              </Link>
                            ) : live ? (
                              <button
                                type="button"
                                onClick={() => openDispose(batch)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border rounded transition text-red-700 bg-red-50 hover:bg-red-100 border-red-200"
                                title="Write off stock from this batch that was thrown away"
                              >
                                <FontAwesomeIcon icon={faTrashAlt} className="w-3 h-3" />
                                Dispose
                              </button>
                            ) : (
                              <span className="text-xs text-gray-400">{STATUS_LABELS[batch.status]}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {filteredBatches.length > 0 && (
              <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
                <p className="text-sm text-gray-600">
                  Showing <span className="font-semibold">{filteredBatches.length}</span> of <span className="font-semibold">{stats.total}</span> batches
                </p>
              </div>
            )}
          </div>

          <div className="content-card mt-6">
            <h3 className="font-semibold text-gray-900 mb-4">Status Legend</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm text-gray-600">
              <p><span className={`mr-2 px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLES.expired}`}>Expired</span>Past its expiry date with stock left: dispose of it</p>
              <p><span className={`mr-2 px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLES.critical}`}>Critical</span>Expires within 7 days</p>
              <p><span className={`mr-2 px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLES.warning}`}>Warning</span>Expires within 30 days</p>
              <p><span className={`mr-2 px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLES.ok}`}>OK</span>Expires after 30 days</p>
              <p><span className={`mr-2 px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLES.soldOut}`}>Sold out</span>Every unit of the batch sold</p>
              <p><span className={`mr-2 px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLES.disposed}`}>Disposed</span>Finished by throwing the rest away</p>
              <p><span className={`mr-2 px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLES.noQuantity}`}>No quantity</span>An expiry date on a product with no quantity yet: set it on the product</p>
            </div>
          </div>
        </div>
        </div>
      )}

      {disposing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Dispose of expired stock">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-lg font-bold text-gray-900">Dispose of {disposing.batch.productName}</h2>
            <p className="mt-1 text-sm text-gray-600">
              Batch expiring {disposing.batch.expiryDate}: {qtyText(disposing.batch.remainingQuantity, disposing.batch.packSize)} left.
              What is thrown away comes off the stock and is booked as an operational loss.
            </p>
            <div className={`mt-4 grid gap-3 ${disposing.size > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <label className="form-group">
                <span className="form-label">{disposing.size > 1 ? `Packs (of ${disposing.size})` : 'Quantity'}</span>
                <input type="number" min="0" name="disposePacks" className="form-input" value={disposing.packs} onChange={(e) => setDisposing({ ...disposing, packs: e.target.value })} />
              </label>
              {disposing.size > 1 && (
                <label className="form-group">
                  <span className="form-label">Units</span>
                  <input type="number" min="0" name="disposeUnits" className="form-input" value={disposing.units} onChange={(e) => setDisposing({ ...disposing, units: e.target.value })} />
                </label>
              )}
            </div>
            {!disposing.batch.locationId && (
              <label className="form-group mt-3 block">
                <span className="form-label">Thrown away from</span>
                <select className="form-select" value={disposing.locationId} onChange={(e) => setDisposing({ ...disposing, locationId: e.target.value })}>
                  <option value="">Choose a location</option>
                  {locations.map((location) => <option key={location._id} value={location._id}>{location.name}</option>)}
                </select>
              </label>
            )}
            {disposing.error && <p className="mt-3 text-sm text-red-600">{disposing.error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-action btn-action-secondary" onClick={() => setDisposing(null)} disabled={disposing.saving}>Cancel</button>
              <button type="button" className="btn-action btn-action-danger" onClick={confirmDispose} disabled={disposing.saving}>
                {disposing.saving ? 'Recording…' : 'Dispose'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
