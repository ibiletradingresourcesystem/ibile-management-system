import { mongooseConnect } from "@/lib/mongodb";
import Campaign from "@/models/Campaign";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

function parseScheduleDate(value, endOfDay = false) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0));
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay && date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}

function normalizeCampaignPayload(body) {
  return {
    name: String(body.name || "").trim(),
    description: String(body.description || "").trim(),
    discount: Number(body.discount) || 0,
    targetCustomers: body.targetCustomers || "all",
    targetCategories: body.targetCategories || "all",
    targetProducts: body.targetProducts || "all",
    targetLocations: body.targetLocations || "all",
    startDate: parseScheduleDate(body.startDate),
    endDate: parseScheduleDate(body.endDate, true),
    active: body.active !== false,
  };
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  }

  const { id } = req.query;
  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const campaign = await Campaign.findById(id).lean();
      if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });
      return res.status(200).json({ success: true, campaign });
    } catch (error) {
      console.error("Error fetching campaign:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch campaign" });
    }
  }

  if (req.method === "PUT") {
    try {
      const payload = normalizeCampaignPayload(req.body);
      if (!payload.name || !payload.startDate || !payload.endDate) {
        return res.status(400).json({ success: false, message: "Campaign name, start date, and end date are required" });
      }

      const campaign = await Campaign.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
      if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });
      return res.status(200).json({ success: true, campaign });
    } catch (error) {
      console.error("Error updating campaign:", error);
      return res.status(500).json({ success: false, message: error.message || "Failed to update campaign" });
    }
  }

  if (req.method === "DELETE") {
    try {
      const campaign = await Campaign.findByIdAndDelete(id);
      if (!campaign) return res.status(404).json({ success: false, message: "Campaign not found" });
      return res.status(200).json({ success: true, message: "Campaign deleted successfully" });
    } catch (error) {
      console.error("Error deleting campaign:", error);
      return res.status(500).json({ success: false, message: error.message || "Failed to delete campaign" });
    }
  }

  return res.status(405).json({ success: false, message: "Method not allowed" });
}