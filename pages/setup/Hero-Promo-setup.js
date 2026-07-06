"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Layout from "@/components/Layout";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";

const SOCIAL_PLATFORMS = ["Instagram", "Facebook", "TikTok", "X", "YouTube", "WhatsApp", "LinkedIn", "Website"];
const SOCIAL_SCOPES = [
  { value: "warehouse", label: "Warehouse / E-commerce" },
  { value: "hotel", label: "Hotel" },
  { value: "both", label: "Both" },
];
const PROMOTION_BANNER_TYPES = new Set(["promotion", "campaign"]);

const emptyForm = {
  title: "",
  subtitle: "",
  image: [],
  bgImage: [],
  ctaText: "Shop Now",
  ctaLink: "/store/products",
  targetSystem: "ecommerce",
  bannerType: "standard",
  linkedPromotion: "",
  linkedCampaign: "",
  startDate: "",
  endDate: "",
  order: 0,
  status: "active",
};

function getRecordId(record) {
  if (!record) return "";
  if (typeof record === "string") return record;
  return record._id || record.id || "";
}

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function dateLabel(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleDateString();
}

function normalizeHero(hero) {
  return {
    ...hero,
    image: Array.isArray(hero.image) ? hero.image : [],
    bgImage: Array.isArray(hero.bgImage) ? hero.bgImage : [],
    socialLinks: Array.isArray(hero.socialLinks) ? hero.socialLinks.map(normalizeSocialLink) : [],
    targetSystem: hero.targetSystem || "ecommerce",
    bannerType: hero.bannerType || "standard",
  };
}

function normalizeSocialScope(value) {
  const scope = String(value || "").trim().toLowerCase();
  if (scope === "ecommerce" || scope === "store") return "warehouse";
  if (scope === "web" || scope === "all") return "both";
  return SOCIAL_SCOPES.some((option) => option.value === scope) ? scope : "warehouse";
}

function normalizeSocialLink(link, index = 0) {
  return {
    platform: link?.platform || "Instagram",
    label: link?.label || "",
    handle: link?.handle || "",
    url: link?.url || "",
    scope: normalizeSocialScope(link?.scope),
    active: link?.active !== false,
    order: Number.isFinite(Number(link?.order)) ? Number(link.order) : index,
  };
}

function isPromotionBannerType(type) {
  return PROMOTION_BANNER_TYPES.has(type);
}

function isPromotionActive(promotion) {
  if (!promotion || promotion.active === false) return false;
  const now = new Date();
  const startsAt = promotion.startDate ? new Date(promotion.startDate) : null;
  const endsAt = promotion.endDate ? new Date(promotion.endDate) : null;
  if (endsAt && endsAt.getUTCHours() === 0 && endsAt.getUTCMinutes() === 0 && endsAt.getUTCSeconds() === 0 && endsAt.getUTCMilliseconds() === 0) {
    endsAt.setUTCHours(23, 59, 59, 999);
  }
  if (startsAt && startsAt > now) return false;
  if (!promotion.indefinite && endsAt && endsAt < now) return false;
  return true;
}

function promotionCtaLabel(type) {
  return type === "campaign" ? "Shop Campaign" : "Shop Promotion";
}

function buildPromotionCtaLink(promotionId, targetSystem) {
  const basePath = targetSystem === "web" ? "/hotel/products" : "/store/products";
  return promotionId ? `${basePath}?promotion=${promotionId}` : basePath;
}

function linkedRecord(hero) {
  if (hero.bannerType === "promotion") return hero.linkedPromotion;
  if (hero.bannerType === "campaign") return hero.linkedPromotion || hero.linkedCampaign;
  return null;
}

function scheduleFor(hero) {
  const record = linkedRecord(hero);
  return {
    startDate: record?.startDate || hero.startDate,
    endDate: record?.indefinite ? null : record?.endDate || hero.endDate,
    indefinite: Boolean(record?.indefinite),
  };
}

function scheduleState(hero) {
  if (hero.status !== "active") return "Inactive";
  const { startDate, endDate, indefinite } = scheduleFor(hero);
  const now = new Date();
  if (startDate && new Date(startDate) > now) return "Queued";
  if (!indefinite && endDate && new Date(endDate) < now) return "Expired";
  return "Live";
}

function linkedLabel(hero) {
  const record = linkedRecord(hero);
  return record?.name || "Standard banner";
}

function formFromHero(hero) {
  return {
    title: hero.title || "",
    subtitle: hero.subtitle || "",
    image: hero.image || [],
    bgImage: hero.bgImage || [],
    ctaText: hero.ctaText || "Shop Now",
    ctaLink: hero.ctaLink || "/store/products",
    targetSystem: hero.targetSystem || "ecommerce",
    bannerType: hero.bannerType || "standard",
    linkedPromotion: getRecordId(hero.linkedPromotion),
    linkedCampaign: getRecordId(hero.linkedCampaign),
    startDate: toDateInput(hero.startDate),
    endDate: toDateInput(hero.endDate),
    order: hero.order || 0,
    status: hero.status || "active",
  };
}

export default function HeroPromoSetup() {
  const [heroes, setHeroes] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [socialLinks, setSocialLinks] = useState([]);
  const [savingSocials, setSavingSocials] = useState(false);
  const [heroProgress, setHeroProgress] = useState(0);
  const [bgProgress, setBgProgress] = useState(0);
  const heroInputRef = useRef(null);
  const bgInputRef = useRef(null);

  const selectedPromotion = useMemo(
    () => promotions.find((promotion) => promotion._id === form.linkedPromotion),
    [promotions, form.linkedPromotion]
  );
  const activePromotions = useMemo(
    () => promotions.filter(isPromotionActive),
    [promotions]
  );
  const scheduleLocked = isPromotionBannerType(form.bannerType);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [heroRes, promotionRes, socialRes] = await Promise.allSettled([
      fetch("/api/heroes"),
      fetch("/api/promotions"),
      fetch("/api/site-social-links"),
    ]);

    if (heroRes.status === "fulfilled" && heroRes.value.ok) {
      const data = await heroRes.value.json();
      setHeroes((Array.isArray(data) ? data : []).map(normalizeHero));
    }
    if (promotionRes.status === "fulfilled" && promotionRes.value.ok) {
      const data = await promotionRes.value.json();
      setPromotions(Array.isArray(data.promotions) ? data.promotions : []);
    }
    if (socialRes.status === "fulfilled" && socialRes.value.ok) {
      const data = await socialRes.value.json();
      setSocialLinks(Array.isArray(data.socialLinks) ? data.socialLinks.map(normalizeSocialLink) : []);
    }
  }

  function updateForm(field, value) {
    setForm((previous) => {
      const next = { ...previous, [field]: value };
      if (field === "targetSystem" && isPromotionBannerType(previous.bannerType) && previous.linkedPromotion) {
        next.ctaLink = buildPromotionCtaLink(previous.linkedPromotion, value);
      }
      return next;
    });
  }

  async function uploadImage(file, field, setProgress) {
    if (!file) return;
    const data = new FormData();
    data.append("file", file);
    try {
      const response = await axios.post("/api/upload", data, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (event) => {
          if (event.total) setProgress(Math.round((event.loaded * 100) / event.total));
        },
      });
      const link = response.data.links?.[0];
      if (!link?.full) throw new Error("Invalid upload response");
      setForm((previous) => ({
        ...previous,
        [field]: [...previous[field], { full: link.full, thumb: link.thumb || link.full }],
      }));
      setProgress(100);
    } catch {
      await showAlertDialog({ title: "Upload failed", message: "Image upload failed.", tone: "danger" });
    }
  }

  function selectBannerType(value) {
    setForm((previous) => ({
      ...previous,
      bannerType: value,
      linkedPromotion: "",
      linkedCampaign: "",
      ctaText: value === "standard" ? "Shop Now" : previous.ctaText,
      ctaLink: value === "standard" ? "/store/products" : buildPromotionCtaLink("", previous.targetSystem),
      startDate: value === "standard" ? previous.startDate : "",
      endDate: value === "standard" ? previous.endDate : "",
    }));
  }

  function selectPromotion(id) {
    const promotion = promotions.find((item) => item._id === id);
    setForm((previous) => ({
      ...previous,
      linkedPromotion: id,
      linkedCampaign: "",
      title: previous.title || promotion?.name || "",
      subtitle: previous.subtitle || promotion?.description || "",
      ctaText: promotionCtaLabel(previous.bannerType),
      ctaLink: buildPromotionCtaLink(id, previous.targetSystem),
      startDate: toDateInput(promotion?.startDate),
      endDate: promotion?.indefinite ? "" : toDateInput(promotion?.endDate),
    }));
  }

  function addSocialLink() {
    setSocialLinks((previous) => [
      ...previous,
      normalizeSocialLink({ platform: "Instagram", scope: "warehouse" }, previous.length),
    ]);
  }

  function updateSocialLink(index, field, value) {
    setSocialLinks((previous) =>
      previous.map((link, linkIndex) =>
        linkIndex === index ? { ...link, [field]: value } : link
      )
    );
  }

  function removeSocialLink(index) {
    setSocialLinks((previous) => previous.filter((_, linkIndex) => linkIndex !== index));
  }

  async function saveSocialLinks() {
    setSavingSocials(true);
    try {
      const response = await fetch("/api/site-social-links", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ socialLinks: socialLinks.map(normalizeSocialLink) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Social media save failed");
      setSocialLinks(Array.isArray(result.socialLinks) ? result.socialLinks.map(normalizeSocialLink) : []);
      await showAlertDialog({
        title: "Social media saved",
        message: "Social media links are now saved independently from hero banners.",
        tone: "success",
      });
    } catch (error) {
      await showAlertDialog({ title: "Save failed", message: error.message, tone: "danger" });
    } finally {
      setSavingSocials(false);
    }
  }

  async function saveHero() {
    if (!form.title.trim() || form.image.length === 0) {
      await showAlertDialog({ title: "Missing hero details", message: "Title and Hero Image are required.", tone: "warning" });
      return;
    }
    if (isPromotionBannerType(form.bannerType) && !form.linkedPromotion) {
      await showAlertDialog({
        title: "Missing linked promotion",
        message: "Select an active promotion or campaign promotion for this banner.",
        tone: "warning",
      });
      return;
    }

    const payload = {
      title: form.title.trim(),
      subtitle: form.subtitle.trim(),
      image: form.image.map(({ full, thumb }) => ({ full, thumb })),
      bgImage: form.bgImage.map(({ full, thumb }) => ({ full, thumb })),
      ctaText: form.ctaText,
      ctaLink: form.ctaLink,
      targetSystem: form.targetSystem,
      bannerType: form.bannerType,
      linkedPromotion: isPromotionBannerType(form.bannerType) ? form.linkedPromotion : null,
      linkedCampaign: null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      order: form.order,
      status: form.status,
    };

    setSaving(true);
    try {
      const response = await fetch(editId ? `/api/heroes/${editId}` : "/api/heroes", {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Save failed");
      const normalized = normalizeHero(result);
      setHeroes((previous) =>
        editId ? previous.map((hero) => (hero._id === editId ? normalized : hero)) : [normalized, ...previous]
      );
      resetForm();
    } catch (error) {
      await showAlertDialog({ title: "Save failed", message: error.message, tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteHero(id) {
    const confirmed = await showConfirmDialog({
      title: "Delete hero banner?",
      message: "This removes only the banner setup. Linked promotions stay intact.",
      tone: "danger",
      confirmLabel: "Delete banner",
      cancelLabel: "Keep banner",
    });
    if (!confirmed) return;
    const response = await fetch(`/api/heroes/${id}`, { method: "DELETE" });
    if (response.ok) setHeroes((previous) => previous.filter((hero) => hero._id !== id));
  }

  function editHero(hero) {
    setEditId(hero._id);
    setForm(formFromHero(hero));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetForm() {
    setForm(emptyForm);
    setEditId(null);
    setHeroProgress(0);
    setBgProgress(0);
    if (heroInputRef.current) heroInputRef.current.value = null;
    if (bgInputRef.current) bgInputRef.current.value = null;
  }

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content space-y-6">
          <div className="page-header">
            <div>
              <h1 className="page-title">Hero & Promo Setup</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/manage/promotions" className="btn-action-secondary">Product Promotions</Link>
              <Link href="/manage/promotions-management" className="btn-action-secondary">Campaign Promotions</Link>
            </div>
          </div>

          <section className="content-card space-y-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-gray-900">{editId ? "Edit Banner" : "Create Banner"}</h2>
              {editId && <button onClick={resetForm} className="btn-action-secondary">Cancel Edit</button>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Target System">
                <select value={form.targetSystem} onChange={(event) => updateForm("targetSystem", event.target.value)} className="form-select">
                  <option value="ecommerce">E-commerce</option>
                  <option value="web">Web</option>
                  <option value="both">Both</option>
                </select>
              </Field>
              <Field label="Banner Source">
                <select value={form.bannerType} onChange={(event) => selectBannerType(event.target.value)} className="form-select">
                  <option value="standard">Standard hero</option>
                  <option value="promotion">Link to promotion</option>
                  <option value="campaign">Link to campaign promotion</option>
                </select>
              </Field>
              <Field label="Status">
                <select value={form.status} onChange={(event) => updateForm("status", event.target.value)} className="form-select">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
            </div>

            {isPromotionBannerType(form.bannerType) && (
              <Field label={form.bannerType === "campaign" ? "Active Campaign Promotion" : "Active Promotion"}>
                <select value={form.linkedPromotion} onChange={(event) => selectPromotion(event.target.value)} className="form-select">
                  <option value="">Select active promotion</option>
                  {activePromotions.map((promotion) => (
                    <option key={promotion._id} value={promotion._id}>
                      {promotion.name} ({dateLabel(promotion.startDate)} to {promotion.indefinite ? "Indefinite" : dateLabel(promotion.endDate)})
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Hero Title">
                <input value={form.title} onChange={(event) => updateForm("title", event.target.value)} className="form-input" placeholder="Hero title" />
              </Field>
              <Field label="Hero Subtitle">
                <input value={form.subtitle} onChange={(event) => updateForm("subtitle", event.target.value)} className="form-input" placeholder="Hero subtitle" />
              </Field>
              <Field label="CTA Text">
                <input value={form.ctaText} onChange={(event) => updateForm("ctaText", event.target.value)} className="form-input" placeholder="Shop Now" />
              </Field>
              <Field label="CTA Link">
                {isPromotionBannerType(form.bannerType) ? (
                  <select value={form.ctaLink} onChange={(event) => updateForm("ctaLink", event.target.value)} className="form-select">
                    <option value={buildPromotionCtaLink("", form.targetSystem)}>Product list</option>
                    {activePromotions.map((promotion) => (
                      <option key={promotion._id} value={buildPromotionCtaLink(promotion._id, form.targetSystem)}>
                        {promotion.name} product list
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={form.ctaLink} onChange={(event) => updateForm("ctaLink", event.target.value)} className="form-input" placeholder="/store/products" />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Start Date">
                <input
                  type="date"
                  value={scheduleLocked && selectedPromotion ? toDateInput(selectedPromotion.startDate) : form.startDate}
                  onChange={(event) => updateForm("startDate", event.target.value)}
                  disabled={scheduleLocked}
                  className="form-input disabled:bg-gray-100"
                />
              </Field>
              <Field label="End Date">
                <input
                  type="date"
                  value={scheduleLocked && selectedPromotion ? (selectedPromotion.indefinite ? "" : toDateInput(selectedPromotion.endDate)) : form.endDate}
                  onChange={(event) => updateForm("endDate", event.target.value)}
                  disabled={scheduleLocked}
                  className="form-input disabled:bg-gray-100"
                />
              </Field>
              <Field label="Display Order">
                <input type="number" value={form.order} onChange={(event) => updateForm("order", Number(event.target.value))} className="form-input" />
              </Field>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Uploader
                label="Hero Image"
                inputRef={heroInputRef}
                progress={heroProgress}
                images={form.image}
                onUpload={(file) => uploadImage(file, "image", setHeroProgress)}
                onRemove={(index) => updateForm("image", form.image.filter((_, imageIndex) => imageIndex !== index))}
              />
              <Uploader
                label="Background Image"
                inputRef={bgInputRef}
                progress={bgProgress}
                images={form.bgImage}
                onUpload={(file) => uploadImage(file, "bgImage", setBgProgress)}
                onRemove={(index) => updateForm("bgImage", form.bgImage.filter((_, imageIndex) => imageIndex !== index))}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-5">
              <button onClick={saveHero} disabled={saving} className={`btn-action-primary ${saving ? "opacity-50" : ""}`}>
                {saving ? "Saving..." : editId ? "Update Banner" : "Save Banner"}
              </button>
              {editId && <button type="button" onClick={resetForm} className="btn-action-secondary">Cancel Edit</button>}
            </div>
          </section>

          <section className="content-card space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Social Media Details</h2>
                  <p className="mt-1 text-sm text-gray-500">Choose which links show on the warehouse/e-commerce site, the hotel site, or both.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={addSocialLink} className="btn-action-secondary">Add Social Link</button>
                  <button type="button" onClick={saveSocialLinks} disabled={savingSocials} className={`btn-action-primary ${savingSocials ? "opacity-50" : ""}`}>
                    {savingSocials ? "Saving..." : "Save Social Details"}
                  </button>
                </div>
              </div>
              {socialLinks.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No social links added.</p>
              ) : (
                <div className="space-y-3">
                  {socialLinks.map((link, index) => (
                    <div key={index} className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 p-3 lg:grid-cols-[150px_170px_1fr_1fr_1.2fr_auto_auto] lg:items-center">
                      <select value={link.platform || "Instagram"} onChange={(event) => updateSocialLink(index, "platform", event.target.value)} className="form-select">
                        {SOCIAL_PLATFORMS.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
                      </select>
                      <select value={normalizeSocialScope(link.scope)} onChange={(event) => updateSocialLink(index, "scope", event.target.value)} className="form-select">
                        {SOCIAL_SCOPES.map((scope) => <option key={scope.value} value={scope.value}>{scope.label}</option>)}
                      </select>
                      <input value={link.label || ""} onChange={(event) => updateSocialLink(index, "label", event.target.value)} className="form-input" placeholder="Label" />
                      <input value={link.handle || ""} onChange={(event) => updateSocialLink(index, "handle", event.target.value)} className="form-input" placeholder="Handle" />
                      <input value={link.url || ""} onChange={(event) => updateSocialLink(index, "url", event.target.value)} className="form-input" placeholder="https://" />
                      <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                        <input
                          type="checkbox"
                          checked={link.active !== false}
                          onChange={(event) => updateSocialLink(index, "active", event.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                        />
                        Show
                      </label>
                      <button type="button" onClick={() => removeSocialLink(index)} className="btn-action-danger">Remove</button>
                    </div>
                  ))}
                </div>
              )}
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {heroes.length === 0 ? (
              <div className="content-card text-center py-10 text-gray-500 italic">No hero banners stored yet.</div>
            ) : heroes.map((hero) => (
              <HeroCard key={hero._id} hero={hero} onEdit={editHero} onDelete={deleteHero} />
            ))}
          </section>
        </div>
      </div>
    </Layout>
  );
}

function Field({ label, children }) {
  return (
    <label className="form-group">
      <span className="form-label">{label}</span>
      {children}
    </label>
  );
}

function Uploader({ label, inputRef, progress, images, onUpload, onRemove }) {
  return (
    <div className="form-group rounded-lg border border-gray-200 p-4">
      <span className="form-label">{label}</span>
      <button type="button" onClick={() => inputRef.current?.click()} className="btn-action-secondary">Upload {label}</button>
      <input type="file" ref={inputRef} onChange={(event) => onUpload(event.target.files[0])} className="hidden" />
      {progress > 0 && progress < 100 && (
        <div className="theme-progress-track w-full h-2 mt-3">
          <div className="theme-progress-fill h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="flex flex-wrap gap-3 mt-3">
        {images.map((image, index) => (
          <div key={index} className="relative pr-12 pt-2">
            <img src={image.full} alt={label} className="w-24 h-24 object-cover rounded-lg border border-gray-200" />
            <button type="button" onClick={() => onRemove(index)} className="absolute right-0 top-0 rounded bg-red-600 px-2 py-1 text-xs text-white">Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeroCard({ hero, onEdit, onDelete }) {
  const period = scheduleFor(hero);
  const image = hero.bgImage?.[0]?.full || hero.image?.[0]?.full;

  return (
    <article className="content-card overflow-hidden p-0">
      <div className="relative min-h-[220px] bg-gray-900">
        {image && <img src={image} alt={hero.title} className="absolute inset-0 h-full w-full object-cover opacity-70" />}
        <div className="relative p-5 text-white">
          <div className="mb-4 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-white/90 px-3 py-1 text-gray-800 capitalize">{hero.targetSystem}</span>
            <span className="rounded-full bg-white/90 px-3 py-1 text-gray-800 capitalize">{hero.bannerType}</span>
            <span className="rounded-full bg-white/90 px-3 py-1 text-gray-800">{scheduleState(hero)}</span>
          </div>
          <p className="text-xs uppercase tracking-wide text-white/80">{linkedLabel(hero)}</p>
          <h2 className="mt-1 text-2xl font-bold">{hero.title}</h2>
          <p className="mt-2 max-w-xl text-sm text-white/90">{hero.subtitle}</p>
          <p className="mt-4 text-xs text-white/80">
            {dateLabel(period.startDate)} to {period.indefinite ? "Indefinite" : dateLabel(period.endDate)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <span className="text-sm text-gray-600">Order #{hero.order || 0}</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => onEdit(hero)} className="btn-action-secondary">Edit</button>
          <button type="button" onClick={() => onDelete(hero._id)} className="btn-action-danger">Delete</button>
        </div>
      </div>
    </article>
  );
}
