"use client";

import axios from "axios";
import { useState, useEffect, useRef } from "react";
import Layout from "@/components/Layout";
import { motion, AnimatePresence } from "framer-motion";
import { useDrag } from "@use-gesture/react";
import { showAlertDialog } from "@/lib/dialogs";
import PromotionManagement from "./PromotionManagement";

export default function HeroSetup() {
  const [heroPages, setHeroPages] = useState([]);
  const [heroTitle, setHeroTitle] = useState("");
  const [heroSubtitle, setHeroSubtitle] = useState("");
  const [heroImage, setHeroImage] = useState([]);
  const [heroBgImage, setHeroBgImage] = useState([]);
  const [ctaText, setCtaText] = useState("Shop Now");
  const [ctaLink, setCtaLink] = useState("/shop/shop");
  const [order, setOrder] = useState(0);
  const [status, setStatus] = useState("active");
  const [heroProgress, setHeroProgress] = useState(0);
  const [heroBgProgress, setHeroBgProgress] = useState(0);
  const [editId, setEditId] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [uploading, setUploading] = useState(false);

  const heroImageRef = useRef(null);
  const heroBgImageRef = useRef(null);

  useEffect(() => {
    async function fetchHeroes() {
      try {
        const res = await fetch("/api/heroes");
        if (!res.ok) throw new Error("Failed to load heroes");
        const data = await res.json();
        const normalized = (data || []).map((h) => ({
          ...h,
          image: Array.isArray(h.image) ? h.image : [],
          bgImage: Array.isArray(h.bgImage) ? h.bgImage : [],
        }));
        setHeroPages(normalized);
      } catch (err) {
        console.error("Fetch heroes error:", err);
      }
    }
    fetchHeroes();
  }, []);

  // Upload Helper
  const uploadFileToS3 = async (file, setState, setProgress) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await axios.post("/api/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (progressEvent) => {
          if (setProgress) {
            const percent = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            setProgress(percent);
          }
        },
      });

      const links = res.data.links;
      if (!links || !links[0]?.full) throw new Error("Invalid upload response");

      const finalObj = {
        full: links[0].full,
        thumb: links[0].thumb || links[0].full,
      };

      setState((prev) => [...prev, finalObj]);
      if (setProgress) setProgress(100);
    } catch (error) {
      console.error("Upload error:", error);
      throw error;
    }
  };

  const removeImage = (index, setImageFn) => {
    setImageFn((prev) => prev.filter((_, i) => i !== index));
  };

  const handleHeroImageChange = async (file) => {
    if (!file) return;
    try {
      await uploadFileToS3(file, setHeroImage, setHeroProgress);
    } catch {
      await showAlertDialog({
        title: "Upload failed",
        message: "Hero image upload failed.",
        tone: "danger",
      });
    }
  };

  const handleBgImageChange = async (file) => {
    if (!file) return;
    try {
      await uploadFileToS3(file, setHeroBgImage, setHeroBgProgress);
    } catch {
      await showAlertDialog({
        title: "Upload failed",
        message: "Background image upload failed.",
        tone: "danger",
      });
    }
  };

  const addOrUpdateHeroPage = async () => {
    if (!heroTitle.trim() || heroImage.length === 0) {
      await showAlertDialog({
        title: "Missing hero details",
        message: "Title and Hero Image are required.",
        tone: "warning",
      });
      return;
    }

    const payload = {
      title: heroTitle,
      subtitle: heroSubtitle,
      image: heroImage.map(({ full, thumb }) => ({ full, thumb })),
      bgImage: heroBgImage.map(({ full, thumb }) => ({ full, thumb })),
      ctaText,
      ctaLink,
      order,
      status,
    };

    setUploading(true);
    try {
      let res;
      if (editId) {
        res = await fetch(`/api/heroes/${editId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/heroes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) throw new Error("Save error");
      const result = await res.json();
      const normalized = {
        ...result,
        image: Array.isArray(result.image) ? result.image : [],
        bgImage: Array.isArray(result.bgImage) ? result.bgImage : [],
      };
      if (editId)
        setHeroPages((prev) =>
          prev.map((h) => (h._id === editId ? normalized : h))
        );
      else setHeroPages((prev) => [normalized, ...prev]);
      resetForm();
    } catch (err) {
      await showAlertDialog({
        title: "Save failed",
        message: err.message || "Save error",
        tone: "danger",
      });
    } finally {
      setUploading(false);
    }
  };

  const removeHeroPage = async (id) => {
    const res = await fetch(`/api/heroes/${id}`, { method: "DELETE" });
    if (res.ok)
      setHeroPages((prev) => prev.filter((h) => h._id !== id));
    else {
      await showAlertDialog({
        title: "Delete failed",
        message: "Failed to delete hero.",
        tone: "danger",
      });
    }
  };

  const editHeroPage = (hero) => {
    setHeroTitle(hero.title);
    setHeroSubtitle(hero.subtitle);
    setHeroImage(hero.image || []);
    setHeroBgImage(hero.bgImage || []);
    setCtaText(hero.ctaText || "Shop Now");
    setCtaLink(hero.ctaLink || "/shop/shop");
    setOrder(hero.order || 0);
    setStatus(hero.status || "active");
    setEditId(hero._id);
  };

  const resetForm = () => {
    setHeroTitle("");
    setHeroSubtitle("");
    setHeroImage([]);
    setHeroBgImage([]);
    setCtaText("Shop Now");
    setCtaLink("/shop/shop");
    setOrder(0);
    setStatus("active");
    setEditId(null);
    setHeroProgress(0);
    setHeroBgProgress(0);
    heroImageRef.current.value = null;
    heroBgImageRef.current.value = null;
  };

  const prevHero = () =>
    setCurrentIndex((prev) => (prev === 0 ? heroPages.length - 1 : prev - 1));
  const nextHero = () =>
    setCurrentIndex((prev) => (prev === heroPages.length - 1 ? 0 : prev + 1));

  const currentHero = heroPages[currentIndex] || {};
  const bind = useDrag(
    ({ down, movement: [mx], direction: [xDir], distance, velocity }) => {
      if (!down && distance > 100 && velocity > 0.2)
        xDir < 0 ? nextHero() : prevHero();
    }
  );

  return (
    <Layout>
      <div className="min-h-[100vh] flex flex-col items-center pb-6 pt-6 px-4 space-y-12 bg-slate-50">
        {/* Hero Carousel */}
        <div className="relative w-full max-w-6xl">
          {heroPages.length === 0 ? (
            <p className="text-blue-400 italic text-center">No Hero Pages Yet</p>
          ) : (
            <div className="relative rounded-2xl overflow-hidden shadow-xl border border-blue-100">
              <AnimatePresence mode="wait">
                {currentHero && (
                  <motion.section
                    key={currentHero._id}
                    {...bind()}
                    initial={{ opacity: 0, x: 200 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -200 }}
                    transition={{ duration: 0.5 }}
                    className="relative w-full h-[420px] flex items-center justify-center bg-blue-100 overflow-hidden rounded-2xl"
                  >
                    {/* Background */}
                    <div className="absolute inset-0 overflow-hidden">
                      {currentHero.bgImage?.[0]?.full ? (
                        <img
                          src={currentHero.bgImage[0].full}
                          alt="Hero background"
                          className="w-full h-full object-cover scale-105 blur-sm brightness-95 transition-all duration-700"
                        />
                      ) : (
                        <div className="w-full h-full bg-blue-100 animate-pulse" />
                      )}
                      <div className="absolute inset-0 bg-blue-950/30" />
                    </div>

                    {/* Content */}
                    <div className="relative flex flex-col md:flex-row items-center justify-between max-w-4xl mx-auto px-6 w-full text-white">
                      <motion.div
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6 }}
                        className="hidden md:flex flex-1 justify-center md:justify-start"
                      >
                        <img
                          src={
                            currentHero.image?.[0]?.full ||
                            "/images/placeholder.PNG"
                          }
                          alt="Model"
                          className="max-w-xs md:max-w-md object-contain drop-shadow-2xl rounded-lg"
                        />
                      </motion.div>

                      <motion.div
                        initial={{ opacity: 0, x: 50 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                        className="flex-1 text-center md:text-left py-6"
                      >
                        <h1 className="font-serif text-4xl md:text-5xl font-bold mb-4 leading-tight drop-shadow-lg">
                          {currentHero.title}
                        </h1>
                        <p className="text-lg md:text-xl mb-8 text-blue-100 max-w-xl mx-auto md:mx-0 leading-relaxed">
                          {currentHero.subtitle}
                        </p>
                        <div className="mt-4">
                          <a
                            href="#"
                            className="px-8 py-3 rounded-full bg-blue-600 text-white font-semibold shadow-lg hover:bg-blue-700 transition-all"
                          >
                            {currentHero.ctaText}
                          </a>
                        </div>
                      </motion.div>
                    </div>

                    {/* Controls */}
                    {heroPages.length > 1 && (
                      <>
                        <button
                          onClick={prevHero}
                          className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-blue-100 text-blue-700 rounded-full p-3 shadow-md transition"
                        >
                          &#8592;
                        </button>
                        <button
                          onClick={nextHero}
                          className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/80 hover:bg-blue-100 text-blue-700 rounded-full p-3 shadow-md transition"
                        >
                          &#8594;
                        </button>
                      </>
                    )}

                    {/* Actions */}
                    <div className="absolute top-4 right-4 flex space-x-2">
                      <button
                        onClick={() => editHeroPage(currentHero)}
                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => removeHeroPage(currentHero._id)}
                        className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </motion.section>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Add/Edit Form */}
        <div className="w-full flex flex-col md:flex-row items-start justify-center gap-10">
          <div className="space-y-5 w-full max-w-4xl bg-white shadow-xl border border-blue-100 rounded-2xl py-10 px-6">
            <h2 className="text-2xl font-semibold text-blue-900">
              {editId ? "Edit Hero" : "Add New Hero"}
            </h2>

            <input
              type="text"
              value={heroTitle}
              onChange={(e) => setHeroTitle(e.target.value)}
              placeholder="Hero Title"
              className="w-full px-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            />

            <input
              type="text"
              value={heroSubtitle}
              onChange={(e) => setHeroSubtitle(e.target.value)}
              placeholder="Hero Subtitle"
              className="w-full px-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            />

            <input
              type="text"
              value={ctaText}
              onChange={(e) => setCtaText(e.target.value)}
              placeholder="CTA Text"
              className="w-full px-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            />

            <input
              type="text"
              value={ctaLink}
              onChange={(e) => setCtaLink(e.target.value)}
              placeholder="CTA Link"
              className="w-full px-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            />

            <input
              type="number"
              value={order}
              onChange={(e) => setOrder(Number(e.target.value))}
              placeholder="Order"
              className="w-full px-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            />

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>

            {/* Upload Sections */}
            {renderUploader("Hero Image", heroImageRef, handleHeroImageChange, heroProgress, heroImage, setHeroImage)}
            {renderUploader("Background Image", heroBgImageRef, handleBgImageChange, heroBgProgress, heroBgImage, setHeroBgImage)}

            <div className="flex space-x-3 mt-6">
              <button
                onClick={addOrUpdateHeroPage}
                disabled={uploading}
                className={`px-5 py-2.5 rounded-lg text-white font-semibold shadow-md transition-all ${
                  uploading
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {uploading ? "Saving..." : editId ? "Update Hero" : "Add Hero"}
              </button>

              {editId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-5 py-2.5 rounded-lg bg-gray-100 hover:bg-blue-50 text-blue-700 font-semibold shadow-md transition-all"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          <div className="w-full max-w-4xl bg-white shadow-xl border border-blue-100 rounded-2xl p-6">
            <PromotionManagement />
          </div>
        </div>
      </div>
    </Layout>
  );
}

function renderUploader(label, ref, handleChange, progress, images, setImages) {
  return (
    <div className="flex flex-col space-y-2">
      <span className="font-medium text-blue-800">{label}</span>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 text-blue-700 w-fit transition"
      >
        Upload {label}
      </button>
      <input
        type="file"
        ref={ref}
        onChange={(e) => {
          const file = e.target.files[0];
          if (file) handleChange(file);
        }}
        className="hidden"
      />
      {progress > 0 && progress < 100 && (
        <div className="w-full bg-blue-100 rounded-full h-2">
          <div
            className="bg-blue-500 h-2 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {images.map((img, idx) => (
          <div key={idx} className="relative">
            <img
              src={img.full}
              alt={label}
              className="w-20 h-20 object-cover rounded border border-blue-200 shadow"
            />
            <button
              type="button"
              onClick={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
              className="absolute top-0 right-0 bg-red-500 text-white text-xs rounded-full px-1"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
