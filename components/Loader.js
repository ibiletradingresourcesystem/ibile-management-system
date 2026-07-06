/**
 * Unified Loader Component - Consistent across all pages
 * Uses store logo from store data, cached permanently in localStorage
 * Supports real progress tracking via useProgress hook
 */

import { useState, useEffect } from "react";
import { DEFAULT_LOGO, getCachedLogo, fetchAndCacheLogo } from "@/lib/storeLogo";

export default function Loader({ 
  size = "md", 
  text = "Loading", 
  fullScreen = false,
  variant = "spin",
  color = "sky",
  progress = null, // optional 0-100 for determinate progress
}) {
  const [logoUrl, setLogoUrl] = useState(DEFAULT_LOGO);

  useEffect(() => {
    let isMounted = true;

    setLogoUrl(getCachedLogo());
    fetchAndCacheLogo().then((url) => {
      if (isMounted) {
        setLogoUrl(url);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  // Size configurations - responsive to parent container
  const sizeClasses = {
    sm: "w-8 h-8 sm:w-10 sm:h-10",
    md: "w-12 h-12 sm:w-16 sm:h-16",
    lg: "w-20 h-20 sm:w-24 sm:h-24",
  };

  const sizeClass = sizeClasses[size];
  const clampedProgress =
    progress === null ? null : Math.min(100, Math.max(0, progress));
  const useSuccessProgress = clampedProgress !== null && (clampedProgress >= 100 || color === "success");
  const progressFillClass = useSuccessProgress ? "theme-progress-fill-success" : "theme-progress-fill";
  const progressLabelColor = useSuccessProgress
    ? "var(--color-success-600, #059669)"
    : "var(--btn-primary-bg, #0284c7)";

  const getPhaseLabel = (pct) => {
    if (pct <= 0) return "Initializing...";
    if (pct < 15) return "Connecting...";
    if (pct < 50) return "Fetching data...";
    if (pct < 85) return "Processing...";
    if (pct < 100) return "Almost done...";
    return "Complete!";
  };

  const loaderContent = (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className={`${sizeClass}`} style={{ perspective: '1000px' }}>
        <div className={`animate-spin-y ${sizeClass}`}>
          <img 
            src={logoUrl} 
            alt="Loading" 
            className="w-full h-full rounded-full object-cover filter drop-shadow-lg"
          />
        </div>
      </div>
      {text && progress === null && (
        <p
          className="font-medium text-center"
          style={{ color: "var(--loader-caption-color, var(--text-muted, #4b5563))" }}
        >
          {text}
        </p>
      )}
      {progress !== null && (
        <div className="w-48 sm:w-64">
          <div className="flex justify-between text-xs mb-1">
            <span
              className="font-medium"
              style={{ color: "var(--loader-caption-color, var(--text-muted, #6b7280))" }}
            >
              {getPhaseLabel(progress)}
            </span>
            <span className="font-bold tabular-nums" style={{ color: progressLabelColor }}>
              {Math.round(clampedProgress)}%
            </span>
          </div>
          <div className="theme-progress-track w-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all duration-300 ease-out ${progressFillClass}`}
              style={{ width: `${clampedProgress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );

  if (fullScreen) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center z-50"
        style={{ backgroundColor: "var(--loader-overlay-bg, rgba(249, 250, 251, 0.92))" }}
      >
        {loaderContent}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center p-6">
      {loaderContent}
    </div>
  );
}