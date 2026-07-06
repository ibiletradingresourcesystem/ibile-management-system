import { showToast } from "@/lib/dialogs";

const SUCCESS_PATTERNS = [
  "success",
  "created",
  "updated",
  "deleted",
  "saved",
  "sent",
  "completed",
  "uploaded",
  "added",
  "removed",
  "applied",
];

const WARNING_PATTERNS = [
  "required",
  "please",
  "must",
  "only admin",
  "select",
  "cannot",
  "can't",
  "warning",
];

const ERROR_PATTERNS = [
  "error",
  "failed",
  "unable",
  "invalid",
  "denied",
];

export function cleanToastText(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  return text.replace(/^[^A-Za-z0-9]+/, "").trim() || text;
}

export function inferToastToneFromText(value, fallback = "info") {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return fallback;

  if (SUCCESS_PATTERNS.some((pattern) => text.includes(pattern))) {
    return "success";
  }

  if (WARNING_PATTERNS.some((pattern) => text.includes(pattern))) {
    return "warning";
  }

  if (ERROR_PATTERNS.some((pattern) => text.includes(pattern))) {
    return "danger";
  }

  return fallback;
}

export function showToastMessage({ title, text, fallbackTone = "info" }) {
  if (!text) return;

  return showToast({
    title,
    message: cleanToastText(text),
    tone: inferToastToneFromText(text, fallbackTone),
  });
}