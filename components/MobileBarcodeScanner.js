/**
 * Camera barcode scanner for the mobile stock take.
 *
 * Built for cheap phones on shop-floor signal:
 *
 * - Only the part of the picture inside the guide box is read, scaled down to at most
 *   CROP_MAX_WIDTH pixels wide. Reading the whole 1280x720 frame with ZXing's "try harder" took
 *   most of a second a frame on a low-end phone, so the screen looked like it was scanning while
 *   it never finished a read.
 * - The phone's own barcode reader (BarcodeDetector) is used where there is one. Some phones have
 *   it but it never reads anything (no Google Play services, a missing module), so when it has
 *   read nothing for a few seconds ZXing is loaded as well and takes every few frames.
 * - Decoding starts as soon as the camera gives frames. It used to wait for video.play(), which
 *   some phones never settle, and the reading never began.
 * - Continuous autofocus is switched on where the camera offers it: many Android cameras open on a
 *   fixed focus, and a barcode held close stays blurred. A zoom button lets the phone be held
 *   further back, inside the distance it can focus at.
 * - While the page looks a code up, reading pauses and the screen says so.
 * - The camera stops when the phone is locked or the tab hidden, and starts again on return.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const NATIVE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar"];

/** How often to attempt a read, in milliseconds. */
const DECODE_INTERVAL_MS = 150;

/** The same code must be read this many times before it counts. */
const CONFIRMATIONS = 2;

/** Ignore a repeat of the code just taken for this long. */
const REPEAT_LOCKOUT_MS = 2500;

/** Widest the cropped picture handed to ZXing, in pixels. */
const CROP_MAX_WIDTH = 720;

/** With the phone's own reader, load ZXing as well if nothing is read for this long. */
const NATIVE_GRACE_MS = 3000;

/** Offer a "tap to start" if the camera has given no picture after this long. */
const STALL_MS = 4000;

function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {}
  });
}

function Icon({ name }) {
  const paths = {
    torch: "M9 2h6l-1 7h3l-7 13 1-9H7z",
    close: "M6 6l12 12M18 6L6 18",
  };
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

export default function MobileBarcodeScanner({
  onScan,
  onClose,
  title = "Scan a product",
  hint = "",
  lastResult = "",
  busy = false,
}) {
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const lastCodeRef = useRef({ value: "", count: 0, acceptedAt: 0 });

  // The camera must not restart just because the page rebuilt its handler.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const [manualBarcode, setManualBarcode] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [engine, setEngine] = useState("");
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [restartKey, setRestartKey] = useState(0);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [zoom, setZoom] = useState(null); // { min, max, value } when the camera can zoom
  const [stalled, setStalled] = useState(false);
  const [status, setStatus] = useState("Starting camera…");
  const [flash, setFlash] = useState(false);

  /**
   * Take a read only after seeing it twice, and never twice in quick succession, so one barcode
   * does not register as several scans.
   */
  const accept = useCallback((raw) => {
    const value = String(raw || "").trim();
    if (!value) return;

    const now = Date.now();
    const state = lastCodeRef.current;

    if (state.value === value && now - state.acceptedAt < REPEAT_LOCKOUT_MS) return;

    if (state.value !== value) {
      lastCodeRef.current = { value, count: 1, acceptedAt: 0 };
      return;
    }

    state.count += 1;
    if (state.count < CONFIRMATIONS) return;

    lastCodeRef.current = { value, count: 0, acceptedAt: now };

    try {
      navigator.vibrate?.(60);
    } catch {}

    setFlash(true);
    setTimeout(() => setFlash(false), 220);
    setStatus(`Read ${value}`);

    onScanRef.current?.(value);
  }, []);

  /* ─── Camera lifecycle ────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;
    let running = false;
    let detector = null; // the phone's own reader
    let zxing = null; // { reader, hints, lib } once loaded
    let zxingLoading = false;
    let tick = 0;
    let lastNativeHit = 0;
    let startedAt = 0;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    const frameReady = () => {
      const video = videoRef.current;
      return Boolean(video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0);
    };

    /** Load ZXing (only when needed: phones with a working reader of their own never download it). */
    async function loadZxing() {
      if (zxing || zxingLoading) return;
      zxingLoading = true;
      try {
        const lib = await import("@zxing/library");
        if (cancelled) return;
        const hints = new Map();
        hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [
          lib.BarcodeFormat.EAN_13,
          lib.BarcodeFormat.EAN_8,
          lib.BarcodeFormat.UPC_A,
          lib.BarcodeFormat.UPC_E,
          lib.BarcodeFormat.CODE_128,
          lib.BarcodeFormat.CODE_39,
          lib.BarcodeFormat.CODE_93,
          lib.BarcodeFormat.ITF,
          lib.BarcodeFormat.CODABAR,
        ]);
        zxing = { lib, hints, reader: new lib.MultiFormatOneDReader(hints) };
        setEngine(detector ? "Fast scan + standard" : "Standard scan");
      } catch {
        // Offline before it ever loaded: the phone's reader (if any) and typing still work
      } finally {
        zxingLoading = false;
      }
    }

    /** The guide box's part of the frame, scaled down, on the shared canvas. */
    function cropFrame() {
      const video = videoRef.current;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const stage = stageRef.current;
      const sw = stage?.clientWidth || vw;
      const sh = stage?.clientHeight || vh;
      // The video fills the stage (object-fit: cover): screen pixels per video pixel
      const scale = Math.max(sw / vw, sh / vh);
      // The guide box is min(80vw, 310px) by 175px; leave room around it for an imperfect aim
      const cropW = Math.min(vw, (Math.min(sw * 0.8, 310) * 1.3) / scale);
      const cropH = Math.min(vh, (175 * 1.7) / scale);
      const ratio = Math.min(1, CROP_MAX_WIDTH / cropW);
      const outW = Math.max(1, Math.round(cropW * ratio));
      const outH = Math.max(1, Math.round(cropH * ratio));
      if (canvas.width !== outW) canvas.width = outW;
      if (canvas.height !== outH) canvas.height = outH;
      context.drawImage(video, (vw - cropW) / 2, (vh - cropH) / 2, cropW, cropH, 0, 0, outW, outH);
      return canvas;
    }

    function readWithZxing() {
      const { lib, reader, hints } = zxing;
      const source = new lib.HTMLCanvasElementLuminanceSource(cropFrame());
      // Two ways of telling black from white, in turn: one copes with uneven light, the other
      // with faint print
      const binarizer = tick % 2 ? new lib.GlobalHistogramBinarizer(source) : new lib.HybridBinarizer(source);
      let bitmap = new lib.BinaryBitmap(binarizer);
      // Now and then, try the picture turned a quarter, for a barcode held upright
      if (tick % 5 === 4) bitmap = bitmap.rotateCounterClockwise();
      try {
        return reader.decode(bitmap, hints).getText();
      } catch {
        return null; // nothing in this frame: the usual case
      } finally {
        reader.reset();
      }
    }

    async function loop() {
      if (!running || cancelled) return;
      tick += 1;

      if (!frameReady()) {
        if (startedAt && Date.now() - startedAt > STALL_MS) setStalled(true);
      } else if (!busyRef.current) {
        setStalled(false);
        let value = null;
        if (detector) {
          try {
            const found = await detector.detect(videoRef.current);
            value = found?.[0]?.rawValue || null;
            if (value) lastNativeHit = Date.now();
          } catch {}
          // The phone's reader has read nothing for a while: bring in ZXing as well
          if (!value && !zxing && Date.now() - Math.max(lastNativeHit, startedAt) > NATIVE_GRACE_MS) loadZxing();
        }
        // Alongside a reader that works, ZXing only looks now and then (formats the phone lacks)
        if (!value && zxing && (!detector || tick % (lastNativeHit ? 6 : 3) === 0)) value = readWithZxing();
        if (value) accept(value);
      }

      if (running && !cancelled) timerRef.current = setTimeout(loop, DECODE_INTERVAL_MS);
    }

    async function chooseReader() {
      if ("BarcodeDetector" in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats?.();
          const formats = supported ? NATIVE_FORMATS.filter((f) => supported.includes(f)) : NATIVE_FORMATS;
          if (formats.length > 0) {
            detector = new window.BarcodeDetector({ formats });
            setEngine("Fast scan");
            return;
          }
        } catch {
          // Present but unusable: ZXing does the reading
        }
      }
      await loadZxing();
    }

    async function start() {
      setStatus("Starting camera…");
      setStalled(false);
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("This browser cannot open a camera. Type the barcode below instead.");
        return;
      }
      if (!window.isSecureContext) {
        setCameraError("The camera only works over HTTPS. Open this page on its https:// address, then try again.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        setCameraError("");

        // Device labels only fill in once permission is given. This fills the picker without
        // setting deviceId, which would restart the camera just opened.
        navigator.mediaDevices
          .enumerateDevices()
          .then((all) => {
            if (!cancelled) setDevices(all.filter((d) => d.kind === "videoinput"));
          })
          .catch(() => {});

        const track = stream.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() || {};
        setTorchAvailable(Boolean(caps.torch));
        setTorchOn(false);
        if (Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
          track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
        }
        setZoom(caps.zoom && caps.zoom.max > caps.zoom.min ? { min: caps.zoom.min, max: caps.zoom.max, value: caps.zoom.min } : null);
        // Android stops the camera when another app takes it; start again rather than freeze
        track?.addEventListener?.("ended", () => {
          if (!cancelled) setRestartKey((k) => k + 1);
        });

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute("playsinline", "true");
          video.muted = true;
          // Not awaited: on some phones this never settles. The loop waits for frames instead.
          video.play()?.catch?.(() => {});
        }

        running = true;
        startedAt = Date.now();
        await chooseReader();
        if (cancelled) return;
        setStatus("Point the camera at a barcode");
        loop();
      } catch (err) {
        if (cancelled) return;
        const name = err?.name || "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setCameraError("Camera permission was refused. Allow camera access for this site in your browser settings, then reopen the scanner.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setCameraError("No usable camera was found on this device. Type the barcode below instead.");
        } else if (name === "NotReadableError" || name === "TrackStartError") {
          setCameraError("The camera is in use by another app. Close it and try again.");
        } else {
          setCameraError(`Could not start the camera: ${err?.message || name || "unknown error"}`);
        }
      }
    }

    // Free the camera while the phone is locked or the tab is hidden; start again on return
    let pausedByHide = false;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        pausedByHide = running;
        running = false;
        if (timerRef.current) clearTimeout(timerRef.current);
        stopStream(streamRef.current);
        streamRef.current = null;
      } else if (pausedByHide && !cancelled) {
        pausedByHide = false;
        setRestartKey((k) => k + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    start();

    return () => {
      cancelled = true;
      running = false;
      document.removeEventListener("visibilitychange", onVisibility);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      stopStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [deviceId, restartKey, accept]);

  /* ─── Controls ────────────────────────────────────────────────── */

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn((v) => !v);
    } catch {
      setTorchAvailable(false);
    }
  };

  /** 1x and 2x (or the most the camera has): hold the phone back, inside its focus distance. */
  const toggleZoom = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track || !zoom) return;
    const near = Math.min(zoom.max, Math.max(zoom.min, 2));
    const next = zoom.value > zoom.min ? zoom.min : near;
    try {
      await track.applyConstraints({ advanced: [{ zoom: next }] });
      setZoom({ ...zoom, value: next });
    } catch {
      setZoom(null);
    }
  };

  /** A tap on the picture asks the camera to focus again, where it can be told to. */
  const refocus = () => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    const modes = track?.getCapabilities?.().focusMode || [];
    if (!track || !modes.includes("single-shot")) return;
    track
      .applyConstraints({ advanced: [{ focusMode: "single-shot" }] })
      .then(() => (modes.includes("continuous") ? track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }) : null))
      .catch(() => {});
  };

  /** Some browsers only show the picture after a tap. */
  const startPicture = () => {
    videoRef.current?.play()?.catch?.(() => {});
    setStalled(false);
  };

  const handleClose = () => {
    stopStream(streamRef.current);
    onClose();
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    const value = manualBarcode.trim();
    if (!value) return;
    setManualBarcode("");
    // Typed entry is deliberate, so it skips the confirm-twice rule.
    lastCodeRef.current = { value: "", count: 0, acceptedAt: 0 };
    onScanRef.current?.(value);
  };

  const headerText = cameraError
    ? "Camera unavailable"
    : busy
      ? "Checking the code…"
      : `${status}${engine ? ` · ${engine}` : ""}`;

  return (
    <div className="mbs">
      <div className="mbs__header">
        <div className="mbs__header-text">
          <h2>{title}</h2>
          <p>{headerText}</p>
        </div>
        <div className="mbs__header-actions">
          {zoom && (
            <button onClick={toggleZoom} className={`mbs__icon-btn mbs__zoom ${zoom.value > zoom.min ? "is-on" : ""}`} aria-label="Zoom">
              {zoom.value > zoom.min ? `${Math.round(zoom.value * 10) / 10}×` : "1×"}
            </button>
          )}
          {torchAvailable && (
            <button onClick={toggleTorch} className={`mbs__icon-btn ${torchOn ? "is-on" : ""}`} aria-label={torchOn ? "Turn torch off" : "Turn torch on"}>
              <Icon name="torch" />
            </button>
          )}
          <button onClick={handleClose} className="mbs__icon-btn" aria-label="Close scanner">
            <Icon name="close" />
          </button>
        </div>
      </div>

      {cameraError ? (
        <div className="mbs__error">
          <p>{cameraError}</p>
        </div>
      ) : (
        <div className="mbs__stage" ref={stageRef} onClick={refocus}>
          <video ref={videoRef} className="mbs__video" playsInline muted autoPlay />
          <div className={`mbs__frame ${flash ? "is-hit" : ""} ${busy ? "is-busy" : ""}`}>
            <span className="mbs__corner mbs__corner--tl" />
            <span className="mbs__corner mbs__corner--tr" />
            <span className="mbs__corner mbs__corner--bl" />
            <span className="mbs__corner mbs__corner--br" />
            {!busy && <span className="mbs__laser" />}
          </div>
          {busy ? (
            <div className="mbs__hint">Checking {lastResult}…</div>
          ) : (
            hint && <div className="mbs__hint">{hint}</div>
          )}
          {stalled && (
            <button className="mbs__start" onClick={startPicture}>
              Tap to start the camera
            </button>
          )}
          {lastResult && !busy && <div className="mbs__last">Last: {lastResult}</div>}
        </div>
      )}

      <div className="mbs__footer">
        {devices.length > 1 && !cameraError && (
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="mbs__select" aria-label="Choose camera">
            <option value="">Default camera (rear)</option>
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        )}
        <form onSubmit={handleManualSubmit} className="mbs__manual">
          <input
            type="text"
            inputMode="numeric"
            value={manualBarcode}
            onChange={(e) => setManualBarcode(e.target.value)}
            placeholder="Or type the barcode"
            autoFocus={!!cameraError}
          />
          <button type="submit" disabled={busy}>
            Find
          </button>
        </form>
      </div>

      <style jsx>{`
        .mbs {
          position: fixed;
          inset: 0;
          z-index: 60;
          background: #000;
          display: flex;
          flex-direction: column;
        }
        .mbs__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          color: #fff;
          background: #111;
        }
        .mbs__header-text {
          min-width: 0;
        }
        .mbs__header h2 {
          font-size: 16px;
          font-weight: 700;
          margin: 0;
        }
        .mbs__header p {
          font-size: 11.5px;
          opacity: 0.75;
          margin: 2px 0 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .mbs__header-actions {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }
        .mbs__icon-btn {
          border: 0;
          background: rgba(255, 255, 255, 0.18);
          color: #fff;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          cursor: pointer;
          display: grid;
          place-items: center;
        }
        .mbs__zoom {
          font-size: 13px;
          font-weight: 700;
        }
        .mbs__icon-btn.is-on {
          background: rgba(250, 204, 21, 0.4);
        }
        .mbs__stage {
          position: relative;
          flex: 1;
          overflow: hidden;
        }
        .mbs__video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .mbs__frame {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: min(80vw, 310px);
          height: 175px;
          box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.45);
          border-radius: 12px;
        }
        .mbs__frame.is-hit {
          box-shadow: 0 0 0 100vmax rgba(22, 163, 74, 0.45);
        }
        .mbs__corner {
          position: absolute;
          width: 28px;
          height: 28px;
          border: 3px solid #22d3ee;
        }
        .mbs__frame.is-hit .mbs__corner {
          border-color: #4ade80;
        }
        .mbs__frame.is-busy .mbs__corner {
          border-color: #facc15;
        }
        .mbs__corner--tl {
          top: -2px;
          left: -2px;
          border-right: 0;
          border-bottom: 0;
          border-top-left-radius: 10px;
        }
        .mbs__corner--tr {
          top: -2px;
          right: -2px;
          border-left: 0;
          border-bottom: 0;
          border-top-right-radius: 10px;
        }
        .mbs__corner--bl {
          bottom: -2px;
          left: -2px;
          border-right: 0;
          border-top: 0;
          border-bottom-left-radius: 10px;
        }
        .mbs__corner--br {
          bottom: -2px;
          right: -2px;
          border-left: 0;
          border-top: 0;
          border-bottom-right-radius: 10px;
        }
        .mbs__laser {
          position: absolute;
          left: 8px;
          right: 8px;
          top: 50%;
          height: 2px;
          background: #22d3ee;
          opacity: 0.85;
        }
        .mbs__hint,
        .mbs__last {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.72);
          color: #fff;
          font-size: 12.5px;
          padding: 7px 14px;
          border-radius: 999px;
          max-width: 90%;
          text-align: center;
        }
        .mbs__hint {
          top: 16px;
        }
        .mbs__last {
          bottom: 18px;
          font-family: monospace;
        }
        .mbs__start {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          border: 0;
          border-radius: 12px;
          background: #2563eb;
          color: #fff;
          font-size: 15px;
          font-weight: 700;
          padding: 14px 20px;
        }
        .mbs__error {
          flex: 1;
          display: grid;
          place-items: center;
          padding: 28px;
          text-align: center;
          color: #e5e7eb;
          font-size: 14px;
          line-height: 1.6;
        }
        .mbs__footer {
          padding: 12px 14px calc(12px + env(safe-area-inset-bottom));
          background: #111;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .mbs__select {
          width: 100%;
          height: 44px;
          border: 1px solid #374151;
          border-radius: 10px;
          background: #1f2937;
          color: #fff;
          padding: 0 12px;
          font-size: 14px;
        }
        .mbs__manual {
          display: flex;
          gap: 8px;
        }
        .mbs__manual input {
          flex: 1;
          min-width: 0;
          height: 48px;
          border: 1px solid #374151;
          border-radius: 10px;
          background: #1f2937;
          color: #fff;
          padding: 0 14px;
          font-size: 16px;
        }
        .mbs__manual button {
          height: 48px;
          padding: 0 22px;
          border: 0;
          border-radius: 10px;
          background: #2563eb;
          color: #fff;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
        }
        .mbs__manual button:disabled {
          opacity: 0.6;
        }
      `}</style>
    </div>
  );
}
