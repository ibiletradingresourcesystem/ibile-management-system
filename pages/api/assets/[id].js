import { mongooseConnect } from "@/lib/mongodb";
import Asset from "@/models/Asset";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { isValidObjectId } from "mongoose";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  const { id } = req.query;
  if (!isValidObjectId(id)) {
    return res.status(400).json({ error: "Invalid asset ID" });
  }

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const asset = await Asset.findById(id).lean();
      if (!asset) return res.status(404).json({ error: "Asset not found" });
      return res.status(200).json({ success: true, asset });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "PUT") {
    try {
      const { action } = req.body;

      // Add maintenance record
      if (action === "add-maintenance") {
        const { date, description, cost, performedBy, nextMaintenanceDate } = req.body;
        const asset = await Asset.findById(id);
        if (!asset) return res.status(404).json({ error: "Asset not found" });

        asset.maintenanceHistory.push({
          date: date || new Date(),
          description,
          cost: cost || 0,
          performedBy: performedBy || "",
          nextMaintenanceDate: nextMaintenanceDate || null,
        });

        const totalMaintCost = asset.maintenanceHistory.reduce((s, m) => s + (m.cost || 0), 0);
        await asset.save();
        return res.status(200).json({ success: true, asset, totalMaintenanceCost: totalMaintCost });
      }

      // Dispose asset
      if (action === "dispose") {
        const { disposalReason, disposalValue } = req.body;
        const asset = await Asset.findByIdAndUpdate(
          id,
          {
            status: "Disposed",
            disposalDate: new Date(),
            disposalReason: disposalReason || "",
            disposalValue: disposalValue || 0,
          },
          { new: true }
        );
        if (!asset) return res.status(404).json({ error: "Asset not found" });
        return res.status(200).json({ success: true, asset });
      }

      // General update
      const asset = await Asset.findByIdAndUpdate(id, req.body, { new: true });
      if (!asset) return res.status(404).json({ error: "Asset not found" });
      return res.status(200).json({ success: true, asset });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    try {
      const asset = await Asset.findByIdAndDelete(id);
      if (!asset) return res.status(404).json({ error: "Asset not found" });
      return res.status(200).json({ success: true, message: "Asset deleted" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
