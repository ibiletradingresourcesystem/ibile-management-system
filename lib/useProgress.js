/**
 * useProgress Hook - Tracks real loading progress for data fetching
 * 
 * Provides a smooth, accurate progress bar that reflects actual loading phases:
 *   0-15%  : Connecting / initiating request
 *   15-50% : Receiving response data
 *   50-85% : Processing / parsing data
 *   85-100%: Rendering & finalizing
 * 
 * Usage:
 *   const { progress, start, onFetch, onProcess, complete, reset } = useProgress();
 *   <Loader progress={progress} />
 */

import { useState, useRef, useCallback, useEffect } from "react";

export default function useProgress() {
  const [progress, setProgress] = useState(0);
  const intervalRef = useRef(null);
  const phaseRef = useRef("idle"); // idle | connecting | fetching | processing | done

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const clearTicker = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Smoothly animate progress toward a target value
  const animateTo = useCallback((target, stepMs = 120) => {
    clearTicker();
    intervalRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= target) {
          clearTicker();
          return target;
        }
        // Ease out — slows as it approaches target
        const remaining = target - prev;
        const step = Math.max(0.3, remaining * 0.15);
        return Math.min(target, prev + step);
      });
    }, stepMs);
  }, [clearTicker]);

  /** Call when starting a fetch operation */
  const start = useCallback(() => {
    phaseRef.current = "connecting";
    setProgress(0);
    // Animate to 15% while "connecting"
    setTimeout(() => animateTo(15, 80), 50);
  }, [animateTo]);

  /** Call after the fetch response is received (before parsing) */
  const onFetch = useCallback(() => {
    phaseRef.current = "fetching";
    setProgress((prev) => Math.max(prev, 15));
    animateTo(50, 100);
  }, [animateTo]);

  /** Call when data processing / filtering begins */
  const onProcess = useCallback(() => {
    phaseRef.current = "processing";
    setProgress((prev) => Math.max(prev, 50));
    animateTo(85, 100);
  }, [animateTo]);

  /** Call when everything is done — jumps to 100% and cleans up */
  const complete = useCallback(() => {
    clearTicker();
    phaseRef.current = "done";
    setProgress(100);
  }, [clearTicker]);

  /** Reset to 0 — use when starting a fresh load */
  const reset = useCallback(() => {
    clearTicker();
    phaseRef.current = "idle";
    setProgress(0);
  }, [clearTicker]);

  return { progress, start, onFetch, onProcess, complete, reset };
}
