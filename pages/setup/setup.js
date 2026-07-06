import { useState, useEffect, useCallback } from "react";
import Layout from "@/components/Layout";
import { getCachedSetup, clearSetupCache } from "@/lib/setupCache";
import { useDialog } from "@/components/DialogProvider";
import { showToastMessage } from "@/lib/toast-state";
import { useAuth } from "@/lib/useAuth";

// Field component - defined outside to prevent re-creation on each render
const Field = ({ label, ...props }) => (
  <div className="flex flex-col">
    <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
    <input 
      {...props} 
      className="border border-gray-300 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
    />
  </div>
);

export default function Setup() {
  const { isAdmin } = useAuth();
  const { alert: showAlert, confirm: showConfirm } = useDialog();
  const [storeName, setStoreName] = useState("");
  const [storePhone, setStorePhone] = useState("");
  const [country, setCountry] = useState("");

  const [locations, setLocations] = useState([]);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [locationForm, setLocationForm] = useState({
    name: "",
    address: "",
    phone: "",
    email: "",
    code: "",
  });

  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const [logo, setLogo] = useState("");
  const [logoLoading, setLogoLoading] = useState(false);

  const [loading, setLoading] = useState(false);
  const [checkingLocationId, setCheckingLocationId] = useState(null);
  const [message, setMessage] = useState("");

  /* =====================
     FETCH DATA (cached – sessionStorage → localStorage → API)
  ===================== */
  useEffect(() => {
    async function fetchData() {
      try {
        const data = await getCachedSetup();
        const { store, user } = data || {};

        if (store) {
          setStoreName(store.storeName || "");
          setStorePhone(store.storePhone || "");
          setCountry(store.country || "");
          setLogo(store.logo || "");
          
          if (store.locations && store.locations.length > 0) {
            setLocations(store.locations);
            localStorage.removeItem("setupLocations");
          } else {
            const savedLocations = localStorage.getItem("setupLocations");
            if (savedLocations) {
              try {
                const parsed = JSON.parse(savedLocations);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  setLocations(parsed);
                }
              } catch (e) {
                localStorage.removeItem("setupLocations");
              }
            }
          }
        }

        if (user) {
          setAdminName(user.name || "");
          setAdminEmail(user.pendingEmail || user.email || "");
        }
      } catch (err) {
        console.error("Failed to load setup data:", err);
      }
    }

    fetchData();
  }, []);

  // Save locations to localStorage whenever they change
  useEffect(() => {
    if (locations && locations.length > 0) {
      localStorage.setItem("setupLocations", JSON.stringify(locations));
    }
  }, [locations]);

  useEffect(() => {
    if (!message) return;
    showToastMessage({ title: "Company details", text: message });
    setMessage("");
  }, [message]);

  /* =====================
     LOGO UPLOAD HANDLER
  ===================== */
  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLogoLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (data.links && data.links.length > 0) {
        setLogo(data.links[0].full);
        setMessage("✅ Logo uploaded successfully");
        setTimeout(() => setMessage(""), 3000);
      } else {
        setMessage("❌ Logo upload failed");
      }
    } catch (error) {
      console.error("Logo upload error:", error);
      setMessage("❌ Error uploading logo");
    } finally {
      setLogoLoading(false);
    }
  };

  /* =====================
     LOCATION HANDLERS
  ===================== */
  const handleLocationChange = useCallback((field, value) => {
    setLocationForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const addLocation = useCallback(() => {
    if (!locationForm.name.trim()) {
      setMessage("⚠️ Location name is required");
      return;
    }

    setLocations((prev) => [
      ...prev,
      { ...locationForm, isActive: true },
    ]);

    setLocationForm({
      name: "",
      address: "",
      phone: "",
      email: "",
      code: "",
    });

    setMessage("✅ Location added successfully");
    setTimeout(() => {
      setShowLocationForm(false);
      setMessage("");
    }, 1000);
  }, [locationForm]);

  const removeLocation = useCallback(async (index) => {
    const location = locations[index];
    if (!location) return;

    if (location._id && !isAdmin) {
      setMessage("⚠️ Only admin users can delete saved locations");
      return;
    }

    if (!location._id) {
      setLocations((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
      setMessage("✅ Unsaved location removed");
      return;
    }

    try {
      setCheckingLocationId(String(location._id));
      const response = await fetch(`/api/setup/location-references?locationId=${location._id}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to check location references");
      }

      const referencedItems = Object.entries(data.references || {})
        .filter(([, count]) => Number(count) > 0)
        .map(([key, count]) => ({
          label: key
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (value) => value.toUpperCase()),
          value: count,
        }));

      if (referencedItems.length > 0) {
        await showAlert({
          title: `Can't delete ${location.name}`,
          message: "This location is still referenced elsewhere. Remove those linked records first, then try again.",
          tone: "warning",
          confirmLabel: "Close",
          details: referencedItems,
        });
        return;
      }

      const shouldDelete = await showConfirm({
        title: `Delete ${location.name}?`,
        message: "This removes the location from the current setup draft. Save setup to apply the change permanently.",
        tone: "danger",
        confirmLabel: "Delete",
        cancelLabel: "Keep location",
      });

      if (!shouldDelete) {
        return;
      }

      setLocations((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
      setMessage("✅ Location removed from setup draft");
    } catch (error) {
      console.error("Failed to remove location:", error);
      setMessage(`❌ ${error.message}`);
    } finally {
      setCheckingLocationId(null);
    }
  }, [isAdmin, locations, showAlert, showConfirm]);

  /* =====================
     SUBMIT
  ===================== */
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!storeName.trim()) {
      setMessage("Store name is required");
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("/api/setup/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeName,
          storePhone,
          country,
          locations,
          logo,
          adminName,
          adminEmail,
          adminPassword,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        const savedUser = data?.data?.user;
        if (savedUser) {
          setAdminName(savedUser.name || adminName);
          setAdminEmail(savedUser.pendingEmail || savedUser.email || adminEmail);
        }

        setMessage(data.message || "✅ Setup saved successfully");
        setAdminPassword(""); // Clear password field after save
        // Clear caches so next load picks up fresh data
        localStorage.removeItem("setupLocations");
        clearSetupCache();
        setTimeout(() => setMessage(""), 3000);
      } else {
        setMessage("❌ Setup failed: " + (data.message || "Unknown error"));
      }
    } catch (error) {
      console.error("Setup error:", error);
      setMessage("❌ Error: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          {/* Header */}
          <div className="page-header">
            <h1 className="page-title">Store Setup & Configuration</h1>
            <p className="page-subtitle">Manage your store information, locations, and admin settings</p>
          </div>

          {/* Warning for unsaved locations */}
          {locations && locations.length > 0 && showLocationForm && (
            <div className="mb-6 bg-sky-50 border-l-4 border-sky-600 p-4 rounded-lg text-sm">
              <p className="text-sky-800">
                <strong>💾 Note:</strong> Added locations are saved to your browser. Click "Save Setup Configuration" to permanently save them to the database.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* SUMMARY - Left Column */}
            <div className="content-card">
              <div className="content-card-header">
                <h2 className="text-lg md:text-xl font-bold text-gray-900">Store Summary</h2>
              </div>

              <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Store Name</p>
                  <p className="text-lg font-semibold text-gray-900">{storeName || "Not set"}</p>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Phone</p>
                  <p className="text-lg font-semibold text-gray-900">{storePhone || "Not set"}</p>
                </div>

                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-sm text-gray-600">Country</p>
                  <p className="text-lg font-semibold text-gray-900">{country || "Not set"}</p>
                </div>

                {logo && (
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <p className="text-sm text-gray-600 mb-2">Company Logo</p>
                    <img src={logo} alt="Company Logo" className="w-32 h-auto rounded-lg border border-gray-200" />
                  </div>
                )}

                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h3 className="font-bold text-gray-900 mb-4">Locations ({locations.length})</h3>
                  <div className="space-y-3">
                    {locations.length ? locations.map((l, i) => (
                      <div key={l._id || `${l.name}-${i}`} className="bg-cyan-50 border border-cyan-200 p-4 rounded-lg">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-gray-900">{l.name}</div>
                            <div className="text-sm text-gray-600 mt-1">{l.address}</div>
                            <div className="text-sm text-gray-600">{l.phone}</div>
                            {l._id && <div className="mt-1 text-[11px] text-cyan-700">ID locked: {l._id}</div>}
                          </div>
                          <button
                            type="button"
                            onClick={() => removeLocation(i)}
                            disabled={checkingLocationId === String(l._id || "") || (!!l._id && !isAdmin)}
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                            title={l._id && !isAdmin ? "Only admins can delete saved locations" : "Remove location"}
                          >
                            {checkingLocationId === String(l._id || "") ? "Checking..." : "Delete"}
                          </button>
                        </div>
                      </div>
                    )) : <p className="text-gray-500 text-sm italic">No locations added yet</p>}
                  </div>
                  {!isAdmin && locations.some((location) => location?._id) && (
                    <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Saved locations can only be deleted by an admin.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* FORM - Right Column */}
            <div className="content-card">
              <div className="content-card-header">
                <h2 className="text-xl font-bold text-gray-900">Update Configuration</h2>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-4">
                  <Field label="Store Name" value={storeName} onChange={(e) => setStoreName(e.target.value)} />
                  <Field label="Store Phone" value={storePhone} onChange={(e) => setStorePhone(e.target.value)} />
                  <Field label="Country" value={country} onChange={(e) => setCountry(e.target.value)} />
                </div>

                {/* LOGO UPLOAD SECTION */}
                <div className="pt-4 border-t border-gray-200">
                  <label className="block text-sm font-semibold text-gray-700 mb-3">Company Logo</label>
                  <div className="flex gap-3 items-start">
                    <div className="flex-1">
                      <label className="block border-2 border-dashed border-gray-300 rounded-lg p-4 cursor-pointer hover:border-cyan-500 hover:bg-cyan-50 transition">
                        <div className="text-center">
                          <div className="text-2xl mb-2">📸</div>
                          <p className="text-sm text-gray-600">{logoLoading ? "Uploading..." : "Click to upload logo"}</p>
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleLogoUpload}
                          disabled={logoLoading}
                          className="hidden"
                        />
                      </label>
                    </div>
                    {logo && (
                      <div className="w-20 h-20 rounded-lg overflow-hidden border border-gray-200 flex-shrink-0">
                        <img src={logo} alt="Company Logo" className="w-full h-full object-cover" />
                      </div>
                    )}
                  </div>
                </div>

                {/* LOCATION SECTION */}
                <div className="pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setShowLocationForm(!showLocationForm);
                    }}
                    className="btn-action-primary w-full"
                  >
                    {showLocationForm ? '− Cancel' : '+ Add Location'}
                  </button>

                  {showLocationForm && (
                    <div className="mt-4 border border-cyan-200 bg-cyan-50 p-4 rounded-lg space-y-3">
                      <Field 
                        label="Location Name" 
                        type="text"
                        value={locationForm.name} 
                        onChange={(e) => handleLocationChange("name", e.target.value)} 
                        placeholder="e.g., Main Store" 
                      />
                      <Field 
                        label="Address" 
                        type="text"
                        value={locationForm.address} 
                        onChange={(e) => handleLocationChange("address", e.target.value)} 
                        placeholder="Street address" 
                      />
                      <Field 
                        label="Phone" 
                        type="tel"
                        value={locationForm.phone} 
                        onChange={(e) => handleLocationChange("phone", e.target.value)} 
                        placeholder="Location phone number" 
                      />
                      <Field 
                        label="Email" 
                        type="email"
                        value={locationForm.email} 
                        onChange={(e) => handleLocationChange("email", e.target.value)} 
                        placeholder="Location email" 
                      />
                      <Field 
                        label="Code" 
                        type="text"
                        value={locationForm.code} 
                        onChange={(e) => handleLocationChange("code", e.target.value)} 
                        placeholder="Location code (optional)" 
                      />

                      <button 
                        type="button" 
                        onClick={(e) => {
                          e.preventDefault();
                          addLocation();
                        }} 
                        className="btn-action-success w-full"
                      >
                        Save Location
                      </button>
                    </div>
                  )}
                </div>

                {/* ADMIN SECTION */}
                <div className="pt-4 border-t border-gray-200 space-y-4">
                  <p className="text-sm font-semibold text-gray-700">Admin Settings</p>
                  <Field label="Admin Name" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
                  <Field label="Admin Email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
                  <Field label="New Password (Optional)" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
                </div>

                <button className="btn-action-primary w-full text-lg mt-6" disabled={loading}>
                  {loading ? "Saving..." : "Save Setup Configuration"}
                </button>

              </form>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}



