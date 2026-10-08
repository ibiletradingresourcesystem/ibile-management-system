/**
 * Mobile Stock Take Counter
 *
 * Standalone page (no sidebar or navbar) for staff to count stock on a phone.
 *
 * Sign-in mirrors the main login: pick your name, then tap a four digit PIN on a keypad.
 *
 * The count's list is loaded once and kept on the phone (and in its storage, so a reload opens
 * at once). A scan is then a lookup on the phone, not a trip to the server, and counting carries
 * on when the signal drops: counts are kept in a queue on the phone and sent as soon as the
 * phone is back online. The list is checked for other counters' changes now and then, and only
 * downloaded again when something changed.
 *
 * Counted lines can be found again (search, mine or everyone's) and corrected or taken back off.
 * Only an admin sees the system quantity and the difference from it: everyone else counts what is
 * on the shelf. The server does not send those figures to anyone else.
 *
 * URL: /stock-take-mobile/[id]
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import MobileBarcodeScanner from "@/components/MobileBarcodeScanner";

const PIN_LENGTH = 4;

/** A code just found not to be on the count is not asked about again for this long. */
const NOT_FOUND_MEMORY_MS = 8000;

/** How often to look for other counters' changes while the page is open. */
const REFRESH_EVERY_MS = 90 * 1000;

/** How often to try sending queued counts again while there is no signal. */
const RETRY_EVERY_MS = 20 * 1000;

/** Rows drawn at once in a list; more on request. */
const LIST_PAGE = 60;

/* ─── Phone storage ─────────────────────────────────────────────────── */

const listKey = (id, seesSystem) => `mst:list:${id}:${seesSystem ? "admin" : "staff"}`;
const queueKey = (id) => `mst:queue:${id}`;

function readStored(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked storage: the page still works, it just starts empty next time
  }
}

/** Forget everything kept on this phone for a count (on sign-out). */
function forgetCount(id) {
  writeStored(listKey(id, true), null);
  writeStored(listKey(id, false), null);
}

/* ─── Barcodes, as the server compares them ─────────────────────────── */

/** Dashes go, and a code of digits loses its leading zeros (a UPC-A read as EAN-13). */
function barcodeKey(code) {
  const text = String(code || "").trim().toLowerCase().replace(/-/g, "");
  return /^\d+$/.test(text) ? text.replace(/^0+/, "") || "0" : text;
}

/** The keys a line answers to. A pack's loose-units line carries the pack's code + "-LU". */
function lineKeys(item) {
  return String(item.barcode || "")
    .replace(/-LU$/i, "")
    .split(/[,;\s|]+/)
    .filter(Boolean)
    .map(barcodeKey);
}

const isCounted = (item) => item.countedQty !== null && item.countedQty !== undefined;

/** What a line counts in: "Full packs of 24", "Loose units", or nothing for a plain product. */
function countUnit(item) {
  if (item.countType === "loose-units") return "Loose units";
  if ((item.qtyPerPack || 0) > 1) return `Full packs of ${item.qtyPerPack}`;
  return "";
}

/** "10:42" today, "6 Oct" before. */
function whenText(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function MobileStockTakePage() {
  const router = useRouter();
  const { id } = router.query;

  // Sign-in
  const [token, setToken] = useState(null);
  const [staffName, setStaffName] = useState("");
  const [seesSystem, setSeesSystem] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [staffList, setStaffList] = useState([]);
  const [staffListLoading, setStaffListLoading] = useState(true);
  const [selectedStaff, setSelectedStaff] = useState("");
  const [pin, setPin] = useState("");
  const [countInfo, setCountInfo] = useState(null);
  const submittedPinRef = useRef("");

  // The count, kept on the phone
  const [stockTake, setStockTake] = useState(null);
  const [items, setItems] = useState(null);
  const itemsRef = useRef(null);
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  const versionRef = useRef("");
  const queueRef = useRef({}); // itemId -> { countedQty } | { clear: true }, with `at`
  const [queueSize, setQueueSize] = useState(0);
  const [online, setOnline] = useState(true);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [message, setMessage] = useState(null); // { tone, text }

  // What is on screen
  const [tab, setTab] = useState("count"); // count | counted
  const [activeId, setActiveId] = useState(null);
  const [activeFrom, setActiveFrom] = useState("scan"); // scan | list
  const [choices, setChoices] = useState([]); // ids, when one barcode is on several lines
  const [qty, setQty] = useState("");
  const [findTerm, setFindTerm] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [countedTerm, setCountedTerm] = useState("");
  const [countedWho, setCountedWho] = useState("mine"); // mine | all
  const [diffOnly, setDiffOnly] = useState(false);
  const [countedShown, setCountedShown] = useState(LIST_PAGE);

  // Scanner
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanHint, setScanHint] = useState("");
  const [lastScanned, setLastScanned] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const notFoundRef = useRef({ code: "", at: 0 });
  const qtyInputRef = useRef(null);

  /* ─── Session ─────────────────────────────────────────────────── */

  useEffect(() => {
    const saved = sessionStorage.getItem("mobileStockTakeToken");
    if (saved) {
      setToken(saved);
      setStaffName(sessionStorage.getItem("mobileStockTakeStaff") || "");
      setSeesSystem(sessionStorage.getItem("mobileStockTakeSees") === "1");
    }
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine !== false);
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
      .catch(() => {
        if (!cancelled) setAuthError("No connection. Connect to the internet to sign in.");
      })
      .finally(() => {
        if (!cancelled) setStaffListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router.isReady, id, token]);

  const signOut = useCallback(({ ask = true, keepQueue = false } = {}) => {
    const unsent = Object.keys(queueRef.current || {}).length;
    if (ask && unsent > 0) {
      const leave = window.confirm(
        `${unsent} count${unsent === 1 ? " has" : "s have"} not been sent yet (no connection). Signing out now loses ${unsent === 1 ? "it" : "them"}. Sign out anyway?`
      );
      if (!leave) return;
    }
    // Unsent counts are this counter's. Signing out on purpose drops them; an expired sign-in
    // keeps them on the phone, marked with their name, for when they sign back in.
    queueRef.current = {};
    if (id && !keepQueue) writeStored(queueKey(id), null);
    setQueueSize(0);
    sessionStorage.removeItem("mobileStockTakeToken");
    sessionStorage.removeItem("mobileStockTakeStaff");
    sessionStorage.removeItem("mobileStockTakeSees");
    if (id) forgetCount(id);
    setToken(null);
    setStaffName("");
    setSeesSystem(false);
    setStockTake(null);
    setItems(null);
    versionRef.current = "";
    setActiveId(null);
    setChoices([]);
    setPin("");
    setSelectedStaff("");
    setTab("count");
  }, [id]);

  /** Shared fetch: adds the token and turns a 401 into a sign-out. Network failure throws `offline`. */
  const api = useCallback(
    async (query = "", options = {}) => {
      let res;
      try {
        res = await fetch(`/api/stock-take/mobile/count?id=${id}${query}`, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(options.headers || {}),
          },
        });
      } catch {
        const offline = new Error("No connection");
        offline.offline = true;
        throw offline;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        signOut({ ask: false, keepQueue: true });
        throw new Error("Your session expired. Please sign in again.");
      }
      if (!res.ok) {
        const failure = new Error(data.error || "Request failed");
        failure.closed = Boolean(data.closed);
        throw failure;
      }
      return data;
    },
    [id, token, signOut]
  );

  /* ─── The list on the phone ───────────────────────────────────── */

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const persistQueue = useCallback(() => {
    const entries = queueRef.current;
    writeStored(queueKey(id), Object.keys(entries).length ? { staff: staffName, entries } : null);
    setQueueSize(Object.keys(entries).length);
  }, [id, staffName]);

  /** Counts not sent yet, laid over a list from the server so they are not lost. */
  const withQueued = useCallback((list) => {
    const queued = queueRef.current;
    if (!Object.keys(queued).length) return list;
    return list.map((item) => {
      const entry = queued[item._id];
      if (!entry) return item;
      return entry.clear
        ? { ...item, countedQty: null, status: "pending", countedBy: "", countedAt: null, variance: 0 }
        : {
            ...item,
            countedQty: entry.countedQty,
            status: "counted",
            countedBy: entry.by || item.countedBy,
            countedAt: entry.at,
            ...(item.systemQty !== undefined ? { variance: entry.countedQty - item.systemQty } : {}),
          };
    });
  }, []);

  // Kept in storage a moment after it changes, so a reload opens straight away
  useEffect(() => {
    if (!id || !items || !token) return undefined;
    const timer = setTimeout(() => {
      writeStored(listKey(id, seesSystem), { version: versionRef.current, stockTake, items, savedAt: Date.now() });
    }, 600);
    return () => clearTimeout(timer);
  }, [id, items, stockTake, token, seesSystem]);

  /** Fetch the list; with what the phone already holds, only when something changed. */
  const loadList = useCallback(
    async ({ quiet = false } = {}) => {
      if (!token || !id) return;
      try {
        const since = versionRef.current ? `&since=${encodeURIComponent(versionRef.current)}` : "";
        const data = await api(`&list=1${since}`);
        setOnline(true);
        if (data.unchanged) return;
        versionRef.current = data.version || "";
        setStockTake(data.stockTake);
        // The server decides what a counter may see
        if (typeof data.seesSystemQty === "boolean" && data.seesSystemQty !== seesSystem) {
          setSeesSystem(data.seesSystemQty);
          sessionStorage.setItem("mobileStockTakeSees", data.seesSystemQty ? "1" : "0");
        }
        setItems(withQueued(data.items || []));
        setError("");
      } catch (err) {
        if (err.offline) {
          setOnline(false);
          if (!quiet && !itemsRef.current) setError("No connection, and this count has not been opened on this phone before. Connect to load it.");
          return;
        }
        if (err.closed) setClosed(true);
        if (!quiet) setError(err.message);
      }
    },
    [api, token, id, seesSystem, withQueued]
  );

  /** Send queued counts, all in one go. Anything that fails stays queued. */
  const sendAgainRef = useRef(null);
  const sendQueued = useCallback(async () => {
    if (sendingRef.current || !token || !id) return;
    const entries = Object.entries(queueRef.current);
    if (entries.length === 0) return;
    sendingRef.current = true;
    setSending(true);
    let sent = false;
    try {
      const data = await api("", {
        method: "PUT",
        body: JSON.stringify({
          counts: entries.map(([itemId, entry]) => (entry.clear ? { itemId, clear: true } : { itemId, countedQty: entry.countedQty })),
        }),
      });
      setOnline(true);
      sent = true;
      // Sent: off the queue, unless it was changed again while on its way
      for (const [itemId, entry] of entries) {
        if (queueRef.current[itemId]?.at === entry.at) delete queueRef.current[itemId];
      }
      persistQueue();
      const fromServer = new Map((data.items || []).map((item) => [String(item._id), item]));
      setItems((prev) =>
        (prev || []).map((item) => {
          const saved = fromServer.get(String(item._id));
          return saved && !queueRef.current[item._id] ? { ...item, ...saved } : item;
        })
      );
      if ((data.rejected || []).length > 0) {
        setMessage({ tone: "error", text: `${data.rejected.length} count(s) were not saved: ${data.rejected[0].reason}` });
      }
    } catch (err) {
      if (err.offline) setOnline(false);
      else if (err.closed) {
        setClosed(true);
        setMessage({ tone: "error", text: "This stock take has been closed; counts can no longer be sent." });
      } else setMessage({ tone: "error", text: `Counts not sent yet: ${err.message}` });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
    // Counts made while that one was on its way
    if (sent && Object.keys(queueRef.current).length) setTimeout(() => sendAgainRef.current?.(), 200);
  }, [api, token, id, persistQueue]);
  sendAgainRef.current = sendQueued;

  // On sign-in: what the phone holds first, then the server
  useEffect(() => {
    if (!token || !id) return;
    // Only this counter's own unsent counts: never someone else's, sent under this name
    const stored = readStored(queueKey(id));
    queueRef.current = stored?.staff && stored.staff === staffName ? stored.entries || {} : {};
    setQueueSize(Object.keys(queueRef.current).length);
    const cached = readStored(listKey(id, seesSystem));
    if (cached?.items?.length) {
      versionRef.current = cached.version || "";
      setStockTake(cached.stockTake || null);
      setItems(withQueued(cached.items));
    }
    loadList().then(sendQueued);
  }, [token, id]);

  // Back online: send what is waiting and catch up; now and then: look for others' counts
  useEffect(() => {
    if (!token) return undefined;
    const onOnline = () => {
      setOnline(true);
      sendQueued().then(() => loadList({ quiet: true }));
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const refresh = setInterval(() => {
      if (document.visibilityState === "visible") loadList({ quiet: true });
    }, REFRESH_EVERY_MS);
    const retry = setInterval(() => {
      if (Object.keys(queueRef.current).length) sendQueued();
    }, RETRY_EVERY_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(refresh);
      clearInterval(retry);
    };
  }, [token, sendQueued, loadList]);

  /* ─── Sign-in ─────────────────────────────────────────────────── */

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
        const name = data.staff?.name || selectedStaff;
        sessionStorage.setItem("mobileStockTakeToken", data.token);
        sessionStorage.setItem("mobileStockTakeStaff", name);
        sessionStorage.setItem("mobileStockTakeSees", data.seesSystemQty ? "1" : "0");
        setSeesSystem(Boolean(data.seesSystemQty));
        setStaffName(name);
        setToken(data.token);
      } catch (err) {
        setAuthError(err.message === "Failed to fetch" ? "No connection. Connect to the internet to sign in." : err.message);
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

  /* ─── Derived ─────────────────────────────────────────────────── */

  const byId = useMemo(() => new Map((items || []).map((item) => [String(item._id), item])), [items]);
  const byBarcode = useMemo(() => {
    const index = new Map();
    for (const item of items || []) {
      for (const key of lineKeys(item)) {
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(item);
      }
    }
    return index;
  }, [items]);

  const progress = useMemo(() => {
    const total = (items || []).length;
    const counted = (items || []).filter(isCounted).length;
    return { total, counted, pending: total - counted, pct: total ? Math.round((counted / total) * 100) : 0 };
  }, [items]);

  const activeItem = activeId ? byId.get(String(activeId)) : null;

  const findResults = useMemo(() => {
    const term = findTerm.trim().toLowerCase();
    if (term.length < 2) return [];
    const out = [];
    for (const item of items || []) {
      if (String(item.productName || "").toLowerCase().includes(term) || String(item.barcode || "").toLowerCase().includes(term)) {
        out.push(item);
        if (out.length >= 30) break;
      }
    }
    return out;
  }, [items, findTerm]);

  const countedList = useMemo(() => {
    const term = countedTerm.trim().toLowerCase();
    return (items || [])
      .filter(isCounted)
      .filter((item) => countedWho === "all" || item.countedBy === staffName)
      .filter((item) => !diffOnly || Number(item.variance || 0) !== 0)
      .filter((item) => !term || String(item.productName || "").toLowerCase().includes(term) || String(item.barcode || "").toLowerCase().includes(term))
      .sort((a, b) => new Date(b.countedAt || 0) - new Date(a.countedAt || 0));
  }, [items, countedTerm, countedWho, diffOnly, staffName]);

  const myCount = useMemo(() => (items || []).filter((item) => isCounted(item) && item.countedBy === staffName).length, [items, staffName]);

  /* ─── Counting ────────────────────────────────────────────────── */

  const openItem = useCallback((item, from = "scan") => {
    setChoices([]);
    setActiveId(String(item._id));
    setActiveFrom(from);
    setQty(isCounted(item) ? String(item.countedQty) : "");
    setFindOpen(false);
    setFindTerm("");
    setTimeout(() => {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }, 120);
  }, []);

  /** Look a scanned code up on the phone; ask the server only when the phone does not know it. */
  const lookupBarcode = useCallback(
    async (barcode) => {
      setLastScanned(barcode);
      if (notFoundRef.current.code === barcode && Date.now() - notFoundRef.current.at < NOT_FOUND_MEMORY_MS) {
        setScanHint(`Not on this count: ${barcode}`);
        return;
      }

      let matches = byBarcode.get(barcodeKey(barcode)) || [];
      if (matches.length === 0 && online) {
        // A barcode added to the product after the count was made is known to the server only
        setLookingUp(true);
        try {
          const data = await api(`&barcode=${encodeURIComponent(barcode)}`);
          if (data.found) matches = (data.items || []).map((line) => byId.get(String(line._id)) || line);
        } catch (err) {
          if (err.offline) setOnline(false);
        } finally {
          setLookingUp(false);
        }
      }

      if (matches.length === 0) {
        notFoundRef.current = { code: barcode, at: Date.now() };
        setActiveId(null);
        setChoices([]);
        setScanHint(`Not on this count: ${barcode}`);
        setMessage({ tone: "error", text: `Nothing on this count carries barcode ${barcode}. Use Find by name instead.` });
        return;
      }

      setScanHint("");
      setScannerOpen(false);
      setTab("count");
      if (matches.length === 1) openItem(matches[0], "scan");
      else {
        // One barcode, several lines: full packs and loose units
        setActiveId(null);
        setChoices(matches.map((item) => String(item._id)));
      }
    },
    [byBarcode, byId, online, api, openItem]
  );

  /** Put a count (or a clearing) on the line at once, queue it, and send it. */
  const queueCount = (itemId, entry) => {
    const at = new Date().toISOString();
    queueRef.current = { ...queueRef.current, [itemId]: { ...entry, at, by: staffName } };
    persistQueue();
    setItems((prev) => withQueued(prev || []));
    sendQueued();
  };

  const adjustQty = (delta) => {
    const base = Number(qty);
    setQty(String(Math.max(0, (Number.isFinite(base) ? base : 0) + delta)));
  };

  const saveActive = () => {
    if (!activeItem) return;
    const value = Number(qty);
    if (qty === "" || !Number.isFinite(value) || value < 0) {
      setMessage({ tone: "error", text: "Enter a quantity of zero or more." });
      return;
    }
    const name = activeItem.productName;
    const wasCounted = isCounted(activeItem);
    queueCount(String(activeItem._id), { countedQty: value });
    setMessage({ tone: "success", text: `${name} ${wasCounted ? "changed to" : "saved as"} ${value}${online ? "" : " (sends when back online)"}` });
    setActiveId(null);
    setQty("");
    try {
      navigator.vibrate?.(40);
    } catch {}
    // Counting down a shelf: straight back to the camera. Correcting from the list: back to it.
    if (activeFrom === "scan") {
      setScanHint(`Saved ${name} as ${value}`);
      setScannerOpen(true);
    }
  };

  const clearActive = () => {
    if (!activeItem) return;
    queueCount(String(activeItem._id), { clear: true });
    setMessage({ tone: "success", text: `${activeItem.productName}: count taken off; it is waiting to be counted again` });
    setActiveId(null);
    setQty("");
  };

  const cancelActive = () => {
    setActiveId(null);
    setChoices([]);
    setQty("");
  };

  /* ─── Sign-in screen ──────────────────────────────────────────── */

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
              {countInfo ? `${countInfo.reference} · ${countInfo.locationName}` : "Select your name and enter your 4-digit PIN"}
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
                <p className="mst-login__hint">No staff are available for this count. Check the link, or ask an administrator.</p>
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

  if (!items) {
    return (
      <>
        <Head>
          <title>Loading Stock Take…</title>
        </Head>
        <div className="mst-page">
          {error ? (
            <div className="mst-error-page">
              <h2>Unable to load stock take</h2>
              <p>{error}</p>
              <div className="mst-error-page__actions">
                <button onClick={() => loadList()}>Retry</button>
                <button onClick={() => signOut()} className="is-ghost">Sign out</button>
              </div>
            </div>
          ) : (
            <div className="mst-loading">Loading the count list…</div>
          )}
        </div>
        <MobileStockTakeStyles />
      </>
    );
  }

  const variance =
    seesSystem && activeItem && qty !== "" && Number.isFinite(Number(qty)) ? Number(qty) - Number(activeItem.systemQty || 0) : null;
  const visibleCounted = countedList.slice(0, countedShown);

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
            <p>
              {stockTake?.locationName} · {staffName}
            </p>
          </div>
          <button onClick={() => signOut()} className="mst-signout" aria-label="Sign out">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 3v9M6.3 7.3a8 8 0 1 0 11.4 0" />
            </svg>
          </button>
        </header>

        <div className="mst-progress">
          <div className="mst-progress__bar" style={{ width: `${progress.pct}%` }} />
        </div>

        <div className="mst-stats">
          <div><strong>{progress.total}</strong><span>Total</span></div>
          <div><strong>{progress.counted}</strong><span>Counted</span></div>
          <div><strong>{progress.pending}</strong><span>Left</span></div>
          <div><strong>{progress.pct}%</strong><span>Done</span></div>
        </div>

        {/* Connection and the queue of counts not sent yet */}
        {(closed || !online || queueSize > 0) && (
          <div className={`mst-sync ${closed ? "is-closed" : !online ? "is-offline" : ""}`}>
            {closed
              ? "This stock take has been closed. Counts can no longer be changed."
              : !online
                ? `No connection. Keep counting: ${queueSize ? `${queueSize} count${queueSize === 1 ? "" : "s"} will send` : "counts will send"} when the phone is back online.`
                : sending
                  ? `Sending ${queueSize} count${queueSize === 1 ? "" : "s"}…`
                  : `${queueSize} count${queueSize === 1 ? "" : "s"} waiting to send.`}
            {online && !closed && queueSize > 0 && !sending && (
              <button onClick={sendQueued}>Send now</button>
            )}
          </div>
        )}

        {message && (
          <div className={`mst-message mst-message--${message.tone}`}>
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)} aria-label="Dismiss">×</button>
          </div>
        )}

        <div className="mst-tabs" role="tablist">
          <button role="tab" aria-selected={tab === "count"} className={tab === "count" ? "is-active" : ""} onClick={() => setTab("count")}>
            Count
          </button>
          <button role="tab" aria-selected={tab === "counted"} className={tab === "counted" ? "is-active" : ""} onClick={() => { setTab("counted"); setCountedShown(LIST_PAGE); }}>
            Counted ({progress.counted})
          </button>
        </div>

        <div className="mst-body">
          {activeItem ? (
            /* ── The line being counted ── */
            <div className="mst-card">
              <p className="mst-card__label">{isCounted(activeItem) ? "Correcting" : "Counting"}</p>
              <h2 className="mst-card__name">{activeItem.productName}</h2>
              <div className="mst-card__meta">
                {activeItem.barcode && <span className="mst-chip is-mono">{activeItem.barcode.replace(/-LU$/i, "")}</span>}
                {countUnit(activeItem) && <span className="mst-chip is-warn">{countUnit(activeItem)}</span>}
                {seesSystem && <span className="mst-chip">System {activeItem.systemQty}</span>}
                {isCounted(activeItem) && (
                  <span className="mst-chip is-ok">
                    Counted {activeItem.countedQty}
                    {activeItem.countedBy ? ` by ${activeItem.countedBy}` : ""}
                  </span>
                )}
              </div>

              <label className="mst-qty-label" htmlFor="mst-qty">
                {activeItem.countType === "loose-units" ? "Single units counted" : (activeItem.qtyPerPack || 0) > 1 ? "Full packs counted" : "Counted quantity"}
              </label>
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
                      saveActive();
                    }
                  }}
                  placeholder="0"
                />
                <button type="button" onClick={() => adjustQty(1)} aria-label="Increase">+</button>
              </div>

              {variance !== null && (
                <p className={`mst-variance ${variance === 0 ? "" : variance > 0 ? "is-up" : "is-down"}`}>
                  {variance === 0 ? "Matches the system count" : `${variance > 0 ? "+" : ""}${variance} against system`}
                </p>
              )}

              <div className="mst-card__actions">
                <button onClick={cancelActive} className="mst-btn is-ghost">Cancel</button>
                <button onClick={saveActive} className="mst-btn is-primary" disabled={closed}>
                  {activeFrom === "scan" ? "Save & scan next" : "Save"}
                </button>
              </div>
              {isCounted(activeItem) && (
                <button onClick={clearActive} className="mst-btn is-danger mst-full" disabled={closed}>
                  Take this count off
                </button>
              )}
            </div>
          ) : choices.length > 0 ? (
            /* ── One barcode, several lines ── */
            <div className="mst-card">
              <p className="mst-card__label">This barcode is on two lines</p>
              <h2 className="mst-card__name">{byId.get(choices[0])?.productName?.replace(/\s*\(Loose Units\)$/i, "")}</h2>
              <p className="mst-choice-hint">Which are you counting?</p>
              <div className="mst-choices">
                {choices.map((choiceId) => {
                  const item = byId.get(choiceId);
                  if (!item) return null;
                  return (
                    <button key={choiceId} onClick={() => openItem(item, "scan")} className="mst-choice">
                      <span className="mst-choice__type">{countUnit(item) || "Standard"}</span>
                      <span className="mst-choice__qty">{isCounted(item) ? `Counted ${item.countedQty}` : "Not counted"}</span>
                    </button>
                  );
                })}
              </div>
              <button onClick={cancelActive} className="mst-btn is-ghost mst-full">Cancel</button>
            </div>
          ) : tab === "count" ? (
            findOpen ? (
              /* ── Find by name, on the phone's own list ── */
              <div className="mst-card">
                <p className="mst-card__label">Find by name or barcode</p>
                <input
                  type="text"
                  className="mst-search"
                  value={findTerm}
                  onChange={(e) => setFindTerm(e.target.value)}
                  placeholder="Type at least 2 characters"
                  autoFocus
                />
                <div className="mst-results">
                  {findTerm.trim().length >= 2 && findResults.length === 0 && <p className="mst-results__note">Nothing on this count matches.</p>}
                  {findResults.map((item) => (
                    <button key={item._id} onClick={() => openItem(item, "list")} className="mst-result">
                      <span className="mst-result__name">{item.productName}</span>
                      <span className="mst-result__meta">
                        {countUnit(item) ? `${countUnit(item)} · ` : ""}
                        {isCounted(item) ? `Counted ${item.countedQty}` : "Not counted"}
                        {seesSystem ? ` · System ${item.systemQty}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => {
                    setFindOpen(false);
                    setFindTerm("");
                  }}
                  className="mst-btn is-ghost mst-full"
                >
                  Back to scanning
                </button>
              </div>
            ) : (
              /* ── Scan next ── */
              <div className="mst-idle">
                <button
                  className="mst-scan-cta"
                  onClick={() => {
                    setScanHint("");
                    setScannerOpen(true);
                  }}
                  disabled={closed}
                >
                  <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
                    <path d="M7 8v8M10 8v8M13 8v8M16 8v8" />
                  </svg>
                  <span>Scan a product</span>
                </button>
                <p className="mst-idle__hint">Scan one product, enter the quantity, save. Then scan the next. You have counted {myCount}.</p>
                <button onClick={() => setFindOpen(true)} className="mst-btn is-ghost mst-full">
                  No barcode? Find by name
                </button>
              </div>
            )
          ) : (
            /* ── What has been counted: find, check, correct ── */
            <div className="mst-counted">
              <input
                type="search"
                className="mst-search"
                value={countedTerm}
                onChange={(e) => {
                  setCountedTerm(e.target.value);
                  setCountedShown(LIST_PAGE);
                }}
                placeholder="Search counted products"
              />
              <div className="mst-filters">
                <button className={countedWho === "mine" ? "is-on" : ""} onClick={() => { setCountedWho("mine"); setCountedShown(LIST_PAGE); }}>
                  Mine ({myCount})
                </button>
                <button className={countedWho === "all" ? "is-on" : ""} onClick={() => { setCountedWho("all"); setCountedShown(LIST_PAGE); }}>
                  Everyone ({progress.counted})
                </button>
                {seesSystem && (
                  <button className={diffOnly ? "is-on" : ""} onClick={() => { setDiffOnly((v) => !v); setCountedShown(LIST_PAGE); }}>
                    Different from system
                  </button>
                )}
              </div>
              {countedList.length === 0 ? (
                <p className="mst-results__note">
                  {countedTerm || diffOnly ? "Nothing counted matches." : countedWho === "mine" ? "You have not counted anything yet." : "Nothing counted yet."}
                </p>
              ) : (
                <div className="mst-rows">
                  {visibleCounted.map((item) => (
                    <button key={item._id} className="mst-row" onClick={() => openItem(item, "list")}>
                      <span className="mst-row__main">
                        <span className="mst-row__name">{item.productName}</span>
                        <span className="mst-row__meta">
                          {countUnit(item) ? `${countUnit(item)} · ` : ""}
                          {item.countedBy || "—"} · {whenText(item.countedAt)}
                          {queueRef.current[item._id] ? " · not sent yet" : ""}
                        </span>
                      </span>
                      <span className="mst-row__qty">
                        {item.countedQty}
                        {seesSystem && Number(item.variance || 0) !== 0 && (
                          <em className={item.variance > 0 ? "is-up" : "is-down"}>{item.variance > 0 ? `+${item.variance}` : item.variance}</em>
                        )}
                      </span>
                    </button>
                  ))}
                  {countedList.length > countedShown && (
                    <button className="mst-btn is-ghost mst-full" onClick={() => setCountedShown((n) => n + LIST_PAGE)}>
                      Show more ({countedList.length - countedShown} left)
                    </button>
                  )}
                </div>
              )}
              <p className="mst-idle__hint">Tap a product to correct its count, or to take the count off.</p>
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
            busy={lookingUp}
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
        background: #fff; color: #64748b; cursor: pointer; flex-shrink: 0;
        display: grid; place-items: center;
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

      .mst-sync {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        padding: 9px 16px; font-size: 12.5px; font-weight: 600;
        background: #eff6ff; color: #1e40af; border-bottom: 1px solid #dbeafe;
      }
      .mst-sync.is-offline { background: #fffbeb; color: #92400e; border-color: #fde68a; }
      .mst-sync.is-closed { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
      .mst-sync button {
        border: 1px solid currentColor; background: transparent; color: inherit;
        border-radius: 8px; padding: 4px 10px; font-size: 12px; font-weight: 700; flex-shrink: 0;
      }

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

      .mst-tabs { display: flex; border-bottom: 1px solid var(--mst-line); }
      .mst-tabs button {
        flex: 1; height: 44px; border: 0; background: #fff; color: var(--mst-muted);
        font-size: 14px; font-weight: 700; border-bottom: 3px solid transparent; cursor: pointer;
      }
      .mst-tabs button.is-active { color: var(--mst-accent); border-bottom-color: var(--mst-accent); }

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
      .mst-idle__hint { color: var(--mst-muted); font-size: 13px; margin: 14px 0 16px; line-height: 1.5; text-align: center; }

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
      .mst-btn.is-danger { background: #fff; color: #b91c1c; border: 1.5px solid #fecaca; height: 46px; font-size: 14px; }
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
        width: 100%; height: 50px; border: 1.5px solid #cbd5e1; border-radius: 12px;
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

      /* ── Counted list ────────────────────────────────────── */

      .mst-filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
      .mst-filters button {
        height: 34px; padding: 0 12px; border-radius: 999px; font-size: 12.5px; font-weight: 700;
        border: 1.5px solid var(--mst-line); background: #fff; color: #475569; cursor: pointer;
      }
      .mst-filters button.is-on { background: var(--mst-accent); border-color: var(--mst-accent); color: #fff; }
      .mst-rows { display: flex; flex-direction: column; }
      .mst-row {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 11px 2px; border: 0; border-bottom: 1px solid #f1f5f9;
        background: #fff; text-align: left; cursor: pointer; width: 100%;
      }
      .mst-row:active { background: var(--mst-accent-soft); }
      .mst-row__main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
      .mst-row__name { font-size: 14px; font-weight: 700; color: #1e293b; line-height: 1.3; }
      .mst-row__meta { font-size: 11.5px; color: var(--mst-muted); }
      .mst-row__qty { font-size: 17px; font-weight: 800; flex-shrink: 0; }
      .mst-row__qty em {
        font-style: normal; font-size: 11.5px; font-weight: 700; margin-left: 6px;
        padding: 2px 6px; border-radius: 5px;
      }
      .mst-row__qty em.is-up { background: #dcfce7; color: #15803d; }
      .mst-row__qty em.is-down { background: #fee2e2; color: #b91c1c; }
    `}</style>
  );
}
