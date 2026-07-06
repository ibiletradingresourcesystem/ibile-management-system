import { mongooseConnect } from "@/lib/mongodb";
import Hero from "@/models/Hero";
import SiteSocialLink from "@/models/SiteSocialLink";

const SOCIAL_SCOPES = new Set(["warehouse", "hotel", "both"]);

function normalizeSocialScope(value) {
  const scope = String(value || "").trim().toLowerCase();
  if (scope === "ecommerce" || scope === "store") return "warehouse";
  if (scope === "web" || scope === "all") return "both";
  return SOCIAL_SCOPES.has(scope) ? scope : "warehouse";
}

function normalizeSocialLink(link, index = 0) {
  return {
    platform: String(link?.platform || "").trim(),
    label: String(link?.label || "").trim(),
    handle: String(link?.handle || "").trim(),
    url: String(link?.url || "").trim(),
    scope: normalizeSocialScope(link?.scope),
    active: link?.active !== false,
    order: Number.isFinite(Number(link?.order)) ? Number(link.order) : index,
  };
}

function socialKey(link) {
  return [link.platform, link.url, link.handle, link.scope]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("|");
}

function dedupeSocialLinks(links) {
  const byKey = new Map();

  links
    .map(normalizeSocialLink)
    .filter((link) => link.platform && (link.url || link.handle))
    .forEach((link, index) => {
      const normalized = { ...link, order: Number.isFinite(Number(link.order)) ? Number(link.order) : index };
      const key = socialKey(normalized);
      if (!byKey.has(key)) {
        byKey.set(key, normalized);
      }
    });

  return Array.from(byKey.values()).sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return left.platform.localeCompare(right.platform);
  });
}

async function getLegacyHeroSocialLinks() {
  const heroes = await Hero.find({ socialLinks: { $exists: true, $ne: [] } })
    .select("socialLinks")
    .sort({ order: 1, createdAt: -1 })
    .lean();

  return dedupeSocialLinks(heroes.flatMap((hero) => hero.socialLinks || []));
}

export default async function handler(req, res) {
  await mongooseConnect();

  try {
    if (req.method === "GET") {
      const savedLinks = await SiteSocialLink.find({}).sort({ order: 1, createdAt: 1 }).lean();
      if (savedLinks.length > 0) {
        return res.status(200).json({ socialLinks: savedLinks.map(normalizeSocialLink) });
      }

      const legacyLinks = await getLegacyHeroSocialLinks();
      return res.status(200).json({ socialLinks: legacyLinks });
    }

    if (req.method === "PUT") {
      const socialLinks = dedupeSocialLinks(req.body?.socialLinks || []);
      await SiteSocialLink.deleteMany({});

      if (!socialLinks.length) {
        return res.status(200).json({ socialLinks: [] });
      }

      const savedLinks = await SiteSocialLink.insertMany(
        socialLinks.map((link, index) => ({ ...link, order: index }))
      );

      return res.status(200).json({ socialLinks: savedLinks.map(normalizeSocialLink) });
    }

    res.setHeader("Allow", ["GET", "PUT"]);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  } catch (error) {
    console.error("Site social links API error:", error);
    return res.status(500).json({ error: "Server error" });
  }
}
