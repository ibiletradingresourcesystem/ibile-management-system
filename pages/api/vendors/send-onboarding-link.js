import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import Vendor from "@/models/Vendor";
import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  const { vendorId, method } = req.body;
  if (!vendorId) {
    return res.status(400).json({ error: "Vendor ID is required" });
  }

  try {
    await mongooseConnect();
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    // Generate onboarding token if vendor doesn't have one
    if (!vendor.onboardingToken) {
      vendor.onboardingToken = crypto.randomBytes(24).toString("hex");
      await vendor.save();
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `https://${req.headers.host}`;
    const onboardingLink = `${baseUrl}/onboarding/vendor/${vendor.onboardingToken}`;

    // Return the link for the frontend to handle sharing via WhatsApp, copy, etc.
    return res.status(200).json({
      success: true,
      link: onboardingLink,
      vendorName: vendor.companyName,
      method: method || "copy",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
