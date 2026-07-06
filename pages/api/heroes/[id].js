// pages/api/heroes/[id].js
import { mongooseConnect } from "@/lib/mongodb";
import Hero from "@/models/Hero";
import "@/models/Campaign";
import "@/models/Promotion";
import { deleteProductImages } from "@/lib/s3";

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

export default async function handler(req, res) {
  await mongooseConnect(); // ✅ ensure DB connection

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: "Hero ID is required" });
  }

  try {
    if (req.method === "GET") {
      const hero = await Hero.findById(id)
        .populate("linkedPromotion", "name description valueType discountType discountValue startDate endDate indefinite active")
        .populate("linkedCampaign", "name description discount startDate endDate active");
      if (!hero) return res.status(404).json({ error: "Hero not found" });
      return res.json(hero);
    }

    if (req.method === "PUT") {
      const payload = buildHeroPayload(req.body);
      const { title, image, bgImage, bannerType, linkedPromotion } = payload;

      // ✅ validate required fields
      if (!title || !Array.isArray(image) || image.length === 0 || !image[0]?.full || !image[0]?.thumb) {
        return res.status(400).json({ error: "Title and at least one Hero Image (full + thumb) are required" });
      }

      if (Array.isArray(bgImage) && bgImage.length > 0 && (!bgImage[0]?.full || !bgImage[0]?.thumb)) {
        return res.status(400).json({ error: "Background image must include full + thumb" });
      }

      if ((bannerType === "promotion" || bannerType === "campaign") && !linkedPromotion) {
        return res.status(400).json({ error: "Select a promotion to link this banner" });
      }

      // Fetch existing hero to detect removed images
      const existingHero = await Hero.findById(id).select("image bgImage").lean();

      const updated = await Hero.findByIdAndUpdate(
        id,
        payload,
        { new: true, runValidators: true }
      )
        .populate("linkedPromotion", "name description valueType discountType discountValue startDate endDate indefinite active")
        .populate("linkedCampaign", "name description discount startDate endDate active");

      if (!updated) return res.status(404).json({ error: "Hero not found" });

      // Delete S3 images that were removed during this edit
      if (existingHero) {
        const updatedUrls = new Set(
          [...(Array.isArray(image) ? image : []), ...(Array.isArray(bgImage) ? bgImage : [])]
            .flatMap((img) => [img?.full, img?.thumb])
            .filter(Boolean)
        );
        const previousImages = [
          ...(Array.isArray(existingHero.image) ? existingHero.image : []),
          ...(Array.isArray(existingHero.bgImage) ? existingHero.bgImage : []),
        ];
        const removedImages = previousImages.filter(
          (img) => !updatedUrls.has(img?.full) && !updatedUrls.has(img?.thumb)
        );
        if (removedImages.length > 0) {
          deleteProductImages(removedImages).catch((err) =>
            console.error("[Heroes] S3 image cleanup failed during edit:", err.message)
          );
        }
      }

      return res.json(updated);
    }

    if (req.method === "DELETE") {
      const deleted = await Hero.findByIdAndDelete(id);
      if (!deleted) return res.status(404).json({ error: "Hero not found" });

      // Delete all S3 images for this hero
      const allImages = [
        ...(Array.isArray(deleted.image) ? deleted.image : []),
        ...(Array.isArray(deleted.bgImage) ? deleted.bgImage : []),
      ];
      if (allImages.length > 0) {
        deleteProductImages(allImages).catch((err) =>
          console.error("[Heroes] S3 image cleanup failed for deleted hero:", err.message)
        );
      }

      return res.json({ message: "Hero deleted successfully" });
    }

    // Method not allowed
    res.setHeader("Allow", ["GET", "PUT", "DELETE"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (err) {
    console.error("Hero API error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
