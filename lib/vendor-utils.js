import crypto from "crypto";
import { PETTY_CASH_VENDOR_TYPE, STOCK_VENDOR_TYPE } from "./petty-cash";

export function normalizeVendorType(type) {
  if (!type) return STOCK_VENDOR_TYPE;
  const lowered = String(type).toLowerCase().trim();
  if (lowered === "petty-cash" || lowered === "pettycash") return PETTY_CASH_VENDOR_TYPE;
  return STOCK_VENDOR_TYPE;
}

export function getVendorTypeFilter(type) {
  const normalized = normalizeVendorType(type);
  return { vendorType: normalized };
}

export function buildVendorFields(body) {
  const {
    companyName,
    vendorRep,
    repPhone,
    email,
    address,
    mainProduct,
    businessCategory,
    bankName,
    accountName,
    accountNumber,
    vendorType,
    products,
  } = body || {};

  const fields = {};
  if (companyName !== undefined) fields.companyName = String(companyName).trim();
  if (vendorRep !== undefined) fields.vendorRep = String(vendorRep).trim();
  if (repPhone !== undefined) fields.repPhone = String(repPhone).trim();
  if (email !== undefined) fields.email = String(email).trim().toLowerCase();
  if (address !== undefined) fields.address = String(address).trim();
  if (mainProduct !== undefined) fields.mainProduct = String(mainProduct).trim();
  if (businessCategory !== undefined) fields.businessCategory = String(businessCategory).trim();
  if (bankName !== undefined) fields.bankName = String(bankName).trim();
  if (accountName !== undefined) fields.accountName = String(accountName).trim();
  if (accountNumber !== undefined) fields.accountNumber = String(accountNumber).trim();
  if (vendorType !== undefined) fields.vendorType = normalizeVendorType(vendorType);
  if (Array.isArray(products)) fields.products = products;

  return fields;
}

export function createVendorOnboardingToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function getRequestBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

export function buildPettyCashOnboardingLink(baseUrl, token) {
  return `${baseUrl}/petty-cash-onboarding/${token}`;
}

export function buildPettyCashInvitationMessage(vendorName, link) {
  return (
    `Hello ${vendorName},\n\n` +
    `You are invited to register as a petty cash vendor. ` +
    `Please complete your registration here:\n${link}\n\n` +
    `This link is unique to you. Thank you.`
  );
}
