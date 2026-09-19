"use client";
import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog } from "@/lib/dialogs";
import {
  useTheme,
  applyThemeToDOM,
  normalizeTheme,
  contrastRatio,
  readableInk,
  generatePalette,
  LARGE_TEXT_CONTRAST,
  CORNER_STYLES,
  DENSITIES,
  DEFAULT_THEME,
} from "@/components/ThemeProvider";
import { RotateCcw, Save, Check, AlertTriangle, Eye } from "lucide-react";

const PRESETS = [
  {
    name: "Default Blue",
    primaryColor: "#0ea5e9",
    secondaryColor: "#06b6d4",
    sidebarActiveGradientFrom: "#2563eb",
    sidebarActiveGradientTo: "#1d4ed8",
    tableHeaderGradientFrom: "#0284c7",
    tableHeaderGradientTo: "#0369a1",
    buttonPrimaryBg: "#0284c7",
    buttonPrimaryHover: "#0369a1",
    pageBg: "#f9fafb",
    surfaceCard: "#ffffff",
    borderColor: "#e5e7eb",
  },
  {
    name: "Indigo",
    primaryColor: "#6366f1",
    secondaryColor: "#8b5cf6",
    sidebarActiveGradientFrom: "#4f46e5",
    sidebarActiveGradientTo: "#4338ca",
    tableHeaderGradientFrom: "#4f46e5",
    tableHeaderGradientTo: "#4338ca",
    buttonPrimaryBg: "#4f46e5",
    buttonPrimaryHover: "#4338ca",
    pageBg: "#f8fafc",
    surfaceCard: "#ffffff",
    borderColor: "#e2e8f0",
  },
  {
    name: "Emerald",
    primaryColor: "#10b981",
    secondaryColor: "#14b8a6",
    sidebarActiveGradientFrom: "#059669",
    sidebarActiveGradientTo: "#047857",
    tableHeaderGradientFrom: "#059669",
    tableHeaderGradientTo: "#047857",
    buttonPrimaryBg: "#059669",
    buttonPrimaryHover: "#047857",
    pageBg: "#f8faf9",
    surfaceCard: "#ffffff",
    borderColor: "#e5e7eb",
  },
  {
    name: "Rose",
    primaryColor: "#f43f5e",
    secondaryColor: "#fb7185",
    sidebarActiveGradientFrom: "#e11d48",
    sidebarActiveGradientTo: "#be123c",
    tableHeaderGradientFrom: "#e11d48",
    tableHeaderGradientTo: "#be123c",
    buttonPrimaryBg: "#e11d48",
    buttonPrimaryHover: "#be123c",
    pageBg: "#fdf9fa",
    surfaceCard: "#ffffff",
    borderColor: "#eee2e5",
  },
  {
    name: "Amber",
    primaryColor: "#f59e0b",
    secondaryColor: "#d97706",
    sidebarActiveGradientFrom: "#d97706",
    sidebarActiveGradientTo: "#b45309",
    tableHeaderGradientFrom: "#b45309",
    tableHeaderGradientTo: "#92400e",
    buttonPrimaryBg: "#b45309",
    buttonPrimaryHover: "#92400e",
    pageBg: "#fdfbf7",
    surfaceCard: "#ffffff",
    borderColor: "#ece3d7",
  },
  {
    name: "Graphite",
    primaryColor: "#64748b",
    secondaryColor: "#475569",
    sidebarActiveGradientFrom: "#334155",
    sidebarActiveGradientTo: "#1e293b",
    tableHeaderGradientFrom: "#334155",
    tableHeaderGradientTo: "#1e293b",
    buttonPrimaryBg: "#334155",
    buttonPrimaryHover: "#1e293b",
    pageBg: "#f8fafc",
    surfaceCard: "#ffffff",
    borderColor: "#e2e8f0",
  },
];

const FIELD_LABELS = {
  primaryColor: "Primary Colour",
  secondaryColor: "Secondary Colour",
  sidebarActiveGradientFrom: "Sidebar Active",
  sidebarActiveGradientTo: "Sidebar Active Edge",
  tableHeaderGradientFrom: "Table Header",
  tableHeaderGradientTo: "Table Header Edge",
  buttonPrimaryBg: "Button Primary",
  buttonPrimaryHover: "Button Primary Hover",
  pageBg: "Page Background",
  surfaceCard: "Card Surface",
  borderColor: "Border Colour",
  tableRowHover: "Table Row Hover",
  successColor: "Success",
  warningColor: "Warning",
  errorColor: "Error",
  infoColor: "Info",
};

/** Colours that are normally derived from the primary colour. */
const DERIVED_FIELDS = [
  "buttonPrimaryBg",
  "buttonPrimaryHover",
  "tableHeaderGradientFrom",
  "tableHeaderGradientTo",
  "sidebarActiveGradientFrom",
  "sidebarActiveGradientTo",
];

const SAMPLE_ROWS = [
  { product: "Golden Penny Semovita 2kg", sku: "GP-SEM-2K", qty: 148, value: "₦532,800" },
  { product: "Peak Milk Refill 400g", sku: "PK-MLK-400", qty: 62, value: "₦217,000" },
  { product: "Indomie Chicken Carton", sku: "IND-CHK-CT", qty: 24, value: "₦144,000" },
];

export default function ColorThemePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState(DEFAULT_THEME);
  const [hoveredRow, setHoveredRow] = useState(null);
  const [lockedFields, setLockedFields] = useState({});
  const themeCtx = useTheme();

  useEffect(() => {
    apiClient
      .get("/api/setup/color-theme")
      .then((res) => {
        if (res.data?.theme) setForm(normalizeTheme(res.data.theme));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Live preview as the user changes anything
  useEffect(() => {
    applyThemeToDOM(form);
  }, [form]);

  // Restore the saved theme if the page is left without saving
  useEffect(() => {
    return () => {
      try {
        const cached = localStorage.getItem("system-theme");
        if (cached) applyThemeToDOM(normalizeTheme(JSON.parse(cached)));
      } catch {}
    };
  }, []);

  /*
   * Warn when a chosen colour would leave label text hard to read. The check
   * runs against the ink the theme will actually use, at the large-text
   * threshold that applies to bold header and button labels.
   */
  const contrastWarnings = useMemo(() => {
    const checks = [
      { label: "Table header", bg: form.tableHeaderGradientFrom },
      { label: "Primary button", bg: form.buttonPrimaryBg },
      { label: "Active sidebar item", bg: form.sidebarActiveGradientFrom },
    ];
    return checks
      .map(({ label, bg }) => {
        const ink = readableInk(bg);
        const ratio = contrastRatio(bg, ink);
        return { label, bg, ink, ratio };
      })
      .filter((c) => c.ratio < LARGE_TEXT_CONTRAST);
  }, [form.tableHeaderGradientFrom, form.buttonPrimaryBg, form.sidebarActiveGradientFrom]);

  function handlePreset(preset) {
    setForm((prev) => ({ ...prev, ...preset, presetName: preset.name }));
  }

  function handleReset() {
    setForm(DEFAULT_THEME);
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await apiClient.put("/api/setup/color-theme", form);
      const t = res.data?.theme;
      if (t) {
        const normalized = normalizeTheme(t);
        if (themeCtx) themeCtx.setTheme(normalized);
        applyThemeToDOM(normalized);
        localStorage.setItem("system-theme", JSON.stringify(normalized));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      await showAlertDialog({
        title: "Save theme failed",
        message: err.response?.data?.error || "Failed to save theme",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Tailwind maps the blue, sky and cyan scales onto the primary/secondary CSS
   * variables, so `bg-blue-600` follows `primaryColor` while buttons, table
   * headers and the sidebar follow their own fields. Set those independently
   * and the same page ends up in two different hues. Changing the primary
   * colour therefore re-derives everything that hangs off it, unless the user
   * has deliberately pinned a colour with the lock.
   */
  function cascadeFromPrimary(value) {
    const palette = generatePalette(value);
    return {
      primaryColor: value,
      ...(lockedFields.buttonPrimaryBg ? {} : { buttonPrimaryBg: palette[600] }),
      ...(lockedFields.buttonPrimaryHover ? {} : { buttonPrimaryHover: palette[700] }),
      ...(lockedFields.tableHeaderGradientFrom ? {} : { tableHeaderGradientFrom: palette[600] }),
      ...(lockedFields.tableHeaderGradientTo ? {} : { tableHeaderGradientTo: palette[700] }),
      ...(lockedFields.sidebarActiveGradientFrom ? {} : { sidebarActiveGradientFrom: palette[600] }),
      ...(lockedFields.sidebarActiveGradientTo ? {} : { sidebarActiveGradientTo: palette[700] }),
    };
  }

  function updateField(field, value) {
    setForm((prev) => {
      const patch = field === "primaryColor" ? cascadeFromPrimary(value) : { [field]: value };
      return { ...prev, ...patch, presetName: "Custom" };
    });
    // Touching a derived colour by hand pins it, so a later primary change
    // leaves that choice alone.
    if (DERIVED_FIELDS.includes(field)) {
      setLockedFields((prev) => ({ ...prev, [field]: true }));
    }
  }

  function toggleLock(field) {
    setLockedFields((prev) => ({ ...prev, [field]: !prev[field] }));
  }

  if (loading)
    return (
      <Layout>
        <Loader />
      </Layout>
    );

  return (
    <Layout title="Appearance">
      <div className="page-container">
        <div className="page-content">
          <div className="page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="page-title">Appearance &amp; Theme</h1>
              <p className="page-subtitle">
                Colours, corners, table density and row hover for the whole system. Everything previews live.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={handleReset} className="btn-action btn-action-secondary inline-flex items-center gap-2">
                <RotateCcw size={16} /> Reset
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-action btn-action-primary inline-flex items-center gap-2 disabled:opacity-60"
              >
                {saved ? <Check size={16} /> : <Save size={16} />}
                {saving ? "Saving…" : saved ? "Saved" : "Save Theme"}
              </button>
            </div>
          </div>

          {contrastWarnings.length > 0 && (
            <div className="alert alert-warning mb-6 flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-semibold mb-1">Low contrast on {contrastWarnings.length} surface(s)</p>
                <p>
                  {contrastWarnings.map((c) => c.label).join(", ")} fall below the 3:1 readability ratio for bold label text. Label text is
                  switched to the more legible ink automatically, but a darker or lighter shade will read better.
                </p>
              </div>
            </div>
          )}

          {/* Presets */}
          <div className="content-card mb-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Quick Presets</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => handlePreset(preset)}
                  className={`relative p-4 border-2 transition-all duration-200 hover:shadow-md ${
                    form.presetName === preset.name ? "border-gray-800 shadow-md" : "border-gray-200 hover:border-gray-300"
                  }`}
                  style={{ borderRadius: "var(--radius-xl)" }}
                >
                  <div className="flex gap-1.5 mb-3 justify-center">
                    {[preset.primaryColor, preset.secondaryColor, preset.sidebarActiveGradientFrom].map((c, i) => (
                      <div key={i} className="w-6 h-6 rounded-full border border-gray-200" style={{ backgroundColor: c }} />
                    ))}
                  </div>
                  <p className="text-xs font-medium text-gray-700 text-center">{preset.name}</p>
                  {form.presetName === preset.name && (
                    <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-800 text-white rounded-full flex items-center justify-center">
                      <Check size={12} />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Live preview — shows exactly what the settings do to a real table */}
          <div className="content-card mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Eye size={16} style={{ color: "var(--accent-text)" }} />
              <h2 className="text-lg font-semibold text-gray-800">Live Preview</h2>
              <span className="text-xs text-gray-500 ml-auto">Hover a row to check the contrast</span>
            </div>

            <div style={{ background: form.pageBg, padding: "1.25rem", borderRadius: "var(--radius-xl)" }}>
              <div
                style={{
                  background: form.surfaceCard,
                  border: `1px solid ${form.borderColor}`,
                  borderRadius: "var(--radius-xl)",
                  overflow: "hidden",
                }}
              >
                <table className="w-full" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: form.tableHeaderGradientFrom }}>
                      {["Product", "SKU", "Qty", "Stock Value"].map((h, i) => (
                        <th
                          key={h}
                          style={{
                            color: readableInk(form.tableHeaderGradientFrom),
                            textAlign: i >= 2 ? "right" : "left",
                            padding: `${DENSITIES[form.density]?.cellY || "0.75rem"} ${
                              DENSITIES[form.density]?.cellX || "1rem"
                            }`,
                            fontSize: "0.8125rem",
                            fontWeight: 600,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SAMPLE_ROWS.map((row, i) => {
                      const isHovered = hoveredRow === i;
                      const stripe = form.tableStriped && i % 2 === 1 ? "rgba(0,0,0,0.018)" : "transparent";
                      return (
                        <tr
                          key={row.sku}
                          onMouseEnter={() => setHoveredRow(i)}
                          onMouseLeave={() => setHoveredRow(null)}
                          style={{
                            background: isHovered ? form.tableRowHover || "var(--row-hover-bg)" : stripe,
                            borderBottom: `1px solid ${form.borderColor}`,
                            boxShadow: isHovered ? `inset 3px 0 0 0 ${form.buttonPrimaryBg}` : "none",
                            transition: "background-color .15s ease",
                          }}
                        >
                          {[row.product, row.sku, row.qty, row.value].map((cell, ci) => (
                            <td
                              key={ci}
                              style={{
                                padding: `${DENSITIES[form.density]?.cellY || "0.75rem"} ${
                                  DENSITIES[form.density]?.cellX || "1rem"
                                }`,
                                textAlign: ci >= 2 ? "right" : "left",
                                fontSize: "0.8125rem",
                                color: isHovered ? "#0f172a" : "#374151",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center gap-3 mt-4">
                <button
                  className="px-4 py-2 text-sm font-medium"
                  style={{
                    background: form.buttonPrimaryBg,
                    color: readableInk(form.buttonPrimaryBg),
                    borderRadius: "var(--radius-lg)",
                  }}
                >
                  Primary Action
                </button>
                <button
                  className="px-4 py-2 text-sm font-medium"
                  style={{
                    background: form.surfaceCard,
                    border: `1px solid ${form.borderColor}`,
                    color: "#374151",
                    borderRadius: "var(--radius-lg)",
                  }}
                >
                  Secondary
                </button>
                <span className="theme-badge-soft inline-flex items-center px-3 py-1 text-xs font-medium rounded-full">
                  Soft badge
                </span>
                <span
                  className="px-3 py-1 text-xs font-medium rounded-full text-white"
                  style={{ background: form.successColor }}
                >
                  Success
                </span>
                <span
                  className="px-3 py-1 text-xs font-medium rounded-full text-white"
                  style={{ background: form.errorColor }}
                >
                  Error
                </span>
                <a href="#preview" className="theme-link text-sm font-medium" onClick={(e) => e.preventDefault()}>
                  A themed link
                </a>
              </div>
            </div>
          </div>

          {/* Layout controls */}
          <div className="content-card mb-6">
            <h3 className="text-base font-semibold text-gray-800 mb-1">Layout &amp; Shape</h3>
            <p className="text-xs text-gray-500 mb-4">
              Corner rounding and spacing apply to cards, inputs, buttons and every data table.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Corner Style</label>
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(CORNER_STYLES).map(([key, cfg]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => updateField("cornerStyle", key)}
                      className={`px-2 py-3 text-xs font-medium border-2 transition ${
                        form.cornerStyle === key
                          ? "border-gray-800 text-gray-900"
                          : "border-gray-200 text-gray-500 hover:border-gray-300"
                      }`}
                      style={{ borderRadius: cfg.xl }}
                    >
                      <span
                        className="block w-full h-5 mb-2 border"
                        style={{ borderRadius: cfg.lg, background: "var(--accent-soft-bg)", borderColor: "var(--accent-soft-border)" }}
                      />
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Table &amp; Form Density</label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(DENSITIES).map(([key, cfg]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => updateField("density", key)}
                      className={`px-2 py-3 text-xs font-medium border-2 transition ${
                        form.density === key
                          ? "border-gray-800 text-gray-900"
                          : "border-gray-200 text-gray-500 hover:border-gray-300"
                      }`}
                      style={{ borderRadius: "var(--radius-lg)" }}
                    >
                      <span className="flex flex-col gap-0.5 mb-2 items-stretch">
                        {[0, 1, 2].map((n) => (
                          <span
                            key={n}
                            style={{
                              height: cfg.cellY,
                              background: "var(--accent-soft-bg)",
                              border: "1px solid var(--accent-soft-border)",
                              borderRadius: "2px",
                            }}
                          />
                        ))}
                      </span>
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6 pt-6 border-t" style={{ borderColor: "var(--border-subtle)" }}>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Table Row Hover</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.tableRowHover || "#e6f2fb"}
                    onChange={(e) => updateField("tableRowHover", e.target.value)}
                    className="w-10 h-10 border-2 border-gray-200 cursor-pointer p-0.5 shrink-0"
                    style={{ borderRadius: "var(--radius-lg)" }}
                  />
                  <button
                    type="button"
                    onClick={() => updateField("tableRowHover", "")}
                    className={`px-3 py-2 text-xs font-medium border transition ${
                      form.tableRowHover ? "border-gray-200 text-gray-600 hover:bg-gray-50" : "theme-toggle-active"
                    }`}
                    style={{ borderRadius: "var(--radius-lg)" }}
                  >
                    Auto (tint of primary)
                  </button>
                </div>
                <p className="text-[11px] text-gray-500 mt-2">
                  Auto keeps hover in step with the palette and preserves dark row text.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Zebra Striping</label>
                <div className="flex gap-2">
                  {[
                    { value: true, label: "On" },
                    { value: false, label: "Off" },
                  ].map((opt) => (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => updateField("tableStriped", opt.value)}
                      className={`px-4 py-2 text-xs font-medium border transition ${
                        form.tableStriped === opt.value ? "theme-toggle-active" : "theme-toggle-neutral"
                      }`}
                      style={{ borderRadius: "var(--radius-lg)" }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-500 mt-2">Alternate row shading on long tables.</p>
              </div>
            </div>
          </div>

          {/* Colour Fields */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="content-card">
              <h3 className="text-base font-semibold text-gray-800 mb-4">Main Colours</h3>
              <div className="space-y-4">
                {["primaryColor", "secondaryColor"].map((field) => (
                  <ColorField
                    key={field}
                    label={FIELD_LABELS[field]}
                    value={form[field]}
                    onChange={(val) => updateField(field, val)}
                    derived={DERIVED_FIELDS.includes(field)}
                    locked={!!lockedFields[field]}
                    onToggleLock={() => toggleLock(field)}
                  />
                ))}
              </div>
            </div>

            <div className="content-card">
              <h3 className="text-base font-semibold text-gray-800 mb-4">Sidebar &amp; Navigation</h3>
              <div className="space-y-4">
                {["sidebarActiveGradientFrom", "sidebarActiveGradientTo"].map((field) => (
                  <ColorField
                    key={field}
                    label={FIELD_LABELS[field]}
                    value={form[field]}
                    onChange={(val) => updateField(field, val)}
                    derived={DERIVED_FIELDS.includes(field)}
                    locked={!!lockedFields[field]}
                    onToggleLock={() => toggleLock(field)}
                  />
                ))}
                <div
                  className="h-10 flex items-center px-4 text-sm font-medium"
                  style={{
                    background: form.sidebarActiveGradientFrom,
                    borderLeft: `4px solid ${form.sidebarActiveGradientTo}`,
                    color: readableInk(form.sidebarActiveGradientFrom),
                    borderRadius: "var(--radius-lg)",
                  }}
                >
                  Active menu item preview
                </div>
              </div>
            </div>

            <div className="content-card">
              <h3 className="text-base font-semibold text-gray-800 mb-4">Table Headers</h3>
              <div className="space-y-4">
                {["tableHeaderGradientFrom", "tableHeaderGradientTo"].map((field) => (
                  <ColorField
                    key={field}
                    label={FIELD_LABELS[field]}
                    value={form[field]}
                    onChange={(val) => updateField(field, val)}
                    derived={DERIVED_FIELDS.includes(field)}
                    locked={!!lockedFields[field]}
                    onToggleLock={() => toggleLock(field)}
                  />
                ))}
              </div>
            </div>

            <div className="content-card">
              <h3 className="text-base font-semibold text-gray-800 mb-4">Buttons</h3>
              <div className="space-y-4">
                {["buttonPrimaryBg", "buttonPrimaryHover"].map((field) => (
                  <ColorField
                    key={field}
                    label={FIELD_LABELS[field]}
                    value={form[field]}
                    onChange={(val) => updateField(field, val)}
                    derived={DERIVED_FIELDS.includes(field)}
                    locked={!!lockedFields[field]}
                    onToggleLock={() => toggleLock(field)}
                  />
                ))}
              </div>
            </div>

            <div className="content-card">
              <h3 className="text-base font-semibold text-gray-800 mb-4">Surfaces</h3>
              <div className="space-y-4">
                {["pageBg", "surfaceCard", "borderColor"].map((field) => (
                  <ColorField
                    key={field}
                    label={FIELD_LABELS[field]}
                    value={form[field]}
                    onChange={(val) => updateField(field, val)}
                    derived={DERIVED_FIELDS.includes(field)}
                    locked={!!lockedFields[field]}
                    onToggleLock={() => toggleLock(field)}
                  />
                ))}
              </div>
            </div>

            <div className="content-card">
              <h3 className="text-base font-semibold text-gray-800 mb-4">Status Colours</h3>
              <div className="grid grid-cols-2 gap-4">
                {["successColor", "warningColor", "errorColor", "infoColor"].map((field) => (
                  <ColorField
                    key={field}
                    label={FIELD_LABELS[field]}
                    value={form[field]}
                    onChange={(val) => updateField(field, val)}
                    derived={DERIVED_FIELDS.includes(field)}
                    locked={!!lockedFields[field]}
                    onToggleLock={() => toggleLock(field)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function ColorField({ label, value, onChange, derived = false, locked = false, onToggleLock }) {
  const [showSwatches, setShowSwatches] = useState(false);

  const SWATCHES = [
    "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626", "#b91c1c", "#991b1b", "#7f1d1d",
    "#fed7aa", "#fdba74", "#fb923c", "#f97316", "#ea580c", "#c2410c", "#9a3412", "#7c2d12",
    "#fde68a", "#fcd34d", "#fbbf24", "#f59e0b", "#d97706", "#b45309", "#92400e", "#78350f",
    "#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#166534", "#14532d",
    "#a7f3d0", "#6ee7b7", "#34d399", "#10b981", "#059669", "#047857", "#065f46", "#064e3b",
    "#99f6e4", "#5eead4", "#2dd4bf", "#14b8a6", "#0d9488", "#0f766e", "#115e59", "#134e4a",
    "#a5f3fc", "#67e8f9", "#22d3ee", "#06b6d4", "#0891b2", "#0e7490", "#155e75", "#164e63",
    "#bae6fd", "#7dd3fc", "#38bdf8", "#0ea5e9", "#0284c7", "#0369a1", "#075985", "#0c4a6e",
    "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a",
    "#c7d2fe", "#a5b4fc", "#818cf8", "#6366f1", "#4f46e5", "#4338ca", "#3730a3", "#312e81",
    "#ddd6fe", "#c4b5fd", "#a78bfa", "#8b5cf6", "#7c3aed", "#6d28d9", "#5b21b6", "#4c1d95",
    "#fbcfe8", "#f9a8d4", "#f472b6", "#ec4899", "#db2777", "#be185d", "#9d174d", "#831843",
    "#ffffff", "#f9fafb", "#f3f4f6", "#e5e7eb", "#d1d5db", "#9ca3af", "#6b7280", "#4b5563",
    "#374151", "#1f2937", "#111827", "#0f172a", "#1e293b", "#334155", "#475569", "#64748b",
  ];

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
        <span>{label}</span>
        {derived && (
          <button
            type="button"
            onClick={onToggleLock}
            title={
              locked
                ? "Pinned. Changing the primary colour will not touch this."
                : "Follows the primary colour. Click to pin it."
            }
            className={`text-[10px] px-1.5 py-0.5 rounded-full border transition ${
              locked ? "theme-badge-soft" : "border-gray-200 text-gray-400 hover:text-gray-600"
            }`}
          >
            {locked ? "Pinned" : "Auto"}
          </button>
        )}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 border-2 border-gray-200 cursor-pointer p-0.5 shrink-0"
          style={{ borderRadius: "var(--radius-lg)" }}
        />
        <div
          className="flex-1 h-10 border flex items-center px-3 cursor-pointer hover:bg-gray-50 transition"
          style={{ borderColor: "var(--border-subtle)", borderRadius: "var(--radius-lg)" }}
          onClick={() => setShowSwatches(!showSwatches)}
        >
          <div className="w-5 h-5 rounded-full border border-gray-300 mr-2 shrink-0" style={{ backgroundColor: value }} />
          <span className="text-sm font-mono text-gray-700">{value}</span>
          <svg
            className={`w-4 h-4 ml-auto text-gray-400 transition-transform ${showSwatches ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      {showSwatches && (
        <div
          className="grid grid-cols-8 gap-1 p-2 border max-h-40 overflow-y-auto"
          style={{ background: "var(--surface-card-alt)", borderColor: "var(--border-subtle)", borderRadius: "var(--radius-lg)" }}
        >
          {SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => {
                onChange(color);
                setShowSwatches(false);
              }}
              className={`w-full aspect-square rounded-md border-2 transition-all hover:scale-110 ${
                value === color ? "border-gray-900 ring-1 ring-gray-900 scale-110" : "border-transparent hover:border-gray-400"
              }`}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      )}
    </div>
  );
}
