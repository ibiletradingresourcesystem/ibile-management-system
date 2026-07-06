import { mongooseConnect } from "@/lib/mongodb";
import Vendor from "@/models/Vendor";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { syncProductVendorAssignmentsForVendor } from "@/lib/vendorProductSync";
import { sanitizeMultilineText, sanitizePlainText } from "@/lib/textSanitizers";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const { active, vendorType } = req.query;
      const filter = {};
      if (active === "true") filter.isActive = true;
      if (vendorType) filter.vendorType = vendorType;
      const vendors = await Vendor.find(filter).populate("products.product", "name costPrice salePriceIncTax packType qtyPerPack barcode").sort({ companyName: 1 }).lean();
      return res.status(200).json({ success: true, vendors });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const { companyName, vendorRep, repPhone, email, address, mainProduct, bankName, accountName, accountNumber, products, vendorType, businessCategory } = req.body;

      if (!companyName) {
        return res.status(400).json({ error: "Company name is required" });
      }

      const safeProducts = Array.isArray(products) ? products : [];
      const sanitizedProducts = safeProducts.map((product) => ({
        ...product,
        productName: sanitizePlainText(product?.productName),
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
        vendorType: vendorType || "stock",
        products: sanitizedProducts,
      });

      await syncProductVendorAssignmentsForVendor({
        vendorId: vendor._id,
        previousProducts: [],
        nextProducts: sanitizedProducts,
      });

      return res.status(201).json({ success: true, vendor, createdChildren: [] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
