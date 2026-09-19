import { createContext, useContext, useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";

const ThemeContext = createContext(null);

// Generate lighter/darker shades from a hex color
function hexToHSL(hex) {
  hex = hex.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0,
    s = 0,
    l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function generatePalette(baseHex) {
  const { h, s } = hexToHSL(baseHex);
  return {
    50: hslToHex(h, Math.max(s - 30, 10), 97),
    100: hslToHex(h, Math.max(s - 20, 15), 93),
    200: hslToHex(h, Math.max(s - 10, 20), 85),
    300: hslToHex(h, s, 73),
    400: hslToHex(h, s, 60),
    500: baseHex,
    600: hslToHex(h, Math.min(s + 5, 100), 43),
    700: hslToHex(h, Math.min(s + 10, 100), 35),
    800: hslToHex(h, Math.min(s + 10, 100), 28),
    900: hslToHex(h, Math.min(s + 10, 100), 22),
  };
}

/* ─── Contrast helpers ─────────────────────────────────────────────
   A theme colour picked by hand (amber, lime, slate…) can leave white
   label text unreadable on a table header or a button. These pick the
   ink colour from the background's luminance instead of assuming white. */

function hexToRgb(hex) {
  const clean = String(hex || "").replace("#", "").trim();
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * WCAG AA for large text, which is what table headers, buttons and the active
 * nav item use (bold, 14px and up).
 */
export const LARGE_TEXT_CONTRAST = 3;

/**
 * White or near-black ink for a filled surface.
 *
 * Picking whichever ratio is simply higher puts near-black text on mid-blue and
 * mid-green headers, which no one expects and which looks broken next to the
 * rest of the interface. White wins while it still clears the large-text
 * threshold; only genuinely light backgrounds (amber, lime, pale grey) fall
 * back to dark ink.
 */
function readableInk(bg) {
  const onWhite = contrastRatio(bg, "#ffffff");
  if (onWhite >= LARGE_TEXT_CONTRAST) return "#ffffff";
  return onWhite >= contrastRatio(bg, "#0f172a") ? "#ffffff" : "#0f172a";
}

/** Same hue as `hex`, but dark enough to read as text on a white card. */
function readableAccentText(hex, palette) {
  const candidates = [hex, palette?.[600], palette?.[700], palette?.[800], palette?.[900]];
  for (const candidate of candidates) {
    if (candidate && contrastRatio(candidate, "#ffffff") >= 4.5) return candidate;
  }
  return palette?.[900] || "#0f172a";
}

function rgba(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(15, 23, 42, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/* ─── Shape and density presets ──────────────────────────────────── */

export const CORNER_STYLES = {
  sharp: { label: "Sharp", sm: "0", md: "0.125rem", lg: "0.1875rem", xl: "0.25rem", "2xl": "0.3125rem" },
  soft: { label: "Soft", sm: "0.125rem", md: "0.25rem", lg: "0.375rem", xl: "0.5rem", "2xl": "0.625rem" },
  rounded: { label: "Rounded", sm: "0.25rem", md: "0.375rem", lg: "0.5rem", xl: "0.75rem", "2xl": "1rem" },
  pill: { label: "Extra Round", sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", "2xl": "1.5rem" },
};

export const DENSITIES = {
  compact: { label: "Compact", cellY: "0.5rem", cellX: "0.75rem", controlY: "0.5rem", cardPad: "1rem" },
  comfortable: { label: "Comfortable", cellY: "0.75rem", cellX: "1rem", controlY: "0.625rem", cardPad: "1.5rem" },
  spacious: { label: "Spacious", cellY: "1rem", cellX: "1.25rem", controlY: "0.75rem", cardPad: "2rem" },
};

export const DEFAULT_THEME = {
  primaryColor: "#0ea5e9",
  secondaryColor: "#06b6d4",
  sidebarBg: "#f9fafb",
  sidebarActiveGradientFrom: "#2563eb",
  sidebarActiveGradientTo: "#1d4ed8",
  tableHeaderGradientFrom: "#0284c7",
  tableHeaderGradientTo: "#0369a1",
  buttonPrimaryBg: "#0284c7",
  buttonPrimaryHover: "#0369a1",
  pageBg: "#f9fafb",
  surfaceCard: "#ffffff",
  borderColor: "#e5e7eb",
  tableRowHover: "",
  tableStriped: true,
  cornerStyle: "soft",
  density: "comfortable",
  successColor: "#10b981",
  warningColor: "#f59e0b",
  errorColor: "#ef4444",
  infoColor: "#3b82f6",
  presetName: "Default Blue",
};

function applyThemeToDOM(theme) {
  if (!theme || typeof document === "undefined") return;

  const root = document.documentElement;
  const primary = generatePalette(theme.primaryColor || DEFAULT_THEME.primaryColor);
  const secondary = generatePalette(theme.secondaryColor || DEFAULT_THEME.secondaryColor);

  const sidebarActiveFrom = theme.sidebarActiveGradientFrom || primary[600];
  const sidebarActiveTo = theme.sidebarActiveGradientTo || primary[700];
  const tableHeaderFrom = theme.tableHeaderGradientFrom || theme.buttonPrimaryBg || primary[600];
  const tableHeaderTo = theme.tableHeaderGradientTo || theme.buttonPrimaryHover || primary[700];
  const buttonPrimaryBg = theme.buttonPrimaryBg || tableHeaderFrom;
  const buttonPrimaryHover = theme.buttonPrimaryHover || tableHeaderTo;

  const accentPalette = generatePalette(buttonPrimaryBg);
  const accentText = readableAccentText(buttonPrimaryBg, accentPalette);

  // Primary palette
  Object.entries(primary).forEach(([shade, color]) => {
    root.style.setProperty(`--color-primary-${shade}`, color);
  });

  // Secondary palette
  Object.entries(secondary).forEach(([shade, color]) => {
    root.style.setProperty(`--color-secondary-${shade}`, color);
  });

  // Semantic colors
  if (theme.successColor) root.style.setProperty("--color-success", theme.successColor);
  if (theme.warningColor) root.style.setProperty("--color-warning", theme.warningColor);
  if (theme.errorColor) root.style.setProperty("--color-error", theme.errorColor);
  if (theme.infoColor) root.style.setProperty("--color-info", theme.infoColor);

  // Component-level variables
  root.style.setProperty("--sidebar-active-from", sidebarActiveFrom);
  root.style.setProperty("--sidebar-active-to", sidebarActiveTo);
  root.style.setProperty("--sidebar-active-bg", sidebarActiveFrom);
  root.style.setProperty("--sidebar-active-border", sidebarActiveTo);
  root.style.setProperty("--sidebar-active-ink", readableInk(sidebarActiveFrom));
  root.style.setProperty("--table-header-from", tableHeaderFrom);
  root.style.setProperty("--table-header-to", tableHeaderTo);
  root.style.setProperty("--table-header-bg", tableHeaderFrom);
  root.style.setProperty("--table-header-border", tableHeaderTo);
  root.style.setProperty("--table-header-ink", readableInk(tableHeaderFrom));
  root.style.setProperty("--btn-primary-bg", buttonPrimaryBg);
  root.style.setProperty("--btn-primary-hover", buttonPrimaryHover);
  root.style.setProperty("--btn-primary-ink", readableInk(buttonPrimaryBg));

  // Accent family — drives links, soft badges, left borders, focus rings
  root.style.setProperty("--accent", buttonPrimaryBg);
  root.style.setProperty("--accent-hover", buttonPrimaryHover);
  root.style.setProperty("--accent-ink", readableInk(buttonPrimaryBg));
  root.style.setProperty("--accent-text", accentText);
  root.style.setProperty("--accent-soft-bg", accentPalette[50]);
  root.style.setProperty("--accent-soft-border", accentPalette[200]);
  root.style.setProperty("--accent-soft-text", accentText);
  root.style.setProperty("--focus-ring", rgba(buttonPrimaryBg, 0.22));

  // Table rows — an explicit hover colour wins, otherwise a faint accent wash
  // that keeps body text at full contrast instead of the old flat sky tint.
  const rowHover = theme.tableRowHover || rgba(buttonPrimaryBg, 0.08);
  root.style.setProperty("--row-hover-bg", rowHover);
  root.style.setProperty("--row-hover-ink", "#0f172a");
  root.style.setProperty("--row-hover-marker", buttonPrimaryBg);
  root.style.setProperty("--row-stripe-bg", theme.tableStriped === false ? "transparent" : rgba(buttonPrimaryBg, 0.025));
  root.style.setProperty("--row-selected-bg", rgba(buttonPrimaryBg, 0.14));

  // Surfaces
  const surfaceCard = theme.surfaceCard || DEFAULT_THEME.surfaceCard;
  const borderColor = theme.borderColor || DEFAULT_THEME.borderColor;
  root.style.setProperty("--surface-card", surfaceCard);
  root.style.setProperty("--surface-raised", surfaceCard);
  root.style.setProperty("--border-subtle", borderColor);
  root.style.setProperty("--border-strong", accentPalette[300]);

  if (theme.sidebarBg) root.style.setProperty("--sidebar-bg", theme.sidebarBg);
  if (theme.pageBg) {
    root.style.setProperty("--page-bg", theme.pageBg);
    root.style.setProperty("--surface-card-alt", theme.pageBg);
    root.style.setProperty("--surface-muted", theme.pageBg);
  }

  // Corner radius scale
  const corners = CORNER_STYLES[theme.cornerStyle] || CORNER_STYLES.soft;
  root.style.setProperty("--radius-sm", corners.sm);
  root.style.setProperty("--radius-md", corners.md);
  root.style.setProperty("--radius-lg", corners.lg);
  root.style.setProperty("--radius-xl", corners.xl);
  root.style.setProperty("--radius-2xl", corners["2xl"]);

  // Density scale
  const density = DENSITIES[theme.density] || DENSITIES.comfortable;
  root.style.setProperty("--cell-pad-y", density.cellY);
  root.style.setProperty("--cell-pad-x", density.cellX);
  root.style.setProperty("--control-pad-y", density.controlY);
  root.style.setProperty("--card-pad", density.cardPad);
}

/** Fill in any field the stored theme is missing so previews never read `undefined`. */
export function normalizeTheme(theme) {
  const merged = { ...DEFAULT_THEME };
  if (theme && typeof theme === "object") {
    for (const key of Object.keys(DEFAULT_THEME)) {
      const value = theme[key];
      if (value !== undefined && value !== null && value !== "") merged[key] = value;
    }
    if (theme.tableStriped !== undefined) merged.tableStriped = theme.tableStriped;
    if (theme.tableRowHover !== undefined) merged.tableRowHover = theme.tableRowHover;
  }
  return merged;
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    // Try localStorage first for instant render
    const cached = localStorage.getItem("system-theme");
    if (cached) {
      try {
        const parsed = normalizeTheme(JSON.parse(cached));
        setTheme(parsed);
        applyThemeToDOM(parsed);
      } catch {}
    }

    const token = localStorage.getItem("auth_token");
    if (!token) {
      return;
    }

    // Fetch latest from API
    apiClient
      .get("/api/setup/color-theme")
      .then((res) => {
        const t = res.data?.theme;
        if (t) {
          const normalized = normalizeTheme(t);
          setTheme(normalized);
          applyThemeToDOM(normalized);
          localStorage.setItem("system-theme", JSON.stringify(normalized));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, applyThemeToDOM }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export { applyThemeToDOM, generatePalette, readableInk, contrastRatio };
