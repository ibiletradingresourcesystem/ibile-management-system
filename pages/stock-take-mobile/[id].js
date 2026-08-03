/**
 * Mobile Stock Take Counter
 * Standalone page (no sidebar/navbar) for staff to count stock via phone.
 * Supports barcode scanning via camera and name search.
 * URL: /stock-take-mobile/[id]
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import Head from "next/head";

export default function MobileStockTakePage() {
  const router = useRouter();
  const { id } = router.query;

  // Auth state
  const [token, setToken] = useState(null);
  const [staffName, setStaffName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Stock take state
  const [stockTake, setStockTake] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [pendingCounts, setPendingCounts] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [highlightedItem, setHighlightedItem] = useState(null);

  // Check for existing session
  useEffect(() => {
    const saved = sessionStorage.getItem("mobileStockTakeToken");
    const savedName = sessionStorage.getItem("mobileStockTakeStaff");
    if (saved) {
      setToken(saved);
      setStaffName(savedName || "");
    }
  }, []);

  // Fetch stock take when authenticated
  useEffect(() => {
    if (token && id) fetchStockTake();
  }, [token, id]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const res = await fetch("/api/stock-take/mobile/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, stockTakeId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      setToken(data.token);
      setStaffName(data.staff?.name || "");
      sessionStorage.setItem("mobileStockTakeToken", data.token);
      sessionStorage.setItem("mobileStockTakeStaff", data.staff?.name || "");
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const fetchStockTake = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/stock-take/mobile/count?id=${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setStockTake(data.stockTake);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCountChange = (itemId, value) => {
    setPendingCounts((prev) => ({ ...prev, [itemId]: value }));
  };

  const handleSave = async () => {
    const counts = Object.entries(pendingCounts)
      .filter(([, val]) => val !== "" && val !== null)
      .map(([itemId, countedQty]) => ({ itemId, countedQty: Number(countedQty) }));

    if (counts.length === 0) {
      setMessage("No counts to save");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`/api/stock-take/mobile/count?id=${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ counts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setMessage(`✓ ${data.updated} item(s) saved`);
      setPendingCounts({});
      fetchStockTake();
    } catch (err) {
      setMessage(`✗ ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleBarcodeScan = useCallback((barcode) => {
    if (!stockTake?.items) return;
    const found = stockTake.items.find(
      (item) => item.barcode && item.barcode.toLowerCase() === barcode.toLowerCase()
    );
    if (found) {
      setHighlightedItem(found._id);
      setSearchTerm(barcode);
      setScannerOpen(false);
      // Scroll to item
      setTimeout(() => {
        const el = document.getElementById(`item-${found._id}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    } else {
      setMessage(`No product found for barcode: ${barcode}`);
      setScannerOpen(false);
    }
  }, [stockTake]);

  const filteredItems = stockTake?.items?.filter((item) => {
    if (!searchTerm) return true;
    const t = searchTerm.toLowerCase();
    return item.productName?.toLowerCase().includes(t) || item.barcode?.toLowerCase().includes(t);
  }) || [];

  const pendingCount = Object.keys(pendingCounts).filter((k) => pendingCounts[k] !== "" && pendingCounts[k] !== null).length;

  // ─── Login Screen ──────────────────────────────────────────
  if (!token) {
    return (
      <>
        <Head><title>Stock Take Login</title></Head>
        <div className="mst-page">
          <div className="mst-login">
            <div className="mst-login__header">
              <h1>📋 Stock Take</h1>
              <p>Sign in with your staff credentials to begin counting</p>
            </div>
            {authError && <div className="mst-error">{authError}</div>}
            <form onSubmit={handleLogin}>
              <label>
                <span>Username or Email</span>
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required placeholder="Your name or email" autoComplete="username" />
              </label>
              <label>
                <span>Password</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" autoComplete="current-password" />
              </label>
              <button type="submit" disabled={authLoading}>
                {authLoading ? "Signing in..." : "Sign in & Start"}
              </button>
            </form>
          </div>
        </div>
      </>
    );
  }

  // ─── Loading / Error ──────────────────────────────────────────
  if (loading) {
    return (
      <>
        <Head><title>Loading Stock Take...</title></Head>
        <div className="mst-page"><div className="mst-loading">Loading stock take...</div></div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Head><title>Stock Take Error</title></Head>
        <div className="mst-page">
          <div className="mst-error-page">
            <h2>Unable to load stock take</h2>
            <p>{error}</p>
            <button onClick={fetchStockTake}>Retry</button>
          </div>
        </div>
      </>
    );
  }

  // ─── Main Counter Interface ──────────────────────────────────
  return (
    <>
      <Head><title>Stock Take: {stockTake?.reference || ""}</title></Head>
      <div className="mst-page">
        {/* Header */}
        <header className="mst-header">
          <div className="mst-header__info">
            <h1>{stockTake?.reference}</h1>
            <p>{stockTake?.locationName} • {staffName}</p>
          </div>
          <div className="mst-header__actions">
            {pendingCount > 0 && (
              <button onClick={handleSave} disabled={saving} className="mst-save-btn">
                {saving ? "Saving..." : `Save (${pendingCount})`}
              </button>
            )}
          </div>
        </header>

        {/* Message */}
        {message && (
          <div className={`mst-message ${message.startsWith("✓") ? "mst-message--success" : "mst-message--error"}`}>
            {message}
            <button onClick={() => setMessage("")}>×</button>
          </div>
        )}

        {/* Search & Scan Bar */}
        <div className="mst-search-bar">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setHighlightedItem(null); }}
            placeholder="Search product name or barcode..."
          />
          <button onClick={() => setScannerOpen(true)} className="mst-scan-btn" title="Scan barcode">
            📷
          </button>
        </div>

        {/* Stats */}
        <div className="mst-stats">
          <span>Total: {stockTake?.items?.length || 0}</span>
          <span>Counted: {stockTake?.items?.filter((i) => i.status === "counted").length || 0}</span>
          <span>Pending: {stockTake?.items?.filter((i) => i.status !== "counted").length || 0}</span>
        </div>

        {/* Items List */}
        <div className="mst-items">
          {filteredItems.length === 0 ? (
            <div className="mst-empty">No items match your search</div>
          ) : (
            filteredItems.map((item) => {
              const counted = item.countedQty !== null && item.countedQty !== undefined;
              const pendingVal = pendingCounts[item._id];
              const displayQty = pendingVal !== undefined ? pendingVal : (counted ? item.countedQty : "");
              const isHighlighted = highlightedItem === item._id;

              return (
                <div
                  key={item._id}
                  id={`item-${item._id}`}
                  className={`mst-item ${counted ? "mst-item--counted" : ""} ${isHighlighted ? "mst-item--highlighted" : ""}`}
                >
                  <div className="mst-item__info">
                    <strong>{item.productName}</strong>
                    {item.barcode && <span className="mst-item__barcode">{item.barcode}</span>}
                    <span className="mst-item__system">System: {item.systemQty}</span>
                  </div>
                  <div className="mst-item__input">
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={displayQty}
                      onChange={(e) => handleCountChange(item._id, e.target.value)}
                      placeholder="Qty"
                    />
                    {counted && pendingVal === undefined && (
                      <span className="mst-item__check">✓</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Floating Save Button */}
        {pendingCount > 0 && (
          <button onClick={handleSave} disabled={saving} className="mst-floating-save">
            {saving ? "Saving..." : `Save ${pendingCount} count(s)`}
          </button>
        )}

        {/* Barcode Scanner Modal */}
        {scannerOpen && (
          <BarcodeScanner
            onScan={handleBarcodeScan}
            onClose={() => setScannerOpen(false)}
          />
        )}
      </div>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f5f5; }

        .mst-page { max-width: 480px; margin: 0 auto; min-height: 100dvh; background: #fff; }

        .mst-login { padding: 48px 24px; }
        .mst-login__header { text-align: center; margin-bottom: 32px; }
        .mst-login__header h1 { font-size: 28px; margin-bottom: 8px; }
        .mst-login__header p { color: #666; font-size: 14px; }
        .mst-login form { display: flex; flex-direction: column; gap: 16px; }
        .mst-login label { display: flex; flex-direction: column; gap: 6px; }
        .mst-login label span { font-size: 13px; font-weight: 600; color: #333; }
        .mst-login input { height: 46px; border: 1px solid #d0d5dd; border-radius: 8px; padding: 0 14px; font-size: 16px; }
        .mst-login input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
        .mst-login button { height: 48px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; margin-top: 8px; }
        .mst-login button:disabled { opacity: 0.6; }

        .mst-error { background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; color: #991b1b; font-size: 13px; margin-bottom: 16px; }

        .mst-loading { display: flex; align-items: center; justify-content: center; min-height: 60vh; color: #666; font-size: 15px; }

        .mst-error-page { padding: 48px 24px; text-align: center; }
        .mst-error-page h2 { font-size: 20px; margin-bottom: 8px; }
        .mst-error-page p { color: #666; font-size: 14px; margin-bottom: 20px; }
        .mst-error-page button { height: 40px; border: 1px solid #d0d5dd; border-radius: 8px; padding: 0 20px; background: #fff; font-weight: 600; cursor: pointer; }

        .mst-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 16px 12px; border-bottom: 1px solid #e5e7eb; position: sticky; top: 0; background: #fff; z-index: 10; }
        .mst-header__info h1 { font-size: 16px; font-weight: 800; }
        .mst-header__info p { font-size: 12px; color: #666; margin-top: 2px; }
        .mst-save-btn { height: 36px; border: 0; border-radius: 6px; background: #16a34a; color: #fff; font-size: 13px; font-weight: 700; padding: 0 14px; cursor: pointer; }
        .mst-save-btn:disabled { opacity: 0.6; }

        .mst-message { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; font-size: 13px; font-weight: 600; }
        .mst-message--success { background: #ecfdf5; color: #065f46; }
        .mst-message--error { background: #fef2f2; color: #991b1b; }
        .mst-message button { border: 0; background: transparent; font-size: 18px; cursor: pointer; color: inherit; }

        .mst-search-bar { display: flex; gap: 8px; padding: 12px 16px; border-bottom: 1px solid #e5e7eb; position: sticky; top: 60px; background: #fff; z-index: 9; }
        .mst-search-bar input { flex: 1; height: 42px; border: 1px solid #d0d5dd; border-radius: 8px; padding: 0 14px; font-size: 15px; }
        .mst-search-bar input:focus { outline: none; border-color: #2563eb; }
        .mst-scan-btn { width: 42px; height: 42px; border: 1px solid #d0d5dd; border-radius: 8px; background: #fff; font-size: 20px; cursor: pointer; display: grid; place-items: center; }
        .mst-scan-btn:active { background: #f3f4f6; }

        .mst-stats { display: flex; gap: 12px; padding: 10px 16px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; font-size: 12px; font-weight: 700; color: #555; }

        .mst-items { padding: 8px 12px 100px; }
        .mst-empty { text-align: center; padding: 40px 16px; color: #999; font-size: 14px; }

        .mst-item { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 8px; background: #fff; transition: all 0.2s; }
        .mst-item--counted { border-color: #bbf7d0; background: #f0fdf4; }
        .mst-item--highlighted { border-color: #93c5fd; background: #eff6ff; box-shadow: 0 0 0 2px rgba(59,130,246,0.3); }
        .mst-item__info { flex: 1; min-width: 0; }
        .mst-item__info strong { display: block; font-size: 13px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .mst-item__barcode { display: block; font-size: 11px; color: #666; font-family: monospace; margin-top: 2px; }
        .mst-item__system { display: block; font-size: 11px; color: #888; margin-top: 3px; }
        .mst-item__input { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
        .mst-item__input input { width: 64px; height: 40px; border: 2px solid #d0d5dd; border-radius: 8px; text-align: center; font-size: 16px; font-weight: 700; }
        .mst-item__input input:focus { outline: none; border-color: #2563eb; }
        .mst-item__check { color: #16a34a; font-weight: 800; font-size: 16px; }

        .mst-floating-save { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); height: 48px; border: 0; border-radius: 24px; background: #2563eb; color: #fff; font-size: 15px; font-weight: 700; padding: 0 28px; cursor: pointer; box-shadow: 0 4px 20px rgba(37,99,235,0.4); z-index: 20; }
        .mst-floating-save:disabled { opacity: 0.6; }

        .mst-scanner { position: fixed; inset: 0; z-index: 50; background: #000; display: flex; flex-direction: column; }
        .mst-scanner__header { display: flex; align-items: center; justify-content: space-between; padding: 16px; color: #fff; }
        .mst-scanner__header h2 { font-size: 16px; font-weight: 700; }
        .mst-scanner__close { border: 0; background: rgba(255,255,255,0.2); color: #fff; width: 36px; height: 36px; border-radius: 50%; font-size: 18px; cursor: pointer; }
        .mst-scanner__video { flex: 1; object-fit: cover; }
        .mst-scanner__overlay { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 260px; height: 120px; border: 2px solid rgba(255,255,255,0.6); border-radius: 12px; }
        .mst-scanner__manual { padding: 16px; background: #111; }
        .mst-scanner__manual input { width: 100%; height: 44px; border: 1px solid #444; border-radius: 8px; background: #222; color: #fff; padding: 0 14px; font-size: 15px; }
        .mst-scanner__manual button { width: 100%; height: 42px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; font-size: 14px; font-weight: 700; margin-top: 8px; cursor: pointer; }
      `}</style>
    </>
  );
}

// ─── Barcode Scanner Component ──────────────────────────────
function BarcodeScanner({ onScan, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [manualBarcode, setManualBarcode] = useState("");
  const [cameraError, setCameraError] = useState("");
  const scanningRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        // Start scanning loop
        scanningRef.current = true;
        requestAnimationFrame(scanLoop);
      } catch (err) {
        if (!cancelled) setCameraError("Camera access denied. Use manual entry below.");
      }
    }

    async function scanLoop() {
      if (!scanningRef.current || !videoRef.current || !canvasRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        // Use BarcodeDetector API if available
        if ("BarcodeDetector" in window) {
          try {
            const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e"] });
            const barcodes = await detector.detect(canvas);
            if (barcodes.length > 0 && scanningRef.current) {
              scanningRef.current = false;
              onScan(barcodes[0].rawValue);
              return;
            }
          } catch { /* BarcodeDetector failed, continue loop */ }
        }
      }

      if (scanningRef.current) {
        requestAnimationFrame(scanLoop);
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      scanningRef.current = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [onScan]);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (manualBarcode.trim()) onScan(manualBarcode.trim());
  };

  const handleClose = () => {
    scanningRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    onClose();
  };

  return (
    <div className="mst-scanner">
      <div className="mst-scanner__header">
        <h2>Scan Barcode</h2>
        <button onClick={handleClose} className="mst-scanner__close">×</button>
      </div>

      {cameraError ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#aaa", padding: 24, textAlign: "center" }}>
          <p>{cameraError}</p>
        </div>
      ) : (
        <div style={{ position: "relative", flex: 1 }}>
          <video ref={videoRef} className="mst-scanner__video" playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <div className="mst-scanner__overlay" />
        </div>
      )}

      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* Manual entry fallback */}
      <div className="mst-scanner__manual">
        <form onSubmit={handleManualSubmit}>
          <input
            type="text"
            value={manualBarcode}
            onChange={(e) => setManualBarcode(e.target.value)}
            placeholder="Or type barcode manually..."
            autoFocus={!!cameraError}
          />
          <button type="submit">Search barcode</button>
        </form>
      </div>
    </div>
  );
}
