import { mongooseConnect } from "@/lib/mongodb";
import Hero from "@/models/Hero";
import "@/models/Campaign";
import "@/models/Promotion";

const SOCIAL_SCOPES = new Set(["warehouse", "hotel", "both"]);

function normalizeSocialScope(value) {
  const scope = String(value || "").trim().toLowerCase();
  if (scope === "ecommerce" || scope === "store") return "warehouse";
  if (scope === "web" || scope === "all") return "both";
  return SOCIAL_SCOPES.has(scope) ? scope : "warehouse";
}

function normalizeSocialLinks(links) {
  if (!Array.isArray(links)) return [];
  return links
    .map((link, index) => ({
      platform: String(link?.platform || "").trim(),
      label: String(link?.label || "").trim(),
      handle: String(link?.handle || "").trim(),
      url: String(link?.url || "").trim(),
      scope: normalizeSocialScope(link?.scope),
      active: link?.active !== false,
      order: Number.isFinite(Number(link?.order)) ? Number(link.order) : index,
    }))
    .filter((link) => link.platform && (link.url || link.handle));
}

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

function buildHeroPayload(body) {
  const bannerType = ["standard", "promotion", "campaign"].includes(body.bannerType)
    ? body.bannerType
    : "standard";
  const usesPromotionRecord = bannerType === "promotion" || bannerType === "campaign";

  const payload = {
    title: body.title,
    subtitle: body.subtitle,
    image: body.image,
    bgImage: body.bgImage,
    ctaText: body.ctaText,
    ctaLink: body.ctaLink,
    targetSystem: ["ecommerce", "web", "both"].includes(body.targetSystem)
      ? body.targetSystem
      : "ecommerce",
    bannerType,
    linkedPromotion: usesPromotionRecord && body.linkedPromotion ? body.linkedPromotion : null,
    linkedCampaign: null,
    startDate: parseScheduleDate(body.startDate),
    endDate: parseScheduleDate(body.endDate, true),
    order: body.order,
    status: body.status,
  };

  if (Object.prototype.hasOwnProperty.call(body, "socialLinks")) {
    payload.socialLinks = normalizeSocialLinks(body.socialLinks);
  }

  return payload;
}

function activeHeroQuery(system) {
  const query = {
    status: "active",
  };

  if (["ecommerce", "web"].includes(system)) {
    query.targetSystem = { $in: [system, "both"] };
  }

  return query;
}

function isDateInRange(startDate, endDate, now) {
  const startsAt = parseScheduleDate(startDate);
  const endsAt = parseScheduleDate(endDate, true);
  const startsOk = !startsAt || startsAt <= now;
  const endsOk = !endsAt || endsAt >= now;
  return startsOk && endsOk;
}

function isLinkedScheduleActive(hero, now) {
  if (hero.bannerType === "promotion" || (hero.bannerType === "campaign" && hero.linkedPromotion)) {
    const promotion = hero.linkedPromotion;
    if (!promotion || promotion.active === false) return false;
    return promotion.indefinite || isDateInRange(promotion.startDate, promotion.endDate, now);
  }

  if (hero.bannerType === "campaign") {
    const campaign = hero.linkedCampaign;
    if (!campaign || campaign.active === false) return false;
    return isDateInRange(campaign.startDate, campaign.endDate, now);
  }

  return isDateInRange(hero.startDate, hero.endDate, now);
}

export default async function handler(req, res) {
  await mongooseConnect();

  try {
    if (req.method === "GET") {
      const { activeOnly, system } = req.query;
      const query = activeOnly === "true" ? activeHeroQuery(system) : {};
      let heroes = await Hero.find(query)
        .populate("linkedPromotion", "name description valueType discountType discountValue startDate endDate indefinite active")
        .populate("linkedCampaign", "name description discount startDate endDate active")
        .sort({ order: 1, createdAt: -1 });

      if (activeOnly === "true") {
        const now = new Date();
        heroes = heroes.filter((hero) => isLinkedScheduleActive(hero, now));
      }

      return res.json(heroes);
    }

    if (req.method === "POST") {
      const payload = buildHeroPayload(req.body);
      const { title, image, bgImage, bannerType, linkedPromotion } = payload;

      if (!title || !Array.isArray(image) || image.length === 0 || !image[0]?.full || !image[0]?.thumb) {
        return res.status(400).json({ error: "Title and at least one Hero Image (full + thumb) are required" });
      }

      if (Array.isArray(bgImage) && bgImage.length > 0 && (!bgImage[0]?.full || !bgImage[0]?.thumb)) {
        return res.status(400).json({ error: "Background image must include full + thumb" });
      }

      if ((bannerType === "promotion" || bannerType === "campaign") && !linkedPromotion) {
        return res.status(400).json({ error: "Select a promotion to link this banner" });
      }

      const hero = await Hero.create(payload);
      await hero.populate("linkedPromotion", "name description valueType discountType discountValue startDate endDate indefinite active");
      await hero.populate("linkedCampaign", "name description discount startDate endDate active");
      return res.status(201).json(hero);
    }

    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (err) {
    console.error("Hero API error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

