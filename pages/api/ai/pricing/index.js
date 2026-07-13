/**
 * API: /api/ai/pricing
 * 
 * GET - Generate pricing recommendation for a product
 * Query: productId (required), regenerate (optional)
 */
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { generatePricingRecommendation } from "@/lib/ai/pricingAssistant";
import Product from "@/models/Product";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  const { productId, regenerate } = req.query;
  if (!productId) return res.status(400).json({ error: "productId is required" });

  await mongooseConnect();

  try {
    const product = await Product.findById(productId).populate("category", "name").lean();
    if (!product) return res.status(404).json({ error: "Product not found" });

    const result = await generatePricingRecommendation(product, { forceRegenerate: regenerate === "true" });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
