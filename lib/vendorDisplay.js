export function formatVendorMovementLabel(vendorName) {
  const normalizedVendorName = String(vendorName || "").trim();
  return normalizedVendorName ? `Vendor (${normalizedVendorName})` : "Vendor";
}