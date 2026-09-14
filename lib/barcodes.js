/**
 * Barcode clean-up for products. A product can have several barcodes, stored as "code1, code2".
 *
 * Spreadsheets often deliver barcodes broken apart ("disjointed"):
 *   - several codes in one cell split by commas, semicolons, pipes, line breaks, or
 *     spaces/dashes/slashes between full codes
 *   - one code broken by spaces: "5012 3456 78901"
 *   - Excel artefacts: "5012345678901.0", a leading apostrophe, or unrecoverable "5.01235E+12"
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
 * @returns {{ barcodes: string[], warnings: string[] }}
 */
export function normalizeBarcodes(raw) {
  const warnings = [];
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

  return { barcodes, warnings };
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
