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

function isNumberInput(target) {
  return target instanceof HTMLInputElement && target.type === "number";
}

function buildNextValue(target, nextChunk) {
  const currentValue = String(target.value || "");
  const selectionStart = target.selectionStart ?? currentValue.length;
  const selectionEnd = target.selectionEnd ?? currentValue.length;
  return `${currentValue.slice(0, selectionStart)}${nextChunk}${currentValue.slice(selectionEnd)}`;
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
  if (!/^-?\d*(\.\d*)?$/.test(nextValue)) {
    event.preventDefault();
  }
}

export function handleNumberInputPaste(event) {
  if (!isNumberInput(event.target)) {
    return;
  }

  const pastedText = event.clipboardData?.getData("text") || "";
  const nextValue = buildNextValue(event.target, pastedText);
  if (!/^-?\d*(\.\d*)?$/.test(nextValue)) {
    event.preventDefault();
  }
}