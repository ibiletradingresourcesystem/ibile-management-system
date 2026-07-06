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

function isCampaignActive(campaign, now) {
  const startDate = parseScheduleDate(campaign.startDate);
  const endDate = parseScheduleDate(campaign.endDate, true);
  return campaign.active !== false && (!startDate || startDate <= now) && (!endDate || endDate >= now);
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

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const { activeOnly } = req.query;
      const now = new Date();
      const query = activeOnly === "true" ? { active: true } : {};
      const campaigns = await Campaign.find(query).sort({ startDate: -1, createdAt: -1 }).lean();
      return res.status(200).json({
        success: true,
        campaigns: activeOnly === "true" ? campaigns.filter((campaign) => isCampaignActive(campaign, now)) : campaigns,
      });
    } catch (error) {
      console.error("Error fetching campaigns:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch campaigns" });
    }
  }

  if (req.method === "POST") {
    try {
      const payload = normalizeCampaignPayload(req.body);
      if (!payload.name || !payload.startDate || !payload.endDate) {
        return res.status(400).json({ success: false, message: "Campaign name, start date, and end date are required" });
      }

      const campaign = await Campaign.create(payload);
      return res.status(201).json({ success: true, campaign });
    } catch (error) {
      console.error("Error creating campaign:", error);
      return res.status(500).json({ success: false, message: error.message || "Failed to create campaign" });
    }
  }

  return res.status(405).json({ success: false, message: "Method not allowed" });
}