/**
 * Camera barcode scanner for the mobile stock take.
 *
 * The previous version relied on `window.BarcodeDetector` alone. That exists in
 * Chrome on Android but not in Safari on iOS, not in Firefox and not in most
 * desktop browsers, so on those devices the camera opened, the preview ran and
 * nothing was ever detected — the scanner looked broken.
 *
 * This tries BarcodeDetector first because it is fastest where it exists, and
 * falls back to ZXing (already a dependency) everywhere else. It also:
 *   - lets the user pick a camera when the device has more than one
 *   - offers a torch toggle on hardware that supports it
 *   - requires the same code twice before accepting it, which kills the
 *     misreads a single blurry frame produces
 *   - keeps scanning after a hit when `continuous` is set, so a counter can
 *     work down a shelf without reopening the camera each time
 */
import { useCallback, useEffect, useRef, useState } from "react";

const FORMATS = ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf", "codabar"];

/** Stop every track on a stream, so the camera light actually goes out. */
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
  continuous = false,
  title = "Scan Barcode",
  lastResult = "",
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const readerRef = useRef(null);
  const runningRef = useRef(false);
  const lastCodeRef = useRef({ value: "", count: 0, acceptedAt: 0 });

  const [manualBarcode, setManualBarcode] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [engine, setEngine] = useState("");
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [status, setStatus] = useState("Starting camera…");

  /**
   * Accept a decoded value only after seeing it twice, and never twice inside
   * 1.2 seconds, so one barcode does not register as several scans.
   */
  const accept = useCallback(
    (raw) => {
      const value = String(raw || "").trim();
      if (!value) return;

      const now = Date.now();
      const state = lastCodeRef.current;

      if (state.value === value && now - state.acceptedAt < 1200) return;

      if (state.value !== value) {
        lastCodeRef.current = { value, count: 1, acceptedAt: 0 };
        return;
      }

      state.count += 1;
      if (state.count < 2) return;

      lastCodeRef.current = { value, count: 0, acceptedAt: now };

      if (navigator.vibrate) {
        try {
          navigator.vibrate(60);
        } catch {}
      }

      setStatus(`Scanned ${value}`);
      onScan(value);

      if (!continuous) {
        runningRef.current = false;
      }
    },
    [onScan, continuous]
  );

  /* ─── Camera list ─────────────────────────────────────────────── */

  const listCameras = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter((d) => d.kind === "videoinput");
      setDevices(cams);
      return cams;
    } catch {
      return [];
    }
  }, []);

  /* ─── Start / stop ────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("This browser cannot open the camera. Use the manual entry box below.");
        return;
      }

      try {
        const constraints = {
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stopStream(stream);
          return;
        }

        streamRef.current = stream;
        setCameraError("");

        // Labels only populate after permission is granted, so list here.
        const cams = await listCameras();
        if (!deviceId && cams.length) {
          const active = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
          if (active) setDeviceId(active);
        }

        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() || {};
        setTorchAvailable(Boolean(capabilities.torch));

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // iOS needs both of these before it will play inline.
          videoRef.current.setAttribute("playsinline", "true");
          videoRef.current.muted = true;
          await videoRef.current.play().catch(() => {});
        }

        runningRef.current = true;

        if (typeof window !== "undefined" && "BarcodeDetector" in window) {
          setEngine("BarcodeDetector");
          setStatus("Point the camera at a barcode");
          runDetectorLoop();
        } else {
          setEngine("ZXing");
          setStatus("Point the camera at a barcode");
          await runZxingLoop();
        }
      } catch (err) {
        if (cancelled) return;
        const name = err?.name || "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setCameraError(
            "Camera permission was denied. Allow camera access for this site, then reopen the scanner. On a phone the page must be served over HTTPS."
          );
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setCameraError("No usable camera was found on this device. Type the barcode below instead.");
        } else if (name === "NotReadableError") {
          setCameraError("The camera is being used by another app. Close it and try again.");
        } else {
          setCameraError(`Could not start the camera: ${err?.message || name || "unknown error"}`);
        }
      }
    }

    /** Native path — fast where it exists. */
    async function runDetectorLoop() {
      let detector;
      try {
        detector = new window.BarcodeDetector({ formats: FORMATS });
      } catch {
        // Some builds expose the class but support no formats; drop to ZXing.
        setEngine("ZXing");
        await runZxingLoop();
        return;
      }

      const tick = async () => {
        if (!runningRef.current || cancelled) return;
        const video = videoRef.current;
        if (video && video.readyState >= video.HAVE_CURRENT_DATA) {
          try {
            const results = await detector.detect(video);
            if (results && results.length > 0) accept(results[0].rawValue);
          } catch {
            // A transient decode failure is normal; keep going.
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    }

    /** Fallback path — works on iOS Safari, Firefox and desktop browsers. */
    async function runZxingLoop() {
      const { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } = await import("@zxing/library");
      if (cancelled) return;

      // Restricting the formats makes each frame noticeably cheaper to decode
      // on the low-end phones this screen is actually used on.
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

      const reader = new BrowserMultiFormatReader(hints, 200);
      readerRef.current = reader;

      // ZXing drives its own decode loop off the stream and calls back on every
      // frame; `accept` is what filters the noise out of that.
      await reader.decodeFromStream(streamRef.current, videoRef.current, (result) => {
        if (!runningRef.current || cancelled) return;
        if (result) accept(result.getText());
      });
    }

    start();

    return () => {
      cancelled = true;
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try {
        readerRef.current?.reset?.();
      } catch {}
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [deviceId, accept, listCameras]);

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
    // Manual entry is deliberate, so skip the confirm-twice rule.
    lastCodeRef.current = { value: "", count: 0, acceptedAt: 0 };
    onScan(value);
  };

  return (
    <div className="mbs">
      <div className="mbs__header">
        <div>
          <h2>{title}</h2>
          <p>{cameraError ? "Camera unavailable" : `${status}${engine ? ` · ${engine}` : ""}`}</p>
        </div>
        <div className="mbs__header-actions">
          {torchAvailable && (
            <button onClick={toggleTorch} className="mbs__icon-btn" aria-label="Toggle torch">
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
          <div className="mbs__frame">
            <span className="mbs__corner mbs__corner--tl" />
            <span className="mbs__corner mbs__corner--tr" />
            <span className="mbs__corner mbs__corner--bl" />
            <span className="mbs__corner mbs__corner--br" />
            <span className="mbs__laser" />
          </div>
          {lastResult && <div className="mbs__last">Last: {lastResult}</div>}
        </div>
      )}

      <div className="mbs__footer">
        {devices.length > 1 && !cameraError && (
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="mbs__select">
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
          background: rgba(0, 0, 0, 0.75);
        }
        .mbs__header h2 {
          font-size: 16px;
          font-weight: 700;
          margin: 0;
        }
        .mbs__header p {
          font-size: 11px;
          opacity: 0.7;
          margin: 2px 0 0;
        }
        .mbs__header-actions {
          display: flex;
          gap: 8px;
        }
        .mbs__icon-btn {
          border: 0;
          background: rgba(255, 255, 255, 0.18);
          color: #fff;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          font-size: 18px;
          cursor: pointer;
          display: grid;
          place-items: center;
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
          width: min(78vw, 300px);
          height: 170px;
          box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.45);
          border-radius: 12px;
        }
        .mbs__corner {
          position: absolute;
          width: 26px;
          height: 26px;
          border: 3px solid #22d3ee;
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
        .mbs__last {
          position: absolute;
          left: 50%;
          bottom: 18px;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.72);
          color: #fff;
          font-size: 12px;
          padding: 6px 12px;
          border-radius: 999px;
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
          line-height: 1.55;
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
          height: 42px;
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
          height: 46px;
          border: 1px solid #374151;
          border-radius: 10px;
          background: #1f2937;
          color: #fff;
          padding: 0 14px;
          font-size: 16px;
        }
        .mbs__manual button {
          height: 46px;
          padding: 0 20px;
          border: 0;
          border-radius: 10px;
          background: #2563eb;
          color: #fff;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
