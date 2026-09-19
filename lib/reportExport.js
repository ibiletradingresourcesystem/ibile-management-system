/**
 * Unified report export.
 *
 * Before this, every page built its own CSV by hand: some quoted fields, some
 * did not (so a product name with a comma silently shifted every column after
 * it), filenames followed no pattern, and nothing carried the business name.
 * PDFs and print views looked different on each page too.
 *
 * Everything downloadable now goes through here, so a CSV, an Excel file, a
 * printed page and a PDF from any page share one header block styled after the
 * company memo: the accent sidebar strip, the logo, the business details and a
 * title / period / generated-on line.
 *
 *   import { exportReport, printReport } from "@/lib/reportExport";
 *
 *   exportReport({
 *     format: "csv",
 *     title: "Stock Movement",
 *     subtitle: "All locations",
 *     period: "1 Jan 2026 – 31 Jan 2026",
 *     columns: [
 *       { key: "name",  label: "Product" },
 *       { key: "qty",   label: "Qty",   align: "right", type: "number" },
 *       { key: "total", label: "Total", align: "right", type: "currency" },
 *     ],
 *     rows,
 *     totals: { name: "Total", total: 154000 },
 *   });
 */

/* ─── Business profile ─────────────────────────────────────────────
   Cached in sessionStorage so a report never blocks on a network call. */

const PROFILE_KEY = "_report_business_profile";

const FALLBACK_PROFILE = {
  businessName: "Ibile Mart",
  companyDisplayName: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  regNumber: "",
  taxNumber: "",
  logo: "/images/logo.png",
  currency: "₦",
};

export function getCachedBusinessProfile() {
  if (typeof window === "undefined") return FALLBACK_PROFILE;
  try {
    const raw = sessionStorage.getItem(PROFILE_KEY);
    if (raw) return { ...FALLBACK_PROFILE, ...JSON.parse(raw) };
  } catch {}
  return FALLBACK_PROFILE;
}

export async function loadBusinessProfile() {
  if (typeof window === "undefined") return FALLBACK_PROFILE;
  try {
    const cached = sessionStorage.getItem(PROFILE_KEY);
    if (cached) return { ...FALLBACK_PROFILE, ...JSON.parse(cached) };
  } catch {}

  try {
    const res = await fetch("/api/setup/get");
    const data = await res.json();
    const store = data?.store || data || {};
    const profile = {
      businessName:
        store.companyDisplayName || store.companyName || store.storeName || FALLBACK_PROFILE.businessName,
      companyDisplayName: store.companyDisplayName || "",
      address: store.companyAddress || store.locations?.[0]?.address || "",
      phone: store.storePhone || store.locations?.[0]?.phone || "",
      email: store.email || store.locations?.[0]?.email || "",
      website: store.website || "",
      regNumber: store.companyRegNumber || "",
      taxNumber: store.taxNumber || "",
      logo: store.logo || FALLBACK_PROFILE.logo,
      currency: store.currency || FALLBACK_PROFILE.currency,
    };
    try {
      sessionStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {}
    return profile;
  } catch {
    return FALLBACK_PROFILE;
  }
}

export function clearBusinessProfileCache() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PROFILE_KEY);
  } catch {}
}

/* ─── Formatting ──────────────────────────────────────────────────── */

const NAIRA = "₦";

export function formatCellValue(value, type, currency = NAIRA) {
  if (value === null || value === undefined) return "";
  switch (type) {
    case "currency": {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return `${currency}${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return n.toLocaleString("en-NG");
    }
    case "percent": {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return `${n.toFixed(1)}%`;
    }
    case "date": {
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) return String(value);
      return d.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
    }
    case "datetime": {
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) return String(value);
      return d.toLocaleString("en-NG", { timeZone: "Africa/Lagos" });
    }
    default:
      return String(value);
  }
}

/** Raw value for a column, honouring a `value(row)` accessor. */
function cellOf(row, column) {
  if (typeof column.value === "function") return column.value(row);
  const key = column.key;
  if (!key) return "";
  if (!key.includes(".")) return row?.[key];
  return key.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), row);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** RFC 4180 quoting. Every field is quoted, so commas and newlines survive. */
function csvField(value) {
  const str = value === null || value === undefined ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function slugify(text) {
  return String(text || "report")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function buildFileName(title, extension) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${slugify(title)}-${stamp}.${extension}`;
}

function generatedOn() {
  return new Date().toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    dateStyle: "long",
    timeStyle: "short",
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoking immediately can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ─── The shared memo-styled document ─────────────────────────────── */

function accentColor() {
  if (typeof document === "undefined") return "#0284c7";
  const value = getComputedStyle(document.documentElement).getPropertyValue("--accent");
  return (value || "").trim() || "#0284c7";
}

function reportStyles(accent) {
  return `
    @page { size: A4; margin: 14mm 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      color: #111827;
      margin: 0;
      padding: 0;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .memo-sheet { position: relative; padding: 0 0 0 14mm; min-height: 100%; }
    .memo-strip {
      position: fixed; top: 0; left: 0; bottom: 0; width: 9mm;
      background: ${accent}; opacity: 0.16;
    }
    .memo-strip-line {
      position: fixed; top: 0; left: 9mm; bottom: 0; width: 1.6mm; background: ${accent};
    }
    .memo-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 16px; padding-bottom: 12px; margin-bottom: 18px;
      border-bottom: 2px solid ${accent};
    }
    .memo-brand h1 { font-size: 19px; margin: 0 0 2px; letter-spacing: 0.2px; color: #0f172a; }
    .memo-brand p { margin: 1px 0; font-size: 10.5px; color: #4b5563; line-height: 1.45; }
    .memo-logo { max-height: 62px; max-width: 190px; object-fit: contain; }
    .memo-title-block { margin-bottom: 14px; }
    .memo-title {
      font-size: 15px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 1.1px; color: ${accent}; margin: 0 0 3px;
    }
    .memo-subtitle { font-size: 11.5px; color: #374151; margin: 0 0 2px; }
    .memo-meta { font-size: 10px; color: #6b7280; margin: 0; }
    .memo-summary {
      display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px;
    }
    .memo-summary-item {
      border: 1px solid #e5e7eb; border-left: 3px solid ${accent};
      padding: 7px 12px; min-width: 130px; background: #fafafa;
    }
    .memo-summary-item span { display: block; font-size: 9px; text-transform: uppercase;
      letter-spacing: 0.6px; color: #6b7280; margin-bottom: 2px; }
    .memo-summary-item strong { font-size: 13px; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    th {
      background: ${accent}; color: #ffffff; text-align: left;
      padding: 7px 8px; font-weight: 600; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.4px;
      border: 1px solid ${accent};
    }
    td { padding: 6px 8px; border: 1px solid #e5e7eb; vertical-align: top; color: #1f2937; }
    tbody tr:nth-child(even) td { background: #f8fafc; }
    tfoot td {
      font-weight: 700; background: #f1f5f9; color: #0f172a;
      border-top: 2px solid ${accent};
    }
    .align-right { text-align: right; }
    .align-center { text-align: center; }
    .memo-footer {
      margin-top: 22px; padding-top: 10px; border-top: 1px solid #e5e7eb;
      font-size: 9px; color: #6b7280; display: flex; justify-content: space-between; gap: 12px;
    }
    .memo-note { margin-top: 14px; font-size: 10px; color: #4b5563; line-height: 1.5; }
    .memo-empty { padding: 28px; text-align: center; color: #9ca3af; font-size: 12px;
      border: 1px dashed #d1d5db; }
    @media print { .no-print { display: none !important; } }
  `;
}

function headerHtml(profile, { title, subtitle, period, summary }) {
  const lines = [
    profile.address,
    [profile.phone, profile.email].filter(Boolean).join("  •  "),
    [profile.website, profile.regNumber && `RC ${profile.regNumber}`].filter(Boolean).join("  •  "),
  ].filter(Boolean);

  const summaryHtml = Array.isArray(summary) && summary.length
    ? `<div class="memo-summary">${summary
        .map(
          (item) =>
            `<div class="memo-summary-item"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(
              item.value
            )}</strong></div>`
        )
        .join("")}</div>`
    : "";

  return `
    <div class="memo-strip"></div>
    <div class="memo-strip-line"></div>
    <div class="memo-header">
      <div class="memo-brand">
        <h1>${escapeHtml(profile.businessName)}</h1>
        ${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
      </div>
      ${profile.logo ? `<img class="memo-logo" src="${escapeHtml(profile.logo)}" alt="" />` : ""}
    </div>
    <div class="memo-title-block">
      <p class="memo-title">${escapeHtml(title)}</p>
      ${subtitle ? `<p class="memo-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      <p class="memo-meta">${period ? `Period: ${escapeHtml(period)} &nbsp;|&nbsp; ` : ""}Generated ${escapeHtml(
        generatedOn()
      )}</p>
    </div>
    ${summaryHtml}
  `;
}

function tableHtml(columns, rows, totals, currency) {
  if (!rows.length) {
    return `<div class="memo-empty">No records for this report.</div>`;
  }

  const head = columns
    .map((c) => `<th class="${c.align === "right" ? "align-right" : c.align === "center" ? "align-center" : ""}">${escapeHtml(c.label)}</th>`)
    .join("");

  const body = rows
    .map(
      (row) =>
        `<tr>${columns
          .map((c) => {
            const cls = c.align === "right" ? "align-right" : c.align === "center" ? "align-center" : "";
            return `<td class="${cls}">${escapeHtml(formatCellValue(cellOf(row, c), c.type, currency))}</td>`;
          })
          .join("")}</tr>`
    )
    .join("");

  const foot = totals
    ? `<tfoot><tr>${columns
        .map((c) => {
          const cls = c.align === "right" ? "align-right" : c.align === "center" ? "align-center" : "";
          const raw = totals[c.key];
          const text = raw === undefined || raw === null ? "" : formatCellValue(raw, c.type, currency);
          return `<td class="${cls}">${escapeHtml(text)}</td>`;
        })
        .join("")}</tr></tfoot>`
    : "";

  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`;
}

/** The full standalone HTML document — used for print, PDF and Excel export. */
export function buildReportHtml(profile, options) {
  const {
    title = "Report",
    subtitle = "",
    period = "",
    columns = [],
    rows = [],
    totals = null,
    summary = [],
    note = "",
    bodyHtml = "",
  } = options;

  const accent = options.accent || accentColor();
  const currency = profile.currency || NAIRA;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>${reportStyles(accent)}</style>
</head>
<body>
<div class="memo-sheet">
  ${headerHtml(profile, { title, subtitle, period, summary })}
  ${bodyHtml || tableHtml(columns, rows, totals, currency)}
  ${note ? `<div class="memo-note">${escapeHtml(note)}</div>` : ""}
  <div class="memo-footer">
    <span>${escapeHtml(profile.businessName)} &middot; ${escapeHtml(title)}</span>
    <span>${rows.length ? `${rows.length} record${rows.length === 1 ? "" : "s"}` : ""}</span>
  </div>
</div>
</body>
</html>`;
}

/* ─── Format writers ──────────────────────────────────────────────── */

function exportCsv(profile, options) {
  const { title, subtitle, period, columns, rows, totals, summary } = options;
  const currency = profile.currency || NAIRA;
  const lines = [];

  // Branded preamble, then a blank line, then the real table so a spreadsheet
  // still parses the data cleanly.
  lines.push([csvField(profile.businessName)].join(","));
  if (profile.address) lines.push(csvField(profile.address));
  const contact = [profile.phone, profile.email].filter(Boolean).join(" | ");
  if (contact) lines.push(csvField(contact));
  lines.push(csvField(title));
  if (subtitle) lines.push(csvField(subtitle));
  if (period) lines.push([csvField("Period"), csvField(period)].join(","));
  lines.push([csvField("Generated"), csvField(generatedOn())].join(","));
  (summary || []).forEach((item) => {
    lines.push([csvField(item.label), csvField(item.value)].join(","));
  });
  lines.push("");

  lines.push(columns.map((c) => csvField(c.label)).join(","));
  rows.forEach((row) => {
    lines.push(columns.map((c) => csvField(formatCellValue(cellOf(row, c), c.type, currency))).join(","));
  });
  if (totals) {
    lines.push(
      columns
        .map((c) => {
          const raw = totals[c.key];
          return csvField(raw === undefined || raw === null ? "" : formatCellValue(raw, c.type, currency));
        })
        .join(",")
    );
  }

  // The BOM keeps Excel from mangling ₦ and other non-ASCII characters.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, buildFileName(title, "csv"));
}

function exportExcel(profile, options) {
  const html = buildReportHtml(profile, options);
  const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  triggerDownload(blob, buildFileName(options.title, "xls"));
}

function openPrintWindow(html, { autoPrint = true } = {}) {
  const win = window.open("", "_blank", "width=1024,height=768");
  if (!win) {
    // Popup blocked — fall back to an in-page iframe so the user still gets it.
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    frame.contentWindow.focus();
    setTimeout(() => {
      frame.contentWindow.print();
      setTimeout(() => document.body.removeChild(frame), 1000);
    }, 400);
    return null;
  }

  win.document.open();
  win.document.write(html);
  win.document.close();

  if (autoPrint) {
    // Wait for the logo so it is not missing from the printed sheet.
    const start = () => setTimeout(() => { win.focus(); win.print(); }, 350);
    if (win.document.readyState === "complete") start();
    else win.onload = start;
  }
  return win;
}

/**
 * Open the branded report in a print dialog. Choosing "Save as PDF" there gives
 * a selectable-text PDF, which is why this is preferred over a canvas snapshot.
 */
export async function printReport(options) {
  const profile = await loadBusinessProfile();
  const html = buildReportHtml(profile, options);
  openPrintWindow(html, { autoPrint: true });
}

/** Render the branded report to a real PDF file via jsPDF. */
async function exportPdf(profile, options) {
  const { title, subtitle, period, columns, rows, totals, summary, note } = options;
  const currency = profile.currency || NAIRA;
  const accent = options.accent || accentColor();

  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: options.orientation || "p", unit: "mm", format: "a4" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLeft = 16;
  const marginRight = 10;
  const contentWidth = pageWidth - marginLeft - marginRight;

  const rgb = (hex) => {
    const clean = String(hex).replace("#", "");
    return [
      parseInt(clean.slice(0, 2), 16) || 2,
      parseInt(clean.slice(2, 4), 16) || 132,
      parseInt(clean.slice(4, 6), 16) || 199,
    ];
  };
  const [ar, ag, ab] = rgb(accent);

  const drawChrome = () => {
    // Memo sidebar strip
    doc.setFillColor(ar, ag, ab);
    doc.rect(0, 0, 3.2, pageHeight, "F");
    doc.setFillColor(ar, ag, ab);
    doc.setGState && doc.setGState(new doc.GState({ opacity: 0.16 }));
    doc.rect(3.2, 0, 5.5, pageHeight, "F");
    doc.setGState && doc.setGState(new doc.GState({ opacity: 1 }));
  };

  let y = 16;

  const drawHeader = () => {
    drawChrome();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text(String(profile.businessName || ""), marginLeft, y);
    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(75, 85, 99);
    [
      profile.address,
      [profile.phone, profile.email].filter(Boolean).join("  •  "),
      [profile.website, profile.regNumber && `RC ${profile.regNumber}`].filter(Boolean).join("  •  "),
    ]
      .filter(Boolean)
      .forEach((line) => {
        doc.text(String(line), marginLeft, y);
        y += 3.8;
      });

    y += 1.5;
    doc.setDrawColor(ar, ag, ab);
    doc.setLineWidth(0.6);
    doc.line(marginLeft, y, pageWidth - marginRight, y);
    y += 6;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(ar, ag, ab);
    doc.text(String(title).toUpperCase(), marginLeft, y);
    y += 5;

    if (subtitle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(55, 65, 81);
      doc.text(String(subtitle), marginLeft, y);
      y += 4;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(107, 114, 128);
    doc.text(
      `${period ? `Period: ${period}   |   ` : ""}Generated ${generatedOn()}`,
      marginLeft,
      y
    );
    y += 6;

    if (Array.isArray(summary) && summary.length) {
      const boxW = Math.min(46, contentWidth / Math.min(summary.length, 4) - 2);
      let x = marginLeft;
      summary.slice(0, 4).forEach((item) => {
        doc.setDrawColor(229, 231, 235);
        doc.setFillColor(250, 250, 250);
        doc.rect(x, y, boxW, 12, "FD");
        doc.setFillColor(ar, ag, ab);
        doc.rect(x, y, 0.9, 12, "F");
        doc.setFontSize(6);
        doc.setTextColor(107, 114, 128);
        doc.text(String(item.label).toUpperCase(), x + 2.5, y + 4);
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(15, 23, 42);
        doc.text(String(item.value), x + 2.5, y + 9);
        doc.setFont("helvetica", "normal");
        x += boxW + 2;
      });
      y += 16;
    }
  };

  drawHeader();

  // Column widths proportional to the declared weights
  const weights = columns.map((c) => c.width || (c.type === "currency" || c.type === "number" ? 1 : 1.6));
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const widths = weights.map((w) => (w / weightSum) * contentWidth);

  const drawRow = (cells, { header = false, footer = false, zebra = false } = {}) => {
    const rowHeight = 6.4;
    if (y + rowHeight > pageHeight - 16) {
      doc.addPage();
      y = 16;
      drawHeader();
      drawRow(columns.map((c) => c.label), { header: true });
    }

    if (header) {
      doc.setFillColor(ar, ag, ab);
      doc.rect(marginLeft, y, contentWidth, rowHeight, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
    } else if (footer) {
      doc.setFillColor(241, 245, 249);
      doc.rect(marginLeft, y, contentWidth, rowHeight, "F");
      doc.setTextColor(15, 23, 42);
      doc.setFont("helvetica", "bold");
    } else {
      if (zebra) {
        doc.setFillColor(248, 250, 252);
        doc.rect(marginLeft, y, contentWidth, rowHeight, "F");
      }
      doc.setTextColor(31, 41, 55);
      doc.setFont("helvetica", "normal");
    }
    doc.setFontSize(header ? 6.8 : 7.4);

    let x = marginLeft;
    cells.forEach((cell, i) => {
      const w = widths[i];
      const align = columns[i]?.align;
      const text = doc.splitTextToSize(String(cell ?? ""), w - 3)[0] || "";
      if (align === "right") doc.text(text, x + w - 1.5, y + 4.4, { align: "right" });
      else if (align === "center") doc.text(text, x + w / 2, y + 4.4, { align: "center" });
      else doc.text(text, x + 1.5, y + 4.4);
      x += w;
    });

    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.1);
    doc.line(marginLeft, y + rowHeight, pageWidth - marginRight, y + rowHeight);
    y += rowHeight;
  };

  drawRow(columns.map((c) => c.label), { header: true });

  if (!rows.length) {
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175);
    doc.text("No records for this report.", marginLeft + 2, y + 6);
    y += 12;
  } else {
    rows.forEach((row, i) => {
      drawRow(
        columns.map((c) => formatCellValue(cellOf(row, c), c.type, currency)),
        { zebra: i % 2 === 1 }
      );
    });
  }

  if (totals) {
    drawRow(
      columns.map((c) => {
        const raw = totals[c.key];
        return raw === undefined || raw === null ? "" : formatCellValue(raw, c.type, currency);
      }),
      { footer: true }
    );
  }

  if (note) {
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(75, 85, 99);
    doc.splitTextToSize(String(note), contentWidth).forEach((line) => {
      doc.text(line, marginLeft, y);
      y += 3.4;
    });
  }

  // Page numbers
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(6.5);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `${profile.businessName} · ${title}`,
      marginLeft,
      pageHeight - 8
    );
    doc.text(`Page ${p} of ${pageCount}`, pageWidth - marginRight, pageHeight - 8, { align: "right" });
  }

  doc.save(buildFileName(title, "pdf"));
}

/**
 * Export a report in the requested format.
 * @param {Object} options
 * @param {"csv"|"excel"|"pdf"|"print"} options.format
 */
export async function exportReport(options) {
  const format = (options.format || "csv").toLowerCase();
  const profile = await loadBusinessProfile();
  const normalized = {
    title: "Report",
    subtitle: "",
    period: "",
    columns: [],
    rows: [],
    totals: null,
    summary: [],
    note: "",
    ...options,
  };

  switch (format) {
    case "pdf":
      return exportPdf(profile, normalized);
    case "excel":
    case "xls":
      return exportExcel(profile, normalized);
    case "print":
      return openPrintWindow(buildReportHtml(profile, normalized), { autoPrint: true });
    case "csv":
    default:
      return exportCsv(profile, normalized);
  }
}

export default exportReport;
