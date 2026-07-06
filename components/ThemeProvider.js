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

function applyThemeToDOM(theme) {
  if (!theme || typeof document === "undefined") return;

  const root = document.documentElement;
  const primary = generatePalette(theme.primaryColor || "#0ea5e9");
  const secondary = generatePalette(theme.secondaryColor || "#06b6d4");
  const sidebarActiveFrom = theme.sidebarActiveGradientFrom || primary[600] || "#2563eb";
  const sidebarActiveTo = theme.sidebarActiveGradientTo || primary[700] || "#1d4ed8";
  const tableHeaderFrom =
    theme.tableHeaderGradientFrom || theme.buttonPrimaryBg || primary[600] || "#0284c7";
  const tableHeaderTo =
    theme.tableHeaderGradientTo || theme.buttonPrimaryHover || primary[700] || "#0369a1";
  const buttonPrimaryBg = theme.buttonPrimaryBg || tableHeaderFrom;
  const buttonPrimaryHover = theme.buttonPrimaryHover || tableHeaderTo;

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
  root.style.setProperty("--table-header-from", tableHeaderFrom);
  root.style.setProperty("--table-header-to", tableHeaderTo);
  root.style.setProperty("--table-header-bg", tableHeaderFrom);
  root.style.setProperty("--table-header-border", tableHeaderTo);
  root.style.setProperty("--btn-primary-bg", buttonPrimaryBg);
  root.style.setProperty("--btn-primary-hover", buttonPrimaryHover);

  if (theme.sidebarBg) root.style.setProperty("--sidebar-bg", theme.sidebarBg);
  if (theme.pageBg) root.style.setProperty("--page-bg", theme.pageBg);
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
        const parsed = JSON.parse(cached);
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
          setTheme(t);
          applyThemeToDOM(t);
          localStorage.setItem("system-theme", JSON.stringify(t));
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

export { applyThemeToDOM, generatePalette };
