/**
 * Camera barcode scanner for the mobile stock take.
 *
 * Three things kept this from working before:
 *
 * 1. The camera effect depended on the `onScan` callback. That callback was
 *    rebuilt on the page whenever the stock take data changed, so every save or
 *    refresh tore the camera down and started it again. `onScan` now lives in a
 *    ref, and the effect depends only on the selected camera.
 * 2. The ZXing path handed the stream to `decodeFromStream`, which resets the
 *    reader and re-attaches a video element that was already playing. Its
 *    internal "wait for the video to load" promise then never resolved, so the
 *    decode loop never started. The loop is owned here now and calls
 *    `reader.decode(video)` directly.
 * 3. ZXing caches its capture canvas at whatever size the video reports on the
 *    first decode. Called before metadata arrives, that canvas is locked at
 *    0x0 and nothing ever decodes. Decoding now waits for real dimensions and
 *    resets the reader if the dimensions change.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const NATIVE_FORMATS = ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf", "codabar"];

/** How often to attempt a decode, in milliseconds. */
const DECODE_INTERVAL_MS = 120;

/** The same code must be read this many times before it counts. */
const CONFIRMATIONS = 2;

/** Ignore a repeat of the code we just accepted for this long. */
const REPEAT_LOCKOUT_MS = 1500;

function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {}
  });
}

export default function MobileBarcodeScanner({
  onScan,
  onClose,
  title = "Scan a product",
  hint = "",
  lastResult = "",
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const readerRef = useRef(null);
  const timerRef = useRef(null);
  const runningRef = useRef(false);
  const canvasSizeRef = useRef("");
  const lastCodeRef = useRef({ value: "", count: 0, acceptedAt: 0 });

  // The camera must not restart just because the page rebuilt its handler.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const [manualBarcode, setManualBarcode] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [engine, setEngine] = useState("");
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [status, setStatus] = useState("Starting camera…");
  const [flash, setFlash] = useState(false);

  /**
   * Take a decoded value only after seeing it twice, and never twice in quick
   * succession, so one barcode does not register as several scans.
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

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    /** True once the browser reports real frame dimensions. */
    const frameReady = () => {
      const video = videoRef.current;
      return Boolean(
        video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0
      );
    };

    async function decodeWithNative(detector) {
      const video = videoRef.current;
      const results = await detector.detect(video);
      if (results && results.length > 0) accept(results[0].rawValue);
    }

    function decodeWithZxing() {
      const video = videoRef.current;
      const reader = readerRef.current;
      if (!reader) return;

      // The capture canvas is cached at the size of the first frame decoded.
      // If the camera changes resolution mid-stream, drop it and let ZXing
      // rebuild it, or every later frame is sampled at the wrong size.
      const size = `${video.videoWidth}x${video.videoHeight}`;
      if (canvasSizeRef.current && canvasSizeRef.current !== size) {
        try {
          reader.reset();
        } catch {}
      }
      canvasSizeRef.current = size;

      const result = reader.decode(video);
      if (result) accept(result.getText());
    }

    async function loop(decodeOnce) {
      if (!runningRef.current || cancelled) return;

      if (frameReady()) {
        try {
          await decodeOnce();
        } catch {
          // No barcode in this frame. That is the normal case; keep going.
        }
      }

      if (runningRef.current && !cancelled) {
        timerRef.current = setTimeout(() => loop(decodeOnce), DECODE_INTERVAL_MS);
      }
    }

    async function startDecoding() {
      // The native detector is much faster where it exists, but it is absent on
      // iOS Safari, Firefox and most desktop browsers, which is why ZXing is
      // there to catch everything else.
      if (typeof window !== "undefined" && "BarcodeDetector" in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats?.();
          const formats = supported
            ? NATIVE_FORMATS.filter((f) => supported.includes(f))
            : NATIVE_FORMATS;

          if (formats.length > 0) {
            const detector = new window.BarcodeDetector({ formats });
            if (cancelled) return;
            setEngine("Fast scan");
            setStatus("Point the camera at a barcode");
            loop(() => decodeWithNative(detector));
            return;
          }
        } catch {
          // Class present but unusable — fall through to ZXing.
        }
      }

      const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await import("@zxing/library");
      if (cancelled) return;

      // Narrowing the format list makes each frame noticeably cheaper on the
      // low-end phones this screen actually runs on.
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.ITF,
        BarcodeFormat.CODABAR,
      ]);
      hints.set(DecodeHintType.TRY_HARDER, true);

      readerRef.current = new BrowserMultiFormatReader(hints);
      canvasSizeRef.current = "";
      setEngine("Standard scan");
      setStatus("Point the camera at a barcode");
      loop(decodeWithZxing);
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(
          "This browser cannot open a camera. Type the barcode below instead."
        );
        return;
      }

      if (typeof window !== "undefined" && !window.isSecureContext) {
        setCameraError(
          "The camera only works over HTTPS. Open this page on its https:// address, then try again."
        );
        return;
      }

      try {
        const constraints = {
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stopStream(stream);
          return;
        }

        streamRef.current = stream;
        setCameraError("");

        // Device labels only populate once permission has been granted. This
        // fills the picker without setting deviceId, which would restart the
        // camera we have just opened.
        navigator.mediaDevices
          .enumerateDevices()
          .then((all) => {
            if (!cancelled) setDevices(all.filter((d) => d.kind === "videoinput"));
          })
          .catch(() => {});

        const track = stream.getVideoTracks()[0];
        setTorchAvailable(Boolean(track?.getCapabilities?.().torch));
        setTorchOn(false);

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute("playsinline", "true");
          video.setAttribute("muted", "true");
          video.muted = true;
          try {
            await video.play();
          } catch {
            // Autoplay can be refused; the loop waits for frames either way.
          }
        }

        runningRef.current = true;
        await startDecoding();
      } catch (err) {
        if (cancelled) return;
        const name = err?.name || "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setCameraError(
            "Camera permission was refused. Allow camera access for this site in your browser settings, then reopen the scanner."
          );
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setCameraError("No usable camera was found on this device. Type the barcode below instead.");
        } else if (name === "NotReadableError" || name === "TrackStartError") {
          setCameraError("The camera is in use by another app. Close it and try again.");
        } else {
          setCameraError(`Could not start the camera: ${err?.message || name || "unknown error"}`);
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      runningRef.current = false;
      clearTimer();
      try {
        readerRef.current?.reset?.();
      } catch {}
      readerRef.current = null;
      canvasSizeRef.current = "";
      stopStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [deviceId, accept]);

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

  const handleClose = () => {
    runningRef.current = false;
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

  return (
    <div className="mbs">
      <div className="mbs__header">
        <div className="mbs__header-text">
          <h2>{title}</h2>
          <p>{cameraError ? "Camera unavailable" : `${status}${engine ? ` · ${engine}` : ""}`}</p>
        </div>
        <div className="mbs__header-actions">
          {torchAvailable && (
            <button
              onClick={toggleTorch}
              className={`mbs__icon-btn ${torchOn ? "is-on" : ""}`}
              aria-label={torchOn ? "Turn torch off" : "Turn torch on"}
            >
              {torchOn ? "🔦" : "💡"}
            </button>
          )}
          <button onClick={handleClose} className="mbs__icon-btn" aria-label="Close scanner">
            ×
          </button>
        </div>
      </div>

      {cameraError ? (
        <div className="mbs__error">
          <p>{cameraError}</p>
        </div>
      ) : (
        <div className="mbs__stage">
          <video ref={videoRef} className="mbs__video" playsInline muted autoPlay />
          <div className={`mbs__frame ${flash ? "is-hit" : ""}`}>
            <span className="mbs__corner mbs__corner--tl" />
            <span className="mbs__corner mbs__corner--tr" />
            <span className="mbs__corner mbs__corner--bl" />
            <span className="mbs__corner mbs__corner--br" />
            <span className="mbs__laser" />
          </div>
          {hint && <div className="mbs__hint">{hint}</div>}
          {lastResult && <div className="mbs__last">Last: {lastResult}</div>}
        </div>
      )}

      <div className="mbs__footer">
        {devices.length > 1 && !cameraError && (
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="mbs__select"
            aria-label="Choose camera"
          >
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
          <button type="submit">Find</button>
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
          padding: 14px 16px;
          color: #fff;
          background: rgba(0, 0, 0, 0.78);
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
          font-size: 18px;
          cursor: pointer;
          display: grid;
          place-items: center;
        }
        .mbs__icon-btn.is-on {
          background: rgba(250, 204, 21, 0.35);
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
          box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.48);
          border-radius: 12px;
          transition: box-shadow 0.18s ease;
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
          height: 2px;
          background: #22d3ee;
          box-shadow: 0 0 12px rgba(34, 211, 238, 0.9);
          animation: mbs-sweep 2s ease-in-out infinite;
        }
        @keyframes mbs-sweep {
          0%,
          100% {
            top: 12px;
          }
          50% {
            top: calc(100% - 14px);
          }
        }
        .mbs__hint,
        .mbs__last {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.72);
          color: #fff;
          font-size: 12px;
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
          padding: 14px 16px calc(14px + env(safe-area-inset-bottom));
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
      `}</style>
    </div>
  );
}
