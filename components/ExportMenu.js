/**
 * One export control for every report page.
 *
 * Pages used to scatter their own "Export CSV" / "Print" buttons with different
 * labels, icons and output. This drops a single dropdown that produces the
 * branded CSV, Excel, PDF and print views from `lib/reportExport`.
 *
 *   <ExportMenu
 *     title="Stock Movement"
 *     subtitle="All locations"
 *     period="Jan 2026"
 *     columns={columns}
 *     rows={rows}
 *     totals={{ product: "Total", value: 12000 }}
 *     summary={[{ label: "Records", value: rows.length }]}
 *   />
 */
import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Printer, ChevronDown, Table2 } from "lucide-react";
import { exportReport } from "@/lib/reportExport";

const FORMATS = [
  { key: "pdf", label: "PDF document", hint: "Branded, print ready", Icon: FileText },
  { key: "csv", label: "CSV file", hint: "Opens in Excel or Sheets", Icon: Table2 },
  { key: "excel", label: "Excel file", hint: "Keeps the report layout", Icon: FileSpreadsheet },
  { key: "print", label: "Print", hint: "Opens the print dialog", Icon: Printer },
];

export default function ExportMenu({
  title,
  subtitle = "",
  period = "",
  columns = [],
  rows = [],
  totals = null,
  summary = [],
  note = "",
  orientation = "p",
  disabled = false,
  label = "Export",
  className = "",
  formats = ["pdf", "csv", "excel", "print"],
  align = "right",
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onEscape = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const run = async (format) => {
    setBusy(format);
    try {
      await exportReport({
        format,
        title,
        subtitle,
        period,
        columns,
        rows,
        totals,
        summary,
        note,
        orientation,
      });
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setBusy("");
      setOpen(false);
    }
  };

  const options = FORMATS.filter((f) => formats.includes(f.key));
  const isDisabled = disabled || !columns.length;

  return (
    <div className={`relative inline-block ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isDisabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn-action btn-action-secondary inline-flex items-center gap-2 disabled:opacity-50"
      >
        <Download size={16} />
        <span>{busy ? "Preparing…" : label}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute z-40 mt-2 w-60 overflow-hidden border shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
          style={{
            background: "var(--surface-card, #fff)",
            borderColor: "var(--border-subtle, #e5e7eb)",
            borderRadius: "var(--radius-xl)",
          }}
        >
          <p className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 border-b" style={{ borderColor: "var(--border-subtle, #e5e7eb)" }}>
            {rows.length} record{rows.length === 1 ? "" : "s"}
          </p>
          {options.map(({ key, label: optionLabel, hint, Icon }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              onClick={() => run(key)}
              disabled={!!busy}
              className="export-menu-item w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors disabled:opacity-50"
            >
              <Icon size={16} className="mt-0.5 flex-shrink-0" style={{ color: "var(--accent-text)" }} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-800">{optionLabel}</span>
                <span className="block text-xs text-gray-500">{hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
