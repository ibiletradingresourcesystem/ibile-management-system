const HOTEL_BRAND_NAME = "St Michael's Hotel";
const HOTEL_BRAND_SIGNATURE = "Reservations Desk";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderActionButton(action, muted = false) {
  if (!action?.href || !action?.label) {
    return "";
  }

  const background = muted
    ? "rgba(255,255,255,0.08)"
    : "linear-gradient(180deg,#e5c372,#bc8522)";
  const color = muted ? "#f5eee2" : "#1b1b18";
  const border = muted ? "1px solid rgba(255,255,255,0.16)" : "1px solid rgba(117,78,19,0.2)";

  return `
    <a href="${escapeHtml(action.href)}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:${background};color:${color};text-decoration:none;font-weight:700;border:${border};margin-right:${muted ? 0 : 10}px;margin-bottom:10px;">
      ${escapeHtml(action.label)}
    </a>
  `;
}

function renderRows(rows = []) {
  const safeRows = rows.filter((row) => row?.label && row?.value);
  if (!safeRows.length) {
    return "";
  }

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;border-collapse:separate;border-spacing:0 10px;">
      ${safeRows
        .map(
          (row) => `
            <tr>
              <td style="width:38%;padding:12px 14px;border-radius:14px;background:rgba(255,250,243,0.08);color:rgba(245,238,226,0.7);font-size:13px;letter-spacing:0.12em;text-transform:uppercase;vertical-align:top;">${escapeHtml(row.label)}</td>
              <td style="padding:12px 14px;border-radius:14px;background:rgba(255,255,255,0.08);color:#fff3df;font-size:14px;font-weight:600;vertical-align:top;">${escapeHtml(row.value)}</td>
            </tr>
          `
        )
        .join("")}
    </table>
  `;
}

export function createHotelEmailHtml({
  eyebrow,
  title,
  greeting,
  intro,
  rows = [],
  primaryAction,
  secondaryAction,
  closing,
}) {
  return `<!doctype html>
  <html lang="en">
    <body style="margin:0;padding:24px;background:#f7f0e3;font-family:Segoe UI,Arial,sans-serif;color:#16363c;">
      <div style="max-width:680px;margin:0 auto;overflow:hidden;border-radius:28px;background:linear-gradient(145deg,rgba(19,25,29,0.98),rgba(11,16,20,0.96) 54%,rgba(35,47,44,0.94) 100%);border:1px solid rgba(216,172,79,0.18);box-shadow:0 32px 80px rgba(7,13,16,0.22);">
        <div style="padding:18px 28px;border-bottom:1px solid rgba(216,172,79,0.14);background:linear-gradient(90deg,rgba(34,24,9,0.96),rgba(67,49,18,0.94) 48%,rgba(28,42,40,0.92));color:#f7ecd7;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;">
          ${escapeHtml(eyebrow || HOTEL_BRAND_NAME)}
        </div>
        <div style="padding:32px 28px 30px;">
          <div style="display:inline-block;padding:8px 14px;border-radius:999px;background:rgba(216,172,79,0.12);border:1px solid rgba(216,172,79,0.34);color:#f6d48a;font-size:12px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;">${escapeHtml(HOTEL_BRAND_NAME)}</div>
          <h1 style="margin:18px 0 0;color:#fff3df;font-size:34px;line-height:1.08;font-family:Georgia,Segoe UI,serif;">${escapeHtml(title)}</h1>
          ${greeting ? `<p style="margin:18px 0 0;color:#fff3df;font-size:16px;line-height:1.8;">${escapeHtml(greeting)}</p>` : ""}
          <p style="margin:14px 0 0;color:rgba(245,238,226,0.8);font-size:15px;line-height:1.9;">${escapeHtml(intro)}</p>
          ${renderRows(rows)}
          <div style="margin-top:26px;">${renderActionButton(primaryAction)}${renderActionButton(secondaryAction, true)}</div>
          <p style="margin:20px 0 0;color:rgba(245,238,226,0.78);font-size:14px;line-height:1.8;">${escapeHtml(closing || `Thank you for choosing ${HOTEL_BRAND_NAME}.`)}</p>
          <p style="margin:16px 0 0;color:#fff3df;font-size:14px;font-weight:700;line-height:1.7;">${escapeHtml(HOTEL_BRAND_SIGNATURE)}<br />${escapeHtml(HOTEL_BRAND_NAME)}</p>
        </div>
      </div>
    </body>
  </html>`;
}

export { HOTEL_BRAND_NAME };