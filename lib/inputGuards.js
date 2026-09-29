/**
 * Guards for number inputs, applied once in _app.js rather than field by field.
 *
 * Two things they stop: a scroll wheel quietly changing a figure the cursor is
 * resting on, and a keystroke that cannot belong to a number.
 *
 * Pasting used to be stopped as well — anything that was not already a bare
 * number was cancelled, so a figure copied from a bank statement or a spreadsheet
 * ("₦1,250.50", "1,250", "(2,400)") simply would not go in, and had to be retyped.
 * A paste is now read for the number inside it and that number is what lands in
 * the field; only text with no number in it at all is turned away.
 */
const NUMBER_CONTROL_KEYS = new Set([
  "Backspace",
  "Delete",
  "Tab",
  "Enter",
  "Escape",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

/** What a number field will hold: digits, one decimal point, an optional minus. */
const VALID_NUMBER = /^-?\d*(\.\d*)?$/;

function isNumberInput(target) {
  return target instanceof HTMLInputElement && target.type === "number";
}

function buildNextValue(target, nextChunk) {
  const currentValue = String(target.value || "");
  const selectionStart = target.selectionStart ?? currentValue.length;
  const selectionEnd = target.selectionEnd ?? currentValue.length;
  return `${currentValue.slice(0, selectionStart)}${nextChunk}${currentValue.slice(selectionEnd)}`;
}

/**
 * The number inside a piece of pasted text, or null when there is none.
 *
 * Handles what people actually copy: a currency sign, thousands separators,
 * stray spaces, a trailing percent, and accounting brackets for a negative.
 * Deliberately strict about what it will call a number — "12 bags" is not one,
 * because silently reading it as 12 would be worse than refusing it.
 */
export function readPastedNumber(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;

  // The sign comes off first, so ₦(900) is recognised as bracketed too.
  const unsigned = raw
    .replace(/[₦$£€¥]/g, "")
    .replace(/(NGN|USD|GBP|EUR)/gi, "")
    .trim();

  // (1,250) is how a statement writes a negative.
  const bracketed = /^\((.*)\)$/.test(unsigned);
  const withoutBrackets = bracketed ? unsigned.slice(1, -1) : unsigned;

  const negative = bracketed || /^-/.test(withoutBrackets.trim());
  // Currency signs, spaces (including the non-breaking kind), thousands commas
  // and a trailing percent all come off; nothing else may.
  const stripped = withoutBrackets
    .replace(/^[-+]/, "")
    .replace(/[₦$£€¥]/g, "")
    .replace(/(NGN|USD|GBP|EUR)/gi, "")
    .replace(/%$/, "")
    .replace(/[\s ]/g, "")
    .replace(/,/g, "");

  if (!/^\d*\.?\d*$/.test(stripped)) return null;
  if (!/\d/.test(stripped)) return null;

  const cleaned = `${negative ? "-" : ""}${stripped}`;
  return VALID_NUMBER.test(cleaned) ? cleaned : null;
}

/**
 * Write a value into a React-controlled input so React notices.
 * Setting `.value` on its own is invisible to React; the native setter plus an
 * input event is what makes the change reach the component holding the state.
 */
function setControlledValue(target, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(target, value);
  else target.value = value;
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

export function handleNumberInputWheel(event) {
  if (!isNumberInput(event.target)) {
    return;
  }

  event.preventDefault();
  if (document.activeElement === event.target) {
    event.target.blur();
  }
}

export function handleNumberInputKeyDown(event) {
  if (!isNumberInput(event.target)) {
    return;
  }

  if (event.ctrlKey || event.metaKey || event.altKey || NUMBER_CONTROL_KEYS.has(event.key)) {
    return;
  }

  if (!/^[0-9.-]$/.test(event.key)) {
    event.preventDefault();
    return;
  }

  const nextValue = buildNextValue(event.target, event.key);
  if (!VALID_NUMBER.test(nextValue)) {
    event.preventDefault();
  }
}

export function handleNumberInputPaste(event) {
  if (!isNumberInput(event.target)) {
    return;
  }

  const pastedText = event.clipboardData?.getData("text") || "";
  const cleaned = readPastedNumber(pastedText);

  // No number in it: leave the field as it was.
  if (cleaned === null) {
    event.preventDefault();
    return;
  }

  // Already a bare number, and it fits where it is going: let the browser paste it.
  if (cleaned === pastedText.trim() && VALID_NUMBER.test(buildNextValue(event.target, cleaned))) {
    return;
  }

  const target = event.target;
  const nextValue = buildNextValue(target, cleaned);
  event.preventDefault();

  // A whole number pasted over a selection replaces it; one that would leave the
  // field nonsense (a second minus, a second point) replaces the field instead.
  const finalValue = VALID_NUMBER.test(nextValue) ? nextValue : cleaned;
  setControlledValue(target, finalValue);

  // Leave the cursor after what was just pasted.
  const caret = VALID_NUMBER.test(nextValue)
    ? (target.selectionStart ?? 0) + cleaned.length
    : finalValue.length;
  if (typeof target.setSelectionRange === "function") {
    try {
      target.setSelectionRange(caret, caret);
    } catch {
      // A number input refuses selection in some browsers; the value is what matters.
    }
  }
}
