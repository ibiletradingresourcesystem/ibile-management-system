import { mongooseConnect } from "@/lib/mongodb";
import Asset from "@/models/Asset";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

function generateAssetTag() {
  const d = new Date();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `AST-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${rand}`;
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const { category, status, location, page = 1, limit = 50, search } = req.query;
      const filter = {};
      if (category) filter.category = category;
      if (status) filter.status = status;
      if (location) filter.location = location;
      if (search) {
        filter.$or = [
          { name: { $regex: search, $options: "i" } },
          { assetTag: { $regex: search, $options: "i" } },
          { serialNumber: { $regex: search, $options: "i" } },
          { assignedTo: { $regex: search, $options: "i" } },
        ];
      }

      const skip = (Number(page) - 1) * Number(limit);
      const [assets, total] = await Promise.all([
        Asset.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
        Asset.countDocuments(filter),
      ]);

      // Calculate depreciation for each asset
      const assetsWithDepreciation = assets.map((asset) => {
        if (asset.depreciationMethod === "Straight-Line" && asset.purchaseDate && asset.purchasePrice > 0) {
          const ageYears = (Date.now() - new Date(asset.purchaseDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
          const annualDepreciation = (asset.purchasePrice - (asset.salvageValue || 0)) / (asset.usefulLifeYears || 5);
          const totalDepreciation = Math.min(annualDepreciation * ageYears, asset.purchasePrice - (asset.salvageValue || 0));
          asset.calculatedCurrentValue = Math.max(asset.purchasePrice - totalDepreciation, asset.salvageValue || 0);
          asset.totalDepreciation = totalDepreciation;
        } else if (asset.depreciationMethod === "Declining Balance" && asset.purchaseDate && asset.purchasePrice > 0) {
          const ageYears = (Date.now() - new Date(asset.purchaseDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
          const rate = 2 / (asset.usefulLifeYears || 5);
          let value = asset.purchasePrice;
          for (let i = 0; i < Math.floor(ageYears); i++) {
            value = value * (1 - rate);
            if (value < (asset.salvageValue || 0)) { value = asset.salvageValue || 0; break; }
          }
          asset.calculatedCurrentValue = Math.max(value, asset.salvageValue || 0);
          asset.totalDepreciation = asset.purchasePrice - asset.calculatedCurrentValue;
        }
        return asset;
      });

      // Summary stats
      const totalValue = assetsWithDepreciation.reduce((s, a) => s + (a.calculatedCurrentValue || a.currentValue || a.purchasePrice || 0), 0);
      const totalPurchaseValue = assetsWithDepreciation.reduce((s, a) => s + (a.purchasePrice || 0), 0);

      return res.status(200).json({
        success: true,
        assets: assetsWithDepreciation,
        total,
        totalPages: Math.ceil(total / Number(limit)),
        summary: { totalValue, totalPurchaseValue, totalAssets: total },
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const data = req.body;
      if (!data.name || !data.category) {
        return res.status(400).json({ error: "Name and category are required" });
      }

      data.assetTag = data.assetTag || generateAssetTag();
      data.currentValue = data.currentValue || data.purchasePrice || 0;

      const asset = await Asset.create(data);
      return res.status(201).json({ success: true, asset });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(400).json({ error: "Asset tag already exists" });
      }
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
