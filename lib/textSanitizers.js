export function sanitizePlainText(value) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeMultilineText(value) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r/g, "")
    .trim();
}

export function sanitizeStringArray(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((value) => sanitizePlainText(value))
    .filter(Boolean);
}

export function sanitizeProperties(properties = []) {
  return (Array.isArray(properties) ? properties : [])
    .map((property) => ({
      ...property,
      propName: sanitizePlainText(property?.propName ?? property?.name ?? ""),
      propValue: sanitizePlainText(property?.propValue ?? property?.value ?? ""),
    }))
    .filter((property) => property.propName || property.propValue);
}