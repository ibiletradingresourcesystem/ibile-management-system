/**
 * Mobile Stock Take Counter
 *
 * Standalone page (no sidebar or navbar) for staff to count stock on a phone.
 * Sign-in mirrors the main login: pick your name, then tap a four digit PIN on
 * a keypad. The old screen asked for a typed username and password, which is
 * the wrong shape for a phone and did not match the credentials staff actually
 * have (their PIN).
 *
 * URL: /stock-take-mobile/[id]
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import MobileBarcodeScanner from "@/components/MobileBarcodeScanner";

const PIN_LENGTH = 4;

export default function MobileStockTakePage() {
  const router = useRouter();
  const { id } = router.query;

  // Auth state
  const [token, setToken] = useState(null);
  const [staffName, setStaffName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [staffList, setStaffList] = useState([]);
  const [staffListLoading, setStaffListLoading] = useState(true);
  const [selectedStaff, setSelectedStaff] = useState("");
  const [pin, setPin] = useState("");
  const [countInfo, setCountInfo] = useState(null);

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
  const [lastScanned, setLastScanned] = useState("");
  const [filter, setFilter] = useState("all"); // all | pending | counted

  /* ─── Session ─────────────────────────────────────────────────── */

  useEffect(() => {
    const saved = sessionStorage.getItem("mobileStockTakeToken");
    const savedName = sessionStorage.getItem("mobileStockTakeStaff");
    if (saved) {
      setToken(saved);
      setStaffName(savedName || "");
    }
  }, []);

  // Staff who can sign in to this count, plus its reference for the header
  useEffect(() => {
    if (!router.isReady || !id || token) return;
    let cancelled = false;
    setStaffListLoading(true);
    fetch(`/api/stock-take/mobile/auth?stockTakeId=${encodeURIComponent(id)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setStaffList(data.staff || []);
        setCountInfo(data.stockTake || null);
        // A closed or unknown count comes back with no staff and a reason.
        if (data.message) setAuthError(data.message);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setStaffListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router.isReady, id, token]);

  const fetchStockTake = useCallback(async () => {
    if (!token || !id) return;
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
  }, [token, id]);

  useEffect(() => {
    if (token && id) fetchStockTake();
  }, [token, id, fetchStockTake]);

  /* ─── Login ───────────────────────────────────────────────────── */

  const handleKeypad = (value) => {
    setAuthError("");
    if (value === "clear") setPin("");
    else if (value === "back") setPin((p) => p.slice(0, -1));
    else if (pin.length < PIN_LENGTH) setPin((p) => p + value);
  };

  const handleLogin = useCallback(
    async (e) => {
      e?.preventDefault();
      setAuthError("");

      if (!selectedStaff) {
        setAuthError("Select your name to continue.");
        return;
      }
      if (pin.length !== PIN_LENGTH) {
        setAuthError(`PIN must be ${PIN_LENGTH} digits.`);
        return;
      }

      setAuthLoading(true);
      try {
        const res = await fetch("/api/stock-take/mobile/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: selectedStaff, password: pin, stockTakeId: id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Login failed");
        setToken(data.token);
        setStaffName(data.staff?.name || selectedStaff);
        sessionStorage.setItem("mobileStockTakeToken", data.token);
        sessionStorage.setItem("mobileStockTakeStaff", data.staff?.name || selectedStaff);
      } catch (err) {
        setAuthError(err.message);
        setPin("");
      } finally {
        setAuthLoading(false);
      }
    },
    [selectedStaff, pin, id]
  );

  // Submit as soon as the fourth digit lands, the way the main login behaves
  useEffect(() => {
    if (pin.length === PIN_LENGTH && selectedStaff && !authLoading) {
      handleLogin();
    }
  }, [pin]);

  const handleSignOut = () => {
    sessionStorage.removeItem("mobileStockTakeToken");
    sessionStorage.removeItem("mobileStockTakeStaff");
    setToken(null);
    setStaffName("");
    setStockTake(null);
    setPin("");
    setSelectedStaff("");
    setPendingCounts({});
  };

  /* ─── Counting ────────────────────────────────────────────────── */

  const handleCountChange = (itemId, value) => {
    setPendingCounts((prev) => ({ ...prev, [itemId]: value }));
  };

  const adjustCount = (itemId, currentValue, delta) => {
    const base = Number(currentValue);
    const next = Math.max(0, (Number.isFinite(base) ? base : 0) + delta);
    setPendingCounts((prev) => ({ ...prev, [itemId]: String(next) }));
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

  /**
   * A scan jumps to the product and focuses its quantity box, so the counter
   * can scan, type, scan, type without touching the screen in between.
   */
  const handleBarcodeScan = useCallback(
    (barcode) => {
      setLastScanned(barcode);
      if (!stockTake?.items) return;

      const normalized = String(barcode).trim().toLowerCase();
      const found = stockTake.items.find((item) => {
        if (!item.barcode) return false;
        // A product can carry several barcodes separated by commas or spaces.
        return String(item.barcode)
          .split(/[,;\s|]+/)
          .some((code) => code.trim().toLowerCase() === normalized);
      });

      if (found) {
        setHighlightedItem(found._id);
        setFilter("all");
        setSearchTerm("");
        setMessage("");
        setScannerOpen(false);
        setTimeout(() => {
          const el = document.getElementById(`item-${found._id}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          const input = document.getElementById(`qty-${found._id}`);
          if (input) {
            input.focus();
            input.select();
          }
        }, 150);
      } else {
        setMessage(`✗ No product on this count matches barcode ${barcode}`);
        setScannerOpen(false);
      }
    },
    [stockTake]
  );

  const filteredItems = useMemo(() => {
    const items = stockTake?.items || [];
    const term = searchTerm.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "counted" && item.status !== "counted") return false;
      if (filter === "pending" && item.status === "counted") return false;
      if (!term) return true;
      return (
        item.productName?.toLowerCase().includes(term) || item.barcode?.toLowerCase().includes(term)
      );
    });
  }, [stockTake, searchTerm, filter]);

  const pendingCount = Object.keys(pendingCounts).filter(
    (k) => pendingCounts[k] !== "" && pendingCounts[k] !== null
  ).length;

  const countedTotal = stockTake?.items?.filter((i) => i.status === "counted").length || 0;
  const itemsTotal = stockTake?.items?.length || 0;
  const progress = itemsTotal ? Math.round((countedTotal / itemsTotal) * 100) : 0;

  /* ─── Login screen ────────────────────────────────────────────── */

  if (!token) {
    return (
      <>
        <Head>
          <title>Stock Take Sign In</title>
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        </Head>
        <div className="mst-page">
          <div className="mst-login">
            <div className="mst-login__brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/logo.png" alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              <span className="mst-login__tag">Stock Take</span>
            </div>

            <h1>Staff Sign In</h1>
            <p className="mst-login__sub">
              {countInfo
                ? `${countInfo.reference} · ${countInfo.locationName}`
                : "Select your name and enter your 4-digit PIN"}
            </p>

            {authError && <div className="mst-error">{authError}</div>}

            <form onSubmit={handleLogin}>
              <label className="mst-field">
                <span>Staff Member</span>
                <select
                  value={selectedStaff}
                  onChange={(e) => {
                    setSelectedStaff(e.target.value);
                    setPin("");
                    setAuthError("");
                  }}
                  disabled={staffListLoading}
                >
                  <option value="">
                    {staffListLoading ? "Loading staff…" : "Select your name"}
                  </option>
                  {staffList.map((member) => (
                    <option key={member._id} value={member.name}>
                      {member.name}
                      {member.location ? ` — ${member.location}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              {!staffListLoading && staffList.length === 0 && (
                <p className="mst-login__hint">
                  No active staff found. Ask an administrator to add you under Manage &rarr; Staff Directory.
                </p>
              )}

              {/* PIN dots */}
              <div className="mst-pin">
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <span key={i} className={`mst-pin__dot ${pin.length > i ? "is-filled" : ""}`} />
                ))}
              </div>

              {/* Keypad */}
              <div className="mst-keypad">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, "C", 0, "←"].map((key) => (
                  <button
                    key={key}
                    type="button"
                    disabled={authLoading}
                    onClick={() => handleKeypad(key === "C" ? "clear" : key === "←" ? "back" : key)}
                    className={`mst-key ${key === "C" ? "is-clear" : key === "←" ? "is-back" : ""}`}
                  >
                    {key}
                  </button>
                ))}
              </div>

              <button type="submit" className="mst-login__submit" disabled={authLoading}>
                {authLoading ? "Signing in…" : "Sign in & Start Counting"}
              </button>
            </form>

            <p className="mst-login__footer">Authorized staff only</p>
          </div>
        </div>
        <MobileStockTakeStyles />
      </>
    );
  }

  /* ─── Loading / error ─────────────────────────────────────────── */

  if (loading) {
    return (
      <>
        <Head><title>Loading Stock Take…</title></Head>
        <div className="mst-page">
          <div className="mst-loading">Loading stock take…</div>
        </div>
        <MobileStockTakeStyles />
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
            <div className="mst-error-page__actions">
              <button onClick={fetchStockTake}>Retry</button>
              <button onClick={handleSignOut} className="is-ghost">Sign out</button>
            </div>
          </div>
        </div>
        <MobileStockTakeStyles />
      </>
    );
  }

  /* ─── Counter ─────────────────────────────────────────────────── */

  return (
    <>
      <Head>
        <title>Stock Take: {stockTake?.reference || ""}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>

      <div className="mst-page">
        <header className="mst-header">
          <div className="mst-header__info">
            <h1>{stockTake?.reference}</h1>
            <p>{stockTake?.locationName} · {staffName}</p>
          </div>
          <div className="mst-header__actions">
            {pendingCount > 0 && (
              <button onClick={handleSave} disabled={saving} className="mst-save-btn">
                {saving ? "Saving…" : `Save (${pendingCount})`}
              </button>
            )}
            <button onClick={handleSignOut} className="mst-signout" aria-label="Sign out">⏻</button>
          </div>
        </header>

        <div className="mst-progress">
          <div className="mst-progress__bar" style={{ width: `${progress}%` }} />
        </div>

        {message && (
          <div className={`mst-message ${message.startsWith("✓") ? "mst-message--success" : "mst-message--error"}`}>
            <span>{message}</span>
            <button onClick={() => setMessage("")} aria-label="Dismiss">×</button>
          </div>
        )}

        <div className="mst-search-bar">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setHighlightedItem(null); }}
            placeholder="Search name or barcode…"
          />
          <button onClick={() => setScannerOpen(true)} className="mst-scan-btn" aria-label="Scan barcode">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
              <path d="M7 8v8M10 8v8M13 8v8M16 8v8" />
            </svg>
          </button>
        </div>

        <div className="mst-stats">
          {[
            { key: "all", label: "All", value: itemsTotal },
            { key: "counted", label: "Counted", value: countedTotal },
            { key: "pending", label: "Pending", value: itemsTotal - countedTotal },
          ].map((stat) => (
            <button
              key={stat.key}
              onClick={() => setFilter(stat.key)}
              className={filter === stat.key ? "is-active" : ""}
            >
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </button>
          ))}
        </div>

        <div className="mst-items">
          {filteredItems.length === 0 ? (
            <div className="mst-empty">No items match this view</div>
          ) : (
            filteredItems.map((item) => {
              const counted = item.countedQty !== null && item.countedQty !== undefined;
              const pendingVal = pendingCounts[item._id];
              const displayQty = pendingVal !== undefined ? pendingVal : counted ? item.countedQty : "";
              const isHighlighted = highlightedItem === item._id;
              const variance =
                displayQty === "" ? null : Number(displayQty) - Number(item.systemQty || 0);

              return (
                <div
                  key={item._id}
                  id={`item-${item._id}`}
                  className={`mst-item ${counted ? "mst-item--counted" : ""} ${isHighlighted ? "mst-item--highlighted" : ""}`}
                >
                  <div className="mst-item__info">
                    <strong>{item.productName}</strong>
                    {item.barcode && <span className="mst-item__barcode">{item.barcode}</span>}
                    <span className="mst-item__meta">
                      <span className="mst-item__system">System {item.systemQty}</span>
                      {variance !== null && variance !== 0 && (
                        <span className={`mst-item__variance ${variance > 0 ? "is-up" : "is-down"}`}>
                          {variance > 0 ? `+${variance}` : variance}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="mst-item__input">
                    <button
                      type="button"
                      onClick={() => adjustCount(item._id, displayQty, -1)}
                      aria-label={`Decrease count for ${item.productName}`}
                    >
                      −
                    </button>
                    <input
                      id={`qty-${item._id}`}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={displayQty}
                      onChange={(e) => handleCountChange(item._id, e.target.value)}
                      placeholder="Qty"
                      aria-label={`Counted quantity for ${item.productName}`}
                    />
                    <button
                      type="button"
                      onClick={() => adjustCount(item._id, displayQty, 1)}
                      aria-label={`Increase count for ${item.productName}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {pendingCount > 0 && (
          <button onClick={handleSave} disabled={saving} className="mst-floating-save">
            {saving ? "Saving…" : `Save ${pendingCount} count${pendingCount === 1 ? "" : "s"}`}
          </button>
        )}

        {scannerOpen && (
          <MobileBarcodeScanner
            onScan={handleBarcodeScan}
            onClose={() => setScannerOpen(false)}
            lastResult={lastScanned}
            title="Scan a product"
          />
        )}
      </div>

      <MobileStockTakeStyles />
    </>
  );
}

/**
 * All styling for this page, kept in one place so the login and the counter
 * share the same tokens. The page is intentionally standalone, so it carries
 * its own colours rather than relying on the app shell.
 */
function MobileStockTakeStyles() {
  return (
    <style jsx global>{`
      :root {
        --mst-accent: #2563eb;
        --mst-accent-dark: #1d4ed8;
        --mst-accent-soft: #eff6ff;
        --mst-ink: #0f172a;
        --mst-muted: #64748b;
        --mst-line: #e2e8f0;
        --mst-ok: #16a34a;
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }

      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: #f1f5f9;
        color: var(--mst-ink);
        -webkit-text-size-adjust: 100%;
      }

      .mst-page {
        max-width: 480px;
        margin: 0 auto;
        min-height: 100dvh;
        background: #fff;
        overflow-x: hidden;
      }

      /* ── Login ───────────────────────────────────────────── */

      .mst-login { padding: 32px 22px calc(32px + env(safe-area-inset-bottom)); }

      .mst-login__brand {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin-bottom: 22px;
      }
      .mst-login__brand img { height: 40px; width: auto; }
      .mst-login__tag {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--mst-accent);
        background: var(--mst-accent-soft);
        border: 1px solid #bfdbfe;
        border-radius: 999px;
        padding: 4px 10px;
      }

      .mst-login h1 {
        font-size: 24px;
        font-weight: 800;
        text-align: center;
        margin-bottom: 6px;
      }
      .mst-login__sub {
        text-align: center;
        color: var(--mst-muted);
        font-size: 13px;
        margin-bottom: 22px;
      }
      .mst-login__hint {
        font-size: 12px;
        color: #b45309;
        background: #fffbeb;
        border: 1px solid #fde68a;
        border-radius: 10px;
        padding: 10px 12px;
        margin-bottom: 14px;
      }
      .mst-login__footer {
        text-align: center;
        font-size: 11px;
        color: #94a3b8;
        margin-top: 24px;
      }

      .mst-field { display: block; margin-bottom: 20px; }
      .mst-field span {
        display: block;
        font-size: 12px;
        font-weight: 700;
        color: #334155;
        margin-bottom: 7px;
      }
      .mst-field select {
        width: 100%;
        height: 52px;
        border: 1.5px solid #cbd5e1;
        border-radius: 12px;
        padding: 0 14px;
        font-size: 16px;
        background: #fff;
        color: var(--mst-ink);
        appearance: none;
        background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3e%3cpath d='M6 9l6 6 6-6'/%3e%3c/svg%3e");
        background-repeat: no-repeat;
        background-position: right 14px center;
        background-size: 18px;
      }
      .mst-field select:focus {
        outline: none;
        border-color: var(--mst-accent);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
      }

      .mst-pin {
        display: flex;
        justify-content: center;
        gap: 14px;
        margin-bottom: 22px;
      }
      .mst-pin__dot {
        width: 15px;
        height: 15px;
        border-radius: 50%;
        border: 2px solid #cbd5e1;
        background: #f1f5f9;
        transition: all 0.15s ease;
      }
      .mst-pin__dot.is-filled {
        background: var(--mst-accent);
        border-color: var(--mst-accent);
        transform: scale(1.12);
      }

      .mst-keypad {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
        margin-bottom: 22px;
      }
      .mst-key {
        height: 62px;
        border: 1.5px solid #e2e8f0;
        border-radius: 14px;
        background: var(--mst-accent-soft);
        color: #1e3a8a;
        font-size: 22px;
        font-weight: 700;
        cursor: pointer;
        transition: transform 0.08s ease, opacity 0.08s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .mst-key:active { transform: scale(0.95); opacity: 0.85; }
      .mst-key.is-clear { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
      .mst-key.is-back { background: #f1f5f9; color: #475569; border-color: #e2e8f0; }
      .mst-key:disabled { opacity: 0.5; }

      .mst-login__submit {
        width: 100%;
        height: 54px;
        border: 0;
        border-radius: 14px;
        background: var(--mst-accent);
        color: #fff;
        font-size: 16px;
        font-weight: 800;
        cursor: pointer;
        transition: transform 0.08s ease;
      }
      .mst-login__submit:active { transform: scale(0.98); }
      .mst-login__submit:disabled { opacity: 0.6; }

      .mst-error {
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 12px;
        padding: 12px 14px;
        color: #991b1b;
        font-size: 13px;
        margin-bottom: 16px;
        text-align: center;
      }

      /* ── Counter ─────────────────────────────────────────── */

      .mst-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 60vh;
        color: var(--mst-muted);
        font-size: 15px;
      }

      .mst-error-page { padding: 48px 24px; text-align: center; }
      .mst-error-page h2 { font-size: 20px; margin-bottom: 8px; }
      .mst-error-page p { color: var(--mst-muted); font-size: 14px; margin-bottom: 20px; }
      .mst-error-page__actions { display: flex; gap: 10px; justify-content: center; }
      .mst-error-page button {
        height: 44px;
        border: 0;
        border-radius: 10px;
        padding: 0 22px;
        background: var(--mst-accent);
        color: #fff;
        font-weight: 700;
        cursor: pointer;
      }
      .mst-error-page button.is-ghost {
        background: #fff;
        color: #475569;
        border: 1px solid var(--mst-line);
      }

      .mst-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 16px;
        border-bottom: 1px solid var(--mst-line);
        position: sticky;
        top: 0;
        background: #fff;
        z-index: 10;
      }
      .mst-header__info h1 { font-size: 15px; font-weight: 800; }
      .mst-header__info p { font-size: 11.5px; color: var(--mst-muted); margin-top: 2px; }
      .mst-header__actions { display: flex; align-items: center; gap: 8px; }
      .mst-save-btn {
        height: 38px;
        border: 0;
        border-radius: 10px;
        background: var(--mst-ok);
        color: #fff;
        font-size: 13px;
        font-weight: 700;
        padding: 0 14px;
        cursor: pointer;
        white-space: nowrap;
      }
      .mst-save-btn:disabled { opacity: 0.6; }
      .mst-signout {
        width: 38px;
        height: 38px;
        border: 1px solid var(--mst-line);
        border-radius: 10px;
        background: #fff;
        color: #64748b;
        font-size: 15px;
        cursor: pointer;
      }

      .mst-progress { height: 3px; background: #e2e8f0; }
      .mst-progress__bar {
        height: 100%;
        background: var(--mst-ok);
        transition: width 0.3s ease;
      }

      .mst-message {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 16px;
        font-size: 13px;
        font-weight: 600;
      }
      .mst-message--success { background: #ecfdf5; color: #065f46; }
      .mst-message--error { background: #fef2f2; color: #991b1b; }
      .mst-message button {
        border: 0;
        background: transparent;
        font-size: 18px;
        cursor: pointer;
        color: inherit;
        padding: 2px 6px;
      }

      .mst-search-bar {
        display: flex;
        gap: 8px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--mst-line);
        position: sticky;
        top: 56px;
        background: #fff;
        z-index: 9;
      }
      .mst-search-bar input {
        flex: 1;
        height: 46px;
        border: 1.5px solid #cbd5e1;
        border-radius: 12px;
        padding: 0 14px;
        font-size: 16px;
        -webkit-appearance: none;
      }
      .mst-search-bar input:focus {
        outline: none;
        border-color: var(--mst-accent);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
      }
      .mst-scan-btn {
        width: 46px;
        height: 46px;
        border: 0;
        border-radius: 12px;
        background: var(--mst-accent);
        color: #fff;
        cursor: pointer;
        display: grid;
        place-items: center;
        flex-shrink: 0;
      }
      .mst-scan-btn:active { transform: scale(0.95); }

      .mst-stats {
        display: flex;
        background: #f8fafc;
        border-bottom: 1px solid var(--mst-line);
      }
      .mst-stats button {
        flex: 1;
        padding: 9px 4px;
        border: 0;
        border-right: 1px solid var(--mst-line);
        border-bottom: 2px solid transparent;
        background: transparent;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 1px;
        align-items: center;
      }
      .mst-stats button:last-child { border-right: 0; }
      .mst-stats button strong { font-size: 15px; font-weight: 800; color: var(--mst-ink); }
      .mst-stats button span { font-size: 10.5px; color: var(--mst-muted); font-weight: 600; }
      .mst-stats button.is-active {
        border-bottom-color: var(--mst-accent);
        background: #fff;
      }
      .mst-stats button.is-active strong { color: var(--mst-accent); }

      .mst-items { padding: 10px 12px 110px; }
      .mst-empty { text-align: center; padding: 44px 16px; color: #94a3b8; font-size: 14px; }

      .mst-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        border: 1.5px solid var(--mst-line);
        border-radius: 12px;
        margin-bottom: 9px;
        background: #fff;
        transition: all 0.15s;
      }
      .mst-item--counted { border-color: #bbf7d0; background: #f0fdf4; }
      .mst-item--highlighted {
        border-color: var(--mst-accent);
        background: var(--mst-accent-soft);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
      }
      .mst-item__info { flex: 1; min-width: 0; }
      .mst-item__info strong {
        display: -webkit-box;
        font-size: 14px;
        line-height: 1.3;
        overflow: hidden;
        text-overflow: ellipsis;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .mst-item__barcode {
        display: block;
        font-size: 11px;
        color: var(--mst-muted);
        font-family: monospace;
        margin-top: 3px;
      }
      .mst-item__meta { display: flex; gap: 6px; align-items: center; margin-top: 5px; }
      .mst-item__system {
        display: inline-block;
        font-size: 10.5px;
        color: #fff;
        background: #64748b;
        padding: 2px 7px;
        border-radius: 5px;
        font-weight: 700;
      }
      .mst-item__variance {
        font-size: 10.5px;
        font-weight: 800;
        padding: 2px 7px;
        border-radius: 5px;
      }
      .mst-item__variance.is-up { background: #dcfce7; color: #15803d; }
      .mst-item__variance.is-down { background: #fee2e2; color: #b91c1c; }

      .mst-item__input { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
      .mst-item__input button {
        width: 36px;
        height: 46px;
        border: 1.5px solid #cbd5e1;
        border-radius: 10px;
        background: #f8fafc;
        color: #334155;
        font-size: 20px;
        font-weight: 700;
        cursor: pointer;
        line-height: 1;
      }
      .mst-item__input button:active { transform: scale(0.94); }
      .mst-item__input input {
        width: 64px;
        height: 46px;
        border: 1.5px solid #cbd5e1;
        border-radius: 10px;
        text-align: center;
        font-size: 17px;
        font-weight: 700;
        -webkit-appearance: none;
      }
      .mst-item__input input:focus {
        outline: none;
        border-color: var(--mst-accent);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
      }
      .mst-item__input input::-webkit-outer-spin-button,
      .mst-item__input input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }

      .mst-floating-save {
        position: fixed;
        bottom: calc(22px + env(safe-area-inset-bottom));
        left: 50%;
        transform: translateX(-50%);
        height: 52px;
        border: 0;
        border-radius: 26px;
        background: var(--mst-accent);
        color: #fff;
        font-size: 15px;
        font-weight: 800;
        padding: 0 30px;
        cursor: pointer;
        box-shadow: 0 6px 22px rgba(37, 99, 235, 0.4);
        z-index: 20;
        white-space: nowrap;
      }
      .mst-floating-save:disabled { opacity: 0.6; }
    `}</style>
  );
}
