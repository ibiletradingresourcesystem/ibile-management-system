import { mongooseConnect } from "@/lib/mongodb";
import Vendor from "@/models/Vendor";
import { sanitizePlainText, sanitizeMultilineText } from "@/lib/textSanitizers";

// Public endpoint - no auth required (for vendor self-registration)
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  await mongooseConnect();

  try {
    const { companyName, vendorRep, repPhone, email, address, mainProduct, bankName, accountName, accountNumber, products, businessCategory } = req.body;

    if (!companyName || !repPhone) {
      return res.status(400).json({ error: "Company name and phone are required" });
    }

    // Check for duplicate
    const existing = await Vendor.findOne({ companyName: companyName.trim() });
    if (existing) {
      return res.status(400).json({ error: "A vendor with this name already exists" });
    }

    const safeProducts = Array.isArray(products) ? products.filter(p => p?.productName?.trim()) : [];
    const sanitizedProducts = safeProducts.map((product) => ({
      productName: sanitizePlainText(product?.productName),
      price: Number(product?.price) || 0,
    }));

    const vendor = await Vendor.create({
      companyName: sanitizePlainText(companyName),
      vendorRep: sanitizePlainText(vendorRep),
      repPhone: sanitizePlainText(repPhone),
      email: sanitizePlainText(email),
      address: sanitizeMultilineText(address),
      mainProduct: sanitizePlainText(mainProduct),
      businessCategory: sanitizePlainText(businessCategory),
      bankName: sanitizePlainText(bankName),
      accountName: sanitizePlainText(accountName),
      accountNumber: sanitizePlainText(accountNumber),
      vendorType: "petty-cash",
      products: sanitizedProducts,
      onboardingComplete: true,
    });

    return res.status(201).json({ success: true, vendor: { _id: vendor._id, companyName: vendor.companyName } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
