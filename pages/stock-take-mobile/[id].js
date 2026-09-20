/**
 * Mobile Stock Take Counter
 *
 * Standalone page (no sidebar or navbar) for staff to count stock on a phone.
 *
 * Sign-in mirrors the main login: pick your name, then tap a four digit PIN on
 * a keypad.
 *
 * Counting is one item at a time. The page never downloads the item list; it
 * scans a barcode, asks the server for that single product, takes the quantity
 * and saves it. A full count can be thousands of products, and shipping them
 * all to a phone on shop-floor signal was slow and pointless when the counter
 * only ever works on one product at once.
 *
 * URL: /stock-take-mobile/[id]
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import MobileBarcodeScanner from "@/components/MobileBarcodeScanner";

const PIN_LENGTH = 4;

/** How many saved items to keep on screen as a running record. */
const RECENT_LIMIT = 8;

export default function MobileStockTakePage() {
  const router = useRouter();
  const { id } = router.query;

  // Auth
  const [token, setToken] = useState(null);
  const [staffName, setStaffName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [staffList, setStaffList] = useState([]);
  const [staffListLoading, setStaffListLoading] = useState(true);
  const [selectedStaff, setSelectedStaff] = useState("");
  const [pin, setPin] = useState("");
  const [countInfo, setCountInfo] = useState(null);

  // Count session
  const [stockTake, setStockTake] = useState(null);
  const [progress, setProgress] = useState({ total: 0, counted: 0, pending: 0, variances: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(null); // { tone, text }

  // The single item being counted right now
  const [activeItem, setActiveItem] = useState(null);
  const [choices, setChoices] = useState([]); // when one barcode maps to several lines
  const [qty, setQty] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastScanned, setLastScanned] = useState("");
  const [recent, setRecent] = useState([]);

  // Manual search fallback for damaged or missing barcodes
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const [scannerOpen, setScannerOpen] = useState(false);
  // Shown inside the scanner overlay, where the page's own message bar is hidden
  const [scanHint, setScanHint] = useState("");
  const qtyInputRef = useRef(null);
  const submittedPinRef = useRef("");

  /* ─── Session ─────────────────────────────────────────────────── */

  useEffect(() => {
    const saved = sessionStorage.getItem("mobileStockTakeToken");
    const savedName = sessionStorage.getItem("mobileStockTakeStaff");
    if (saved) {
      setToken(saved);
      setStaffName(savedName || "");
    }
  }, []);

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

  /** Shared fetch wrapper: adds the token and turns a 401 into a sign-out. */
  const api = useCallback(
    async (query = "", options = {}) => {
      const res = await fetch(`/api/stock-take/mobile/count?id=${id}${query}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(options.headers || {}),
        },
      });
      const data = await res.json();
      if (res.status === 401) {
        sessionStorage.removeItem("mobileStockTakeToken");
        sessionStorage.removeItem("mobileStockTakeStaff");
        setToken(null);
        throw new Error("Your session expired. Please sign in again.");
      }
      if (!res.ok) throw new Error(data.error || "Request failed");
      return data;
    },
    [id, token]
  );

  /** Header and totals only — never the item list. */
  const loadSummary = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true);
    setError("");
    try {
      const data = await api();
      setStockTake(data.stockTake);
      setProgress(data.progress);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [api, token, id]);

  useEffect(() => {
    if (token && id) loadSummary();
  }, [token, id, loadSummary]);

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

      // The auto-submit effect below re-runs once authLoading clears. Without
      // this guard a successful sign-in fires the request a second time.
      if (submittedPinRef.current === `${selectedStaff}:${pin}`) return;
      submittedPinRef.current = `${selectedStaff}:${pin}`;

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
        submittedPinRef.current = "";
      } finally {
        setAuthLoading(false);
      }
    },
    [selectedStaff, pin, id]
  );

  // Submit once the fourth digit lands, the way the main login behaves
  useEffect(() => {
    if (pin.length === PIN_LENGTH && selectedStaff && !authLoading) handleLogin();
  }, [pin, selectedStaff, authLoading, handleLogin]);

  const handleSignOut = () => {
    sessionStorage.removeItem("mobileStockTakeToken");
    sessionStorage.removeItem("mobileStockTakeStaff");
    setToken(null);
    setStaffName("");
    setStockTake(null);
    setActiveItem(null);
    setChoices([]);
    setRecent([]);
    setPin("");
    setSelectedStaff("");
  };

  /* ─── One item at a time ──────────────────────────────────────── */

  const openItem = useCallback((item) => {
    setChoices([]);
    setActiveItem(item);
    setQty(item.countedQty !== null && item.countedQty !== undefined ? String(item.countedQty) : "");
    setSearchOpen(false);
    setSearchTerm("");
    setSearchResults([]);
    setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 120);
  }, []);

  /** Fetch just the scanned product. */
  const lookupBarcode = useCallback(
    async (barcode) => {
      setLastScanned(barcode);
      setLookingUp(true);
      setMessage(null);
      try {
        const data = await api(`&barcode=${encodeURIComponent(barcode)}`);
        setProgress(data.progress);

        if (!data.found) {
          // Stay on the camera so the counter can try the next item, and say
          // why here: the page's message bar sits behind the scanner overlay.
          setActiveItem(null);
          setChoices([]);
          setScanHint(`Not on this count: ${barcode}`);
          setMessage({
            tone: "error",
            text: `No product on this count carries barcode ${barcode}. Use Find by name instead.`,
          });
          return;
        }

        setScanHint("");
        setScannerOpen(false);
        if (data.items.length === 1) {
          openItem(data.items[0]);
        } else {
          // One barcode, several lines (sealed packs and loose units).
          setActiveItem(null);
          setChoices(data.items);
        }
      } catch (err) {
        setScanHint(err.message);
        setMessage({ tone: "error", text: err.message });
      } finally {
        setLookingUp(false);
      }
    },
    [api, openItem]
  );

  /** Short server-side search; the phone still never holds the whole list. */
  useEffect(() => {
    if (!searchOpen) return undefined;
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return undefined;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api(`&search=${encodeURIComponent(term)}`);
        if (cancelled) return;
        setSearchResults(data.items || []);
        setProgress(data.progress);
      } catch (err) {
        if (!cancelled) setMessage({ tone: "error", text: err.message });
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchTerm, searchOpen, api]);

  const adjustQty = (delta) => {
    const base = Number(qty);
    setQty(String(Math.max(0, (Number.isFinite(base) ? base : 0) + delta)));
  };

  const saveActiveItem = async () => {
    if (!activeItem) return;
    const value = Number(qty);
    if (qty === "" || !Number.isFinite(value) || value < 0) {
      setMessage({ tone: "error", text: "Enter a quantity of zero or more." });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const data = await api("", {
        method: "PUT",
        body: JSON.stringify({ counts: [{ itemId: activeItem._id, countedQty: value }] }),
      });

      const saved = data.items?.[0];
      setProgress(data.progress);
      setRecent((prev) => [
        {
          _id: activeItem._id,
          productName: activeItem.productName,
          countedQty: value,
          systemQty: activeItem.systemQty,
          variance: saved ? saved.variance : value - activeItem.systemQty,
          at: Date.now(),
        },
        ...prev.filter((r) => r._id !== activeItem._id),
      ].slice(0, RECENT_LIMIT));

      setMessage({ tone: "success", text: `${activeItem.productName} saved as ${value}` });
      setActiveItem(null);
      setQty("");
      try {
        navigator.vibrate?.(40);
      } catch {}

      // "Save & scan next" means exactly that: go straight back to the camera
      // so a counter can work down a shelf without a tap in between.
      setScanHint(`Saved ${activeItem.productName} as ${value}`);
      setScannerOpen(true);
    } catch (err) {
      setMessage({ tone: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const cancelActiveItem = () => {
    setActiveItem(null);
    setChoices([]);
    setQty("");
  };

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
              <img
                src="/images/logo.png"
                alt=""
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
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
                  <option value="">{staffListLoading ? "Loading staff…" : "Select your name"}</option>
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
                  No staff are available for this count. Check the link, or ask an administrator.
                </p>
              )}

              <div className="mst-pin">
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <span key={i} className={`mst-pin__dot ${pin.length > i ? "is-filled" : ""}`} />
                ))}
              </div>

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

  if (loading && !stockTake) {
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
              <button onClick={loadSummary}>Retry</button>
              <button onClick={handleSignOut} className="is-ghost">Sign out</button>
            </div>
          </div>
        </div>
        <MobileStockTakeStyles />
      </>
    );
  }

  const pct = progress.total ? Math.round((progress.counted / progress.total) * 100) : 0;
  const variance =
    activeItem && qty !== "" && Number.isFinite(Number(qty))
      ? Number(qty) - Number(activeItem.systemQty || 0)
      : null;

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
          <button onClick={handleSignOut} className="mst-signout" aria-label="Sign out">⏻</button>
        </header>

        <div className="mst-progress">
          <div className="mst-progress__bar" style={{ width: `${pct}%` }} />
        </div>

        <div className="mst-stats">
          <div><strong>{progress.total}</strong><span>Total</span></div>
          <div><strong>{progress.counted}</strong><span>Counted</span></div>
          <div><strong>{progress.pending}</strong><span>Left</span></div>
          <div><strong>{pct}%</strong><span>Done</span></div>
        </div>

        {message && (
          <div className={`mst-message mst-message--${message.tone}`}>
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)} aria-label="Dismiss">×</button>
          </div>
        )}

        <div className="mst-body">
          {/* ── The item being counted ── */}
          {activeItem ? (
            <div className="mst-card">
              <p className="mst-card__label">Counting</p>
              <h2 className="mst-card__name">{activeItem.productName}</h2>
              <div className="mst-card__meta">
                {activeItem.barcode && <span className="mst-chip is-mono">{activeItem.barcode}</span>}
                <span className="mst-chip">System {activeItem.systemQty}</span>
                {activeItem.countType === "loose-units" && <span className="mst-chip is-warn">Loose units</span>}
                {activeItem.status === "counted" && (
                  <span className="mst-chip is-ok">Already counted: {activeItem.countedQty}</span>
                )}
              </div>

              <label className="mst-qty-label" htmlFor="mst-qty">Counted quantity</label>
              <div className="mst-qty">
                <button type="button" onClick={() => adjustQty(-1)} aria-label="Decrease">−</button>
                <input
                  id="mst-qty"
                  ref={qtyInputRef}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveActiveItem();
                    }
                  }}
                  placeholder="0"
                />
                <button type="button" onClick={() => adjustQty(1)} aria-label="Increase">+</button>
              </div>

              {variance !== null && (
                <p className={`mst-variance ${variance === 0 ? "" : variance > 0 ? "is-up" : "is-down"}`}>
                  {variance === 0
                    ? "Matches the system count"
                    : `${variance > 0 ? "+" : ""}${variance} against system`}
                </p>
              )}

              <div className="mst-card__actions">
                <button onClick={cancelActiveItem} className="mst-btn is-ghost" disabled={saving}>
                  Cancel
                </button>
                <button onClick={saveActiveItem} className="mst-btn is-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save & scan next"}
                </button>
              </div>
            </div>
          ) : choices.length > 0 ? (
            /* ── One barcode, several lines ── */
            <div className="mst-card">
              <p className="mst-card__label">Two entries share this barcode</p>
              <h2 className="mst-card__name">{choices[0].productName}</h2>
              <p className="mst-choice-hint">Pick the one you are counting.</p>
              <div className="mst-choices">
                {choices.map((item) => (
                  <button key={item._id} onClick={() => openItem(item)} className="mst-choice">
                    <span className="mst-choice__type">
                      {item.countType === "loose-units" ? "Loose units" : "Standard"}
                    </span>
                    <span className="mst-choice__qty">System {item.systemQty}</span>
                  </button>
                ))}
              </div>
              <button onClick={cancelActiveItem} className="mst-btn is-ghost mst-full">Cancel</button>
            </div>
          ) : searchOpen ? (
            /* ── Find by name ── */
            <div className="mst-card">
              <p className="mst-card__label">Find by name or barcode</p>
              <input
                type="text"
                className="mst-search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Type at least 2 characters"
                autoFocus
              />
              <div className="mst-results">
                {searching && <p className="mst-results__note">Searching…</p>}
                {!searching && searchTerm.trim().length >= 2 && searchResults.length === 0 && (
                  <p className="mst-results__note">Nothing on this count matches.</p>
                )}
                {searchResults.map((item) => (
                  <button key={item._id} onClick={() => openItem(item)} className="mst-result">
                    <span className="mst-result__name">{item.productName}</span>
                    <span className="mst-result__meta">
                      System {item.systemQty}
                      {item.status === "counted" ? ` · counted ${item.countedQty}` : ""}
                    </span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => {
                  setSearchOpen(false);
                  setSearchTerm("");
                  setSearchResults([]);
                }}
                className="mst-btn is-ghost mst-full"
              >
                Back to scanning
              </button>
            </div>
          ) : (
            /* ── Idle: scan next ── */
            <div className="mst-idle">
              <button
                className="mst-scan-cta"
                onClick={() => {
                  setScanHint("");
                  setScannerOpen(true);
                }}
                disabled={lookingUp}
              >
                <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
                  <path d="M7 8v8M10 8v8M13 8v8M16 8v8" />
                </svg>
                <span>{lookingUp ? "Looking up…" : "Scan a product"}</span>
              </button>
              <p className="mst-idle__hint">
                Scan one product, enter the quantity, save. Then scan the next.
              </p>
              <button onClick={() => setSearchOpen(true)} className="mst-btn is-ghost mst-full">
                No barcode? Find by name
              </button>
            </div>
          )}

          {/* ── What was just saved ── */}
          {recent.length > 0 && !activeItem && (
            <div className="mst-recent">
              <p className="mst-recent__title">Saved this session</p>
              {recent.map((r) => (
                <div key={r._id} className="mst-recent__row">
                  <span className="mst-recent__name">{r.productName}</span>
                  <span className="mst-recent__qty">
                    {r.countedQty}
                    {r.variance !== 0 && (
                      <em className={r.variance > 0 ? "is-up" : "is-down"}>
                        {r.variance > 0 ? `+${r.variance}` : r.variance}
                      </em>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {scannerOpen && (
          <MobileBarcodeScanner
            onScan={lookupBarcode}
            onClose={() => {
              setScannerOpen(false);
              setScanHint("");
            }}
            lastResult={lastScanned}
            title="Scan a product"
            hint={scanHint || `${progress.counted} of ${progress.total} counted`}
          />
        )}
      </div>

      <MobileStockTakeStyles />
    </>
  );
}

/**
 * All styling for this page. It is deliberately standalone: the page renders
 * outside the app shell, so it carries its own tokens rather than the theme.
 */
function MobileStockTakeStyles() {
  return (
    <style jsx global>{`
      :root {
        --mst-accent: #2563eb;
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
        display: flex; align-items: center; justify-content: center;
        gap: 10px; margin-bottom: 22px;
      }
      .mst-login__brand img { height: 40px; width: auto; }
      .mst-login__tag {
        font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.1em; color: var(--mst-accent);
        background: var(--mst-accent-soft); border: 1px solid #bfdbfe;
        border-radius: 999px; padding: 4px 10px;
      }
      .mst-login h1 { font-size: 24px; font-weight: 800; text-align: center; margin-bottom: 6px; }
      .mst-login__sub { text-align: center; color: var(--mst-muted); font-size: 13px; margin-bottom: 22px; }
      .mst-login__hint {
        font-size: 12px; color: #b45309; background: #fffbeb;
        border: 1px solid #fde68a; border-radius: 10px;
        padding: 10px 12px; margin-bottom: 14px;
      }
      .mst-login__footer { text-align: center; font-size: 11px; color: #94a3b8; margin-top: 24px; }

      .mst-field { display: block; margin-bottom: 20px; }
      .mst-field span {
        display: block; font-size: 12px; font-weight: 700;
        color: #334155; margin-bottom: 7px;
      }
      .mst-field select {
        width: 100%; height: 52px; border: 1.5px solid #cbd5e1; border-radius: 12px;
        padding: 0 14px; font-size: 16px; background: #fff; color: var(--mst-ink);
        appearance: none;
        background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3e%3cpath d='M6 9l6 6 6-6'/%3e%3c/svg%3e");
        background-repeat: no-repeat; background-position: right 14px center; background-size: 18px;
      }
      .mst-field select:focus {
        outline: none; border-color: var(--mst-accent);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
      }

      .mst-pin { display: flex; justify-content: center; gap: 14px; margin-bottom: 22px; }
      .mst-pin__dot {
        width: 15px; height: 15px; border-radius: 50%;
        border: 2px solid #cbd5e1; background: #f1f5f9; transition: all 0.15s ease;
      }
      .mst-pin__dot.is-filled {
        background: var(--mst-accent); border-color: var(--mst-accent); transform: scale(1.12);
      }

      .mst-keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 22px; }
      .mst-key {
        height: 62px; border: 1.5px solid #e2e8f0; border-radius: 14px;
        background: var(--mst-accent-soft); color: #1e3a8a;
        font-size: 22px; font-weight: 700; cursor: pointer;
        transition: transform 0.08s ease, opacity 0.08s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .mst-key:active { transform: scale(0.95); opacity: 0.85; }
      .mst-key.is-clear { background: #fee2e2; color: #b91c1c; border-color: #fecaca; }
      .mst-key.is-back { background: #f1f5f9; color: #475569; border-color: #e2e8f0; }
      .mst-key:disabled { opacity: 0.5; }

      .mst-login__submit {
        width: 100%; height: 54px; border: 0; border-radius: 14px;
        background: var(--mst-accent); color: #fff; font-size: 16px;
        font-weight: 800; cursor: pointer; transition: transform 0.08s ease;
      }
      .mst-login__submit:active { transform: scale(0.98); }
      .mst-login__submit:disabled { opacity: 0.6; }

      .mst-error {
        background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px;
        padding: 12px 14px; color: #991b1b; font-size: 13px;
        margin-bottom: 16px; text-align: center;
      }

      /* ── Shell ───────────────────────────────────────────── */

      .mst-loading {
        display: flex; align-items: center; justify-content: center;
        min-height: 60vh; color: var(--mst-muted); font-size: 15px;
      }
      .mst-error-page { padding: 48px 24px; text-align: center; }
      .mst-error-page h2 { font-size: 20px; margin-bottom: 8px; }
      .mst-error-page p { color: var(--mst-muted); font-size: 14px; margin-bottom: 20px; }
      .mst-error-page__actions { display: flex; gap: 10px; justify-content: center; }
      .mst-error-page button {
        height: 44px; border: 0; border-radius: 10px; padding: 0 22px;
        background: var(--mst-accent); color: #fff; font-weight: 700; cursor: pointer;
      }
      .mst-error-page button.is-ghost { background: #fff; color: #475569; border: 1px solid var(--mst-line); }

      .mst-header {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 12px 16px; border-bottom: 1px solid var(--mst-line);
        position: sticky; top: 0; background: #fff; z-index: 10;
      }
      .mst-header__info h1 { font-size: 15px; font-weight: 800; }
      .mst-header__info p { font-size: 11.5px; color: var(--mst-muted); margin-top: 2px; }
      .mst-signout {
        width: 38px; height: 38px; border: 1px solid var(--mst-line); border-radius: 10px;
        background: #fff; color: #64748b; font-size: 15px; cursor: pointer; flex-shrink: 0;
      }

      .mst-progress { height: 4px; background: #e2e8f0; }
      .mst-progress__bar { height: 100%; background: var(--mst-ok); transition: width 0.3s ease; }

      .mst-stats {
        display: flex; background: #f8fafc; border-bottom: 1px solid var(--mst-line);
      }
      .mst-stats div {
        flex: 1; padding: 9px 4px; display: flex; flex-direction: column;
        align-items: center; gap: 1px; border-right: 1px solid var(--mst-line);
      }
      .mst-stats div:last-child { border-right: 0; }
      .mst-stats strong { font-size: 16px; font-weight: 800; }
      .mst-stats span { font-size: 10.5px; color: var(--mst-muted); font-weight: 600; }

      .mst-message {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 11px 16px; font-size: 13px; font-weight: 600;
      }
      .mst-message--success { background: #ecfdf5; color: #065f46; }
      .mst-message--error { background: #fef2f2; color: #991b1b; }
      .mst-message button {
        border: 0; background: transparent; font-size: 18px;
        cursor: pointer; color: inherit; padding: 2px 6px; flex-shrink: 0;
      }

      .mst-body { padding: 16px 14px calc(28px + env(safe-area-inset-bottom)); }

      /* ── Idle ────────────────────────────────────────────── */

      .mst-idle { text-align: center; padding: 18px 0 8px; }
      .mst-scan-cta {
        width: 100%; min-height: 150px; border: 2px dashed #bfdbfe; border-radius: 18px;
        background: var(--mst-accent-soft); color: var(--mst-accent);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 12px; font-size: 17px; font-weight: 800; cursor: pointer;
        transition: transform 0.08s ease;
      }
      .mst-scan-cta:active { transform: scale(0.98); }
      .mst-scan-cta:disabled { opacity: 0.6; }
      .mst-idle__hint { color: var(--mst-muted); font-size: 13px; margin: 14px 0 16px; line-height: 1.5; }

      /* ── Item card ───────────────────────────────────────── */

      .mst-card {
        border: 1.5px solid var(--mst-line); border-radius: 16px;
        padding: 18px 16px; background: #fff;
        box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
      }
      .mst-card__label {
        font-size: 10.5px; font-weight: 800; text-transform: uppercase;
        letter-spacing: 0.08em; color: var(--mst-muted); margin-bottom: 6px;
      }
      .mst-card__name { font-size: 19px; font-weight: 800; line-height: 1.3; margin-bottom: 12px; }
      .mst-card__meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px; }
      .mst-chip {
        font-size: 11px; font-weight: 700; padding: 4px 9px; border-radius: 6px;
        background: #f1f5f9; color: #475569;
      }
      .mst-chip.is-mono { font-family: monospace; font-weight: 600; }
      .mst-chip.is-ok { background: #dcfce7; color: #15803d; }
      .mst-chip.is-warn { background: #fef3c7; color: #b45309; }

      .mst-qty-label {
        display: block; font-size: 12px; font-weight: 700;
        color: #334155; margin-bottom: 8px;
      }
      .mst-qty { display: flex; gap: 10px; align-items: stretch; }
      .mst-qty button {
        width: 60px; border: 1.5px solid #cbd5e1; border-radius: 12px;
        background: #f8fafc; color: #334155; font-size: 26px; font-weight: 700;
        cursor: pointer; line-height: 1; flex-shrink: 0;
      }
      .mst-qty button:active { transform: scale(0.94); }
      .mst-qty input {
        flex: 1; height: 64px; border: 2px solid var(--mst-accent); border-radius: 12px;
        text-align: center; font-size: 28px; font-weight: 800;
        -webkit-appearance: none; min-width: 0;
      }
      .mst-qty input:focus { outline: none; box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.16); }
      .mst-qty input::-webkit-outer-spin-button,
      .mst-qty input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

      .mst-variance { margin-top: 10px; font-size: 13px; font-weight: 700; color: var(--mst-muted); }
      .mst-variance.is-up { color: #15803d; }
      .mst-variance.is-down { color: #b91c1c; }

      .mst-card__actions { display: flex; gap: 10px; margin-top: 20px; }
      .mst-btn {
        flex: 1; height: 52px; border-radius: 12px; border: 0;
        font-size: 15px; font-weight: 800; cursor: pointer;
      }
      .mst-btn:active { transform: scale(0.98); }
      .mst-btn:disabled { opacity: 0.6; }
      .mst-btn.is-primary { background: var(--mst-accent); color: #fff; }
      .mst-btn.is-ghost { background: #fff; color: #475569; border: 1.5px solid var(--mst-line); }
      .mst-full { width: 100%; margin-top: 14px; }

      /* ── Choices & search ────────────────────────────────── */

      .mst-choice-hint { font-size: 13px; color: var(--mst-muted); margin-bottom: 14px; }
      .mst-choices { display: flex; flex-direction: column; gap: 10px; }
      .mst-choice {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px; border: 1.5px solid var(--mst-line); border-radius: 12px;
        background: #f8fafc; cursor: pointer; text-align: left;
      }
      .mst-choice__type { font-size: 15px; font-weight: 700; }
      .mst-choice__qty { font-size: 12.5px; color: var(--mst-muted); font-weight: 600; }

      .mst-search {
        width: 100%; height: 52px; border: 1.5px solid #cbd5e1; border-radius: 12px;
        padding: 0 14px; font-size: 16px; -webkit-appearance: none;
      }
      .mst-search:focus {
        outline: none; border-color: var(--mst-accent);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
      }
      .mst-results { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
      .mst-results__note { font-size: 13px; color: var(--mst-muted); padding: 10px 2px; }
      .mst-result {
        display: flex; flex-direction: column; gap: 3px; align-items: flex-start;
        padding: 13px 14px; border: 1.5px solid var(--mst-line); border-radius: 12px;
        background: #fff; cursor: pointer; text-align: left; width: 100%;
      }
      .mst-result:active { background: var(--mst-accent-soft); }
      .mst-result__name { font-size: 14.5px; font-weight: 700; line-height: 1.3; }
      .mst-result__meta { font-size: 12px; color: var(--mst-muted); font-weight: 600; }

      /* ── Recent ──────────────────────────────────────────── */

      .mst-recent {
        margin-top: 22px; border-top: 1px solid var(--mst-line); padding-top: 14px;
      }
      .mst-recent__title {
        font-size: 10.5px; font-weight: 800; text-transform: uppercase;
        letter-spacing: 0.08em; color: var(--mst-muted); margin-bottom: 10px;
      }
      .mst-recent__row {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 9px 0; border-bottom: 1px solid #f1f5f9; font-size: 13.5px;
      }
      .mst-recent__row:last-child { border-bottom: 0; }
      .mst-recent__name {
        flex: 1; min-width: 0; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; color: #334155;
      }
      .mst-recent__qty { font-weight: 800; flex-shrink: 0; }
      .mst-recent__qty em {
        font-style: normal; font-size: 11.5px; font-weight: 700; margin-left: 6px;
        padding: 2px 6px; border-radius: 5px;
      }
      .mst-recent__qty em.is-up { background: #dcfce7; color: #15803d; }
      .mst-recent__qty em.is-down { background: #fee2e2; color: #b91c1c; }
    `}</style>
  );
}
