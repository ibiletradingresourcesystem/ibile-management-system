/**
 * Barcode clean-up for products. A product can have several barcodes, stored as "code1, code2".
 *
 * Spreadsheets often deliver barcodes broken apart ("disjointed"):
 *   - several codes in one cell split by commas, semicolons, pipes, line breaks, or
 *     spaces/dashes/slashes between full codes
 *   - one code broken by spaces: "5012 3456 78901"
 *   - Excel artefacts: "5012345678901.0", a leading apostrophe, or unrecoverable "5.01235E+12"
 *
 * normalizeBarcodes() cleans codes coming in from a file; repairStoredBarcodes() cleans what is
 * already saved on a product, so seeded products that can't be scanned can be put right.
 */

const STRONG_SEPARATORS = /[,;|\r\n\t]+/;
const SCIENTIFIC_NOTATION = /^\d+(\.\d+)?e\+?\d+$/i;
const MIN_SEPARATE_CODE_DIGITS = 8;

function cleanPiece(value) {
  return String(value)
    .replace(/[ ​-‍﻿]/g, " ")
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim();
}

/**
 * One piece may hold several full codes joined by spaces, dashes or slashes
 * ("5012345678901 / 5012345678902"), or one code broken up by spaces ("5012 3456 78901").
 * Anything else (e.g. "AG-101", "501234-U") is kept as typed.
 */
function splitJoinedCodes(piece) {
  const tokens = piece.split(/[\s/-]+/).filter(Boolean);
  if (tokens.length < 2 || !tokens.every((t) => /^\d+$/.test(t))) {
    return { codes: [piece.replace(/\s+/g, " ")] };
  }

  const longTokens = tokens.filter((t) => t.length >= MIN_SEPARATE_CODE_DIGITS).length;
  if (longTokens === tokens.length) return { codes: tokens };

  if (/^[\d\s]+$/.test(piece)) {
    if (longTokens === 0) return { codes: [tokens.join("")] };
    return {
      codes: [piece.replace(/\s+/g, " ")],
      warning: `Barcode "${piece}" looks broken (mixed long and short digit groups) — please check it`,
    };
  }

  return { codes: [piece] };
}

/**
 * @returns {{ barcodes: string[], warnings: string[], dropped: string[] }}
 *   dropped — pieces that can't be repaired. They are kept out of `barcodes` so they are never
 *   treated as a real code, but reported so a caller can preserve or flag them.
 */
export function normalizeBarcodes(raw) {
  const warnings = [];
  const dropped = [];
  const values = Array.isArray(raw) ? raw : [raw];
  const seen = new Set();
  const barcodes = [];

  for (const value of values) {
    if (value === null || value === undefined) continue;

    const text = typeof value === "number" && Number.isFinite(value)
      ? (Number.isInteger(value) ? value.toFixed(0) : String(value))
      : String(value);

    for (const rawPiece of text.split(STRONG_SEPARATORS)) {
      let piece = cleanPiece(rawPiece);
      if (!piece) continue;

      if (SCIENTIFIC_NOTATION.test(piece)) {
        warnings.push(
          `Barcode "${piece}" was shortened by Excel (scientific notation) and was skipped — format the barcode column as Text`
        );
        dropped.push(piece);
        continue;
      }

      // Excel turns numeric codes into "5012345678901.0"
      piece = piece.replace(/^(\d+)\.0+$/, "$1");

      const { codes, warning } = splitJoinedCodes(piece);
      if (warning) warnings.push(warning);

      for (const code of codes) {
        const key = code.toLowerCase();
        if (!code || seen.has(key)) continue;
        seen.add(key);
        barcodes.push(code);
      }
    }
  }

  return { barcodes, warnings, dropped };
}

/** Union of barcode lists, keeping the order each code was first seen. */
export function mergeBarcodeLists(...lists) {
  const seen = new Set();
  const merged = [];
  for (const value of lists.flat()) {
    const code = String(value ?? "").trim();
    const key = code.toLowerCase();
    if (!code || seen.has(key)) continue;
    seen.add(key);
    merged.push(code);
  }
  return merged;
}

/**
 * Repairs a barcode field that is already stored on a product, optionally merging in codes
 * from elsewhere (e.g. a seed file). Codes are never dropped: pieces that can't be repaired
 * are kept as typed and reported in `warnings` so they can be re-scanned by hand.
 *
 * @returns {{ barcode: string, codes: string[], changed: boolean, unrecoverable: string[], warnings: string[] }}
 */
export function repairStoredBarcodes(stored, extraCodes = []) {
  const current = String(stored ?? "").trim();
  const { barcodes, warnings, dropped } = normalizeBarcodes(current);
  const codes = mergeBarcodeLists(barcodes, extraCodes, dropped);
  const barcode = formatBarcodes(codes);

  // The "skipped" warnings from normalizeBarcodes don't apply here — those pieces are kept.
  const notes = warnings
    .filter((warning) => !dropped.some((code) => warning.includes(code)))
    .concat(
      dropped.map(
        (code) => `Barcode "${code}" was shortened by a spreadsheet and can't be repaired — re-scan the item`
      )
    );

  return { barcode, codes, changed: barcode !== current, unrecoverable: dropped, warnings: notes };
}

/** Suffixes every code in a barcode field: ("5012345678901, 5012345678902", "-U") → "5012345678901-U, 5012345678902-U". */
export function suffixBarcodes(stored, suffix) {
  return formatBarcodes(splitStoredBarcodes(stored).map((code) => `${code}${suffix}`));
}

export function formatBarcodes(barcodes = []) {
  return barcodes.filter(Boolean).join(", ");
}

/** Barcodes held in a product's stored barcode field. */
export function splitStoredBarcodes(value) {
  return normalizeBarcodes(value).barcodes;
}

/** A cell that is clearly a barcode (used to repair CSV rows where barcodes spilled into later columns). */
export function looksLikeBarcode(value) {
  const text = cleanPiece(value ?? "");
  return /^\d{6,}(\.0+)?$/.test(text) || /^[A-Za-z0-9-]*\d{8,}[A-Za-z0-9-]*$/.test(text);
}
