import nodemailer from "nodemailer";

function parsePort(value, fallbackValue) {
  const parsedValue = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
}

export function createMailTransport() {
  if (process.env.SMTP_HOST && process.env.SMTP_PORT) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parsePort(process.env.SMTP_PORT, 587),
      secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            }
          : undefined,
    });
  }

  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  return null;
}

export function getMailEnvValue(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

export function getMailFromAddress(defaultLabel = "St Michael's Hotel") {
  const fromAddress =
    process.env.MAIL_FROM ||
    process.env.SMTP_FROM ||
    process.env.EMAIL_FROM ||
    process.env.FROM_EMAIL ||
    process.env.SMTP_USER ||
    process.env.EMAIL_USER;

  if (!fromAddress) return defaultLabel;
  if (fromAddress.includes("<") && fromAddress.includes(">")) return fromAddress;
  return `${defaultLabel} <${fromAddress}>`;
}