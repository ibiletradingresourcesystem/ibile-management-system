import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { Camera, Loader2, CheckCircle } from "lucide-react";

export default function OnboardingPage() {
  const router = useRouter();
  const { token } = router.query;
  const [staff, setStaff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const staffPhotoRef = useRef(null);
  const guarantorPhotoRef = useRef(null);
  const [staffPhotoPreview, setStaffPhotoPreview] = useState(null);
  const [guarantorPhotoPreview, setGuarantorPhotoPreview] = useState(null);
  const [uploadingStaffPhoto, setUploadingStaffPhoto] = useState(false);
  const [uploadingGuarantorPhoto, setUploadingGuarantorPhoto] = useState(false);

  const [form, setForm] = useState({
    fullName: "", email: "", phone: "", address: "",
    dateOfBirth: "", stateOfOrigin: "", nextOfKin: "",
    nextOfKinPhone: "", photo: "",
  });

  const [guarantor, setGuarantor] = useState({
    name: "", phone: "", email: "", address: "",
    relationship: "", occupation: "", photo: "",
  });

  useEffect(() => {
    if (!token) return;
    fetch(`/api/staff/onboarding/${token}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) { setError(data.error); }
        else if (data.alreadyComplete) { setDone(true); setStaff(data.staff); }
        else { setStaff(data.staff); }
      })
      .catch(() => setError("Failed to load onboarding form"))
      .finally(() => setLoading(false));
  }, [token]);

  const handlePhotoUpload = async (e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    if (type === "staff") {
      reader.onload = (ev) => setStaffPhotoPreview(ev.target.result);
      setUploadingStaffPhoto(true);
    } else {
      reader.onload = (ev) => setGuarantorPhotoPreview(ev.target.result);
      setUploadingGuarantorPhoto(true);
    }
    reader.readAsDataURL(file);

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      const url = data?.links?.[0] || "";
      if (type === "staff") setForm((prev) => ({ ...prev, photo: url }));
      else setGuarantor((prev) => ({ ...prev, photo: url }));
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      if (type === "staff") setUploadingStaffPhoto(false);
      else setUploadingGuarantorPhoto(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.fullName || !form.phone) {
      setError("Full name and phone number are required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/staff/onboarding/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, onboardingData: form, guarantor }),
      });
      const data = await res.json();
      if (res.ok) { setDone(true); }
      else { setError(data.error || "Failed to submit"); }
    } catch { setError("Network error"); }
    finally { setSubmitting(false); }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="animate-spin theme-accent-text" size={40} />
      </div>
    );
  }

  if (error && !staff) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-red-600 mb-2">Invalid Link</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <CheckCircle className="mx-auto text-green-500 mb-4" size={48} />
          <h1 className="text-xl font-bold text-green-700 mb-2">Onboarding Complete!</h1>
          <p className="text-gray-600">Thank you, {staff?.name}. Your details have been submitted successfully.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Staff Onboarding - {staff?.name}</title>
      </Head>
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            {/* Header */}
            <div className="theme-accent-bg text-white px-6 py-6">
              <h1 className="text-2xl font-bold">Staff Onboarding Form</h1>
              <p className="text-white/80 mt-1">Welcome, {staff?.name}! Please fill in your details below.</p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-8">
              {/* Section 1: Personal Details */}
              <div>
                <h2 className="text-lg font-semibold theme-section-title mb-4 border-b theme-border-soft pb-2">Personal Details</h2>

                {/* Photo Upload */}
                <div className="flex items-center gap-4 mb-5">
                  <div
                    onClick={() => staffPhotoRef.current?.click()}
                    className="w-20 h-20 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition overflow-hidden shrink-0"
                  >
                    {uploadingStaffPhoto ? (
                      <Loader2 size={24} className="theme-accent-text animate-spin" />
                    ) : staffPhotoPreview ? (
                      <img src={staffPhotoPreview} alt="Photo" className="w-full h-full object-cover" />
                    ) : (
                      <Camera size={24} className="text-gray-400" />
                    )}
                  </div>
                  <input ref={staffPhotoRef} type="file" accept="image/*" onChange={(e) => handlePhotoUpload(e, "staff")} className="hidden" />
                  <div>
                    <p className="text-sm font-medium text-gray-700">Passport Photo</p>
                    <p className="text-xs text-gray-400">Click to upload</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                    <input type="text" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
                    <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                    <input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">State of Origin</label>
                    <input type="text" value={form.stateOfOrigin} onChange={(e) => setForm({ ...form, stateOfOrigin: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                    <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Next of Kin</label>
                    <input type="text" value={form.nextOfKin} onChange={(e) => setForm({ ...form, nextOfKin: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Next of Kin Phone</label>
                    <input type="tel" value={form.nextOfKinPhone} onChange={(e) => setForm({ ...form, nextOfKinPhone: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                </div>
              </div>

              {/* Section 2: Guarantor */}
              <div>
                <h2 className="text-lg font-semibold theme-section-title mb-4 border-b theme-border-soft pb-2">Guarantor Information</h2>

                {/* Guarantor Photo */}
                <div className="flex items-center gap-4 mb-5">
                  <div
                    onClick={() => guarantorPhotoRef.current?.click()}
                    className="w-20 h-20 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition overflow-hidden shrink-0"
                  >
                    {uploadingGuarantorPhoto ? (
                      <Loader2 size={24} className="theme-accent-text animate-spin" />
                    ) : guarantorPhotoPreview ? (
                      <img src={guarantorPhotoPreview} alt="Guarantor" className="w-full h-full object-cover" />
                    ) : (
                      <Camera size={24} className="text-gray-400" />
                    )}
                  </div>
                  <input ref={guarantorPhotoRef} type="file" accept="image/*" onChange={(e) => handlePhotoUpload(e, "guarantor")} className="hidden" />
                  <div>
                    <p className="text-sm font-medium text-gray-700">Guarantor Photo</p>
                    <p className="text-xs text-gray-400">Click to upload</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Guarantor Name</label>
                    <input type="text" value={guarantor.name} onChange={(e) => setGuarantor({ ...guarantor, name: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input type="tel" value={guarantor.phone} onChange={(e) => setGuarantor({ ...guarantor, phone: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input type="email" value={guarantor.email} onChange={(e) => setGuarantor({ ...guarantor, email: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Relationship</label>
                    <input type="text" value={guarantor.relationship} onChange={(e) => setGuarantor({ ...guarantor, relationship: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Occupation</label>
                    <input type="text" value={guarantor.occupation} onChange={(e) => setGuarantor({ ...guarantor, occupation: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                    <textarea value={guarantor.address} onChange={(e) => setGuarantor({ ...guarantor, address: e.target.value })} rows={2} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
                  </div>
                </div>
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</p>}

              <button type="submit" disabled={submitting} className={`w-full py-3 rounded-lg font-semibold text-white transition ${submitting ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"}`}>
                {submitting ? "Submitting..." : "Submit Onboarding Form"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
