"use client";

import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import useProgress from "@/lib/useProgress";
import QRCode from "qrcode";

function parseNumberOrDefault(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export default function Receipts() {
  const [companyName, setCompanyName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [storePhone, setStorePhone] = useState("");
  const [country, setCountry] = useState("");
  const [staffName, setStaffName] = useState("");
  const [companyDisplayName, setCompanyDisplayName] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [refundDays, setRefundDays] = useState(0);
  const [receiptMessage, setReceiptMessage] = useState("");
  const [fontSize, setFontSize] = useState("8.0");
  const [fontFamily, setFontFamily] = useState("Arial");
  const [barcodeType, setBarcodeType] = useState("Default - Code 39");
  const [companyLogo, setCompanyLogo] = useState("/images/logo.png");
  const [qrUrl, setQrUrl] = useState("");
  const [qrDescription, setQrDescription] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrGenerating, setQrGenerating] = useState(false);
  const [locationQrData, setLocationQrData] = useState({}); // { locationId: { qrUrl, qrDataUrl } }
  const [qrMode, setQrMode] = useState("global"); // "global" or "per-location"
  const [qrLocationId, setQrLocationId] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("paid");
  const [shippingBaseCost, setShippingBaseCost] = useState(2000);
  const [shippingRatePerKm, setShippingRatePerKm] = useState(100);
  const [shippingFallbackCost, setShippingFallbackCost] = useState(2000);
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [loading, setLoading] = useState(true);
  const { progress, start, onFetch, onProcess, complete } = useProgress();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const GUID = "75c09f89-1d79-47cd-8afa-065873c6f43b";
  const companyNameDisplay = "St's Michael Hub";
  const previewLocation = locations.find((loc) => loc.name === selectedLocation);
  const previewDisplayName = companyDisplayName || companyName || companyNameDisplay;
  const previewContactLine = [
    storePhone ? `Tel: ${storePhone}` : "",
    website,
    email,
  ].filter(Boolean).join(" • ");

  useEffect(() => {
    fetchSetupData();
  }, []);

  const fetchSetupData = async () => {
    try {
      setLoading(true);
      start();
      onFetch();
      const res = await fetch("/api/setup/get");
      const data = await res.json();
      
      onProcess();
      if (data.store) {
        setCompanyName(data.store.companyName || "");
        setStoreName(data.store.storeName || "");
        setStorePhone(data.store.storePhone || "");
        setCountry(data.store.country || "");
        setEmail(data.store.email || "");
        setCompanyDisplayName(data.store.companyDisplayName || "");
        setTaxNumber(data.store.taxNumber || "");
        setWebsite(data.store.website || "");
        setRefundDays(data.store.refundDays || 0);
        setReceiptMessage(data.store.receiptMessage || "");
        setFontSize(data.store.fontSize || "8.0");
        setFontFamily(data.store.fontFamily || "Arial");
        setBarcodeType(data.store.barcodeType || "Default - Code 39");
        setQrUrl(data.store.qrUrl || "");
        setQrDescription(data.store.qrDescription || "");
        setQrDataUrl(data.store.qrDataUrl || "");
        setPaymentStatus(data.store.paymentStatus || "paid");
        setShippingBaseCost(parseNumberOrDefault(data.store.shippingBaseCost, 2000));
        setShippingRatePerKm(parseNumberOrDefault(data.store.shippingRatePerKm, 100));
        setShippingFallbackCost(
          parseNumberOrDefault(
            data.store.shippingFallbackCost,
            parseNumberOrDefault(data.store.shippingBaseCost, 2000)
          )
        );
        
        // Load locations from store
        if (data.store.locations && data.store.locations.length > 0) {
          setLocations(data.store.locations);
          setSelectedLocation(data.store.locations[0].name);
          // Load per-location QR data
          const locQrMap = {};
          data.store.locations.forEach((loc) => {
            if (loc.qrUrl || loc.qrDataUrl) {
              locQrMap[loc._id] = { qrUrl: loc.qrUrl || "", qrDataUrl: loc.qrDataUrl || "" };
            }
          });
          setLocationQrData(locQrMap);
          // If any location has QR data, default to per-location mode
          if (Object.keys(locQrMap).length > 0) {
            setQrMode("per-location");
            setQrLocationId(data.store.locations[0]._id);
          }
        }
        
        // Use logo from /public/images/logo.png or fall back to images folder
        if (data.store.logo) {
          setCompanyLogo(data.store.logo);
        }
        
        // Try to get receipt settings from localStorage or API
        const receiptSettings = localStorage.getItem("receiptSettings");
        if (receiptSettings) {
          const settings = JSON.parse(receiptSettings);
          setCompanyDisplayName(settings.companyDisplayName || data.store.companyDisplayName || "");
          setTaxNumber(settings.taxNumber || data.store.taxNumber || "");
          setWebsite(settings.website || data.store.website || "");
          setRefundDays(settings.refundDays || data.store.refundDays || 0);
          setReceiptMessage(settings.receiptMessage || data.store.receiptMessage || "");
          setFontSize(settings.fontSize || data.store.fontSize || "8.0");
          setFontFamily(settings.fontFamily || data.store.fontFamily || "Arial");
          setBarcodeType(settings.barcodeType || data.store.barcodeType || "Default - Code 39");
          setQrUrl(settings.qrUrl || data.store.qrUrl || "");
          setQrDescription(settings.qrDescription || data.store.qrDescription || "");
          setQrDataUrl(settings.qrDataUrl || data.store.qrDataUrl || "");
          setPaymentStatus(settings.paymentStatus || data.store.paymentStatus || "paid");
          setShippingBaseCost(parseNumberOrDefault(settings.shippingBaseCost ?? data.store.shippingBaseCost, 2000));
          setShippingRatePerKm(parseNumberOrDefault(settings.shippingRatePerKm ?? data.store.shippingRatePerKm, 100));
          setShippingFallbackCost(
            parseNumberOrDefault(
              settings.shippingFallbackCost ?? data.store.shippingFallbackCost,
              parseNumberOrDefault(settings.shippingBaseCost ?? data.store.shippingBaseCost, 2000)
            )
          );
          // Load logo from localStorage if it exists
          if (settings.companyLogo) {
            setCompanyLogo(settings.companyLogo);
          }
        }
      }
    } catch (err) {
      console.error("Error fetching setup data:", err);
      setError("Failed to load receipt settings");
    } finally {
      complete();
      setLoading(false);
    }
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      // For production, you'd upload to server, but for now we'll use the images folder
      setCompanyLogo(`/images/${file.name}`);
    }
  };

  const removeLogo = () => setCompanyLogo("/images/logo.png");

  const generateQRCode = async () => {
    const urlToEncode = qrMode === "per-location" && qrLocationId
      ? (locationQrData[qrLocationId]?.qrUrl || "").trim()
      : qrUrl.trim();
    if (!urlToEncode) return;
    setQrGenerating(true);
    try {
      const dataUrl = await QRCode.toDataURL(urlToEncode, {
        width: 150,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });
      if (qrMode === "per-location" && qrLocationId) {
        setLocationQrData((prev) => ({
          ...prev,
          [qrLocationId]: { qrUrl: urlToEncode, qrDataUrl: dataUrl },
        }));
      } else {
        setQrDataUrl(dataUrl);
      }
    } catch (err) {
      console.error("QR generation failed:", err);
    } finally {
      setQrGenerating(false);
    }
  };

  // Auto-regenerate QR when URL changes (global mode only)
  useEffect(() => {
    if (qrMode !== "global") return;
    if (qrDataUrl && qrUrl.trim()) {
      const timer = setTimeout(() => generateQRCode(), 500);
      return () => clearTimeout(timer);
    }
    if (!qrUrl.trim()) setQrDataUrl("");
  }, [qrUrl]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");
      setSuccess("");
      
      // Validate required fields
      if (!storeName || !storePhone) {
        setError("Store name and store phone are required");
        setSaving(false);
        return;
      }
      
      // Save receipt settings to database
      const payload = {
        companyDisplayName,
        taxNumber,
        website,
        refundDays,
        receiptMessage,
        fontSize,
        fontFamily,
        barcodeType,
        qrUrl,
        qrDescription,
        qrDataUrl,
        paymentStatus,
        shippingBaseCost: Number(shippingBaseCost) || 0,
        shippingRatePerKm: Number(shippingRatePerKm) || 0,
        shippingFallbackCost: Number(shippingFallbackCost) || Number(shippingBaseCost) || 0,
        companyLogo,
        staffName,
        locationQrData,
      };
      
      // Send to API to save in database
      const res = await fetch("/api/setup/setup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storeName,
          storePhone,
          email,
          country: country || "Unknown",
          logo: companyLogo,
          receiptSettings: payload,
        }),
      });

      const data = await res.json();
      
      if (data.success) {
        // Also save to localStorage as backup
        localStorage.setItem("receiptSettings", JSON.stringify(payload));
        setSuccess("Receipt settings saved successfully!");
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.message || "Failed to save receipt settings");
      }
    } catch (err) {
      console.error("Error saving:", err);
      setError("Failed to save receipt settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <Loader size="lg" text="Loading receipt settings..." progress={progress} />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          <div className="page-header">
            <h1 className="page-title">Receipt Settings</h1>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-6 flex items-center gap-2">
              <span>⚠️</span> {error}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg mb-6 flex items-center gap-2">
              <span>✅</span> {success}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* LEFT SIDE - FORM */}
            <div className="lg:col-span-2">
              <div className="content-card space-y-6">
                {/* Company Info */}
                <div className="flex flex-col space-y-4">
                  <div className="form-group">
                    <label className="form-label">Company Name (Display: St's Michael Hub)</label>
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      className="form-input bg-gray-100 cursor-not-allowed"
                      disabled
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Store Name (Note: Dynamically set from transaction location)</label>
                    <input
                      type="text"
                      value={storeName}
                      onChange={(e) => setStoreName(e.target.value)}
                      className="form-input bg-gray-100 cursor-not-allowed text-gray-500"
                      placeholder="Will be pulled from transaction location"
                      disabled
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Staff Name (Note: Dynamically set from transaction staff)</label>
                    <input
                      type="text"
                      value={staffName}
                      onChange={(e) => setStaffName(e.target.value)}
                      className="form-input bg-gray-100 cursor-not-allowed text-gray-500"
                      placeholder="Will be pulled from transaction staff"
                      disabled
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Store Phone</label>
                    <input
                      type="text"
                      value={storePhone}
                      onChange={(e) => setStorePhone(e.target.value)}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Country</label>
                    <input
                      type="text"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="form-input"
                      placeholder="e.g., Kenya, USA, India"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Company Display Name</label>
                    <input
                      type="text"
                      placeholder="Leave blank to use company name"
                      value={companyDisplayName}
                      onChange={(e) => setCompanyDisplayName(e.target.value)}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Tax Number</label>
                    <input
                      type="text"
                      value={taxNumber}
                      onChange={(e) => setTaxNumber(e.target.value)}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Email Address</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Website Address</label>
                    <input
                      type="text"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      className="form-input"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Refund Days</label>
                    <input
                      type="number"
                      value={refundDays}
                      onChange={(e) => setRefundDays(e.target.value)}
                      className="form-input"
                      min={0}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Receipt Message</label>
                    <textarea
                      value={receiptMessage}
                      onChange={(e) => setReceiptMessage(e.target.value)}
                      className="form-input"
                      rows={3}
                    />
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-slate-900">Shipping Pricing</h3>
                      <p className="text-xs text-slate-600 mt-1">
                        These values are used by the webpage checkout when calculating delivery totals.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="form-group mb-0">
                        <label className="form-label">Base Cost</label>
                        <input
                          type="number"
                          min={0}
                          value={shippingBaseCost}
                          onChange={(e) => setShippingBaseCost(e.target.value)}
                          className="form-input"
                        />
                      </div>

                      <div className="form-group mb-0">
                        <label className="form-label">Rate Per KM</label>
                        <input
                          type="number"
                          min={0}
                          value={shippingRatePerKm}
                          onChange={(e) => setShippingRatePerKm(e.target.value)}
                          className="form-input"
                        />
                      </div>

                      <div className="form-group mb-0">
                        <label className="form-label">Fallback Cost</label>
                        <input
                          type="number"
                          min={0}
                          value={shippingFallbackCost}
                          onChange={(e) => setShippingFallbackCost(e.target.value)}
                          className="form-input"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Receipt Typography */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-slate-900">Receipt Typography</h3>
                    <p className="text-xs text-slate-600 mt-1">
                      Controls how text appears on printed receipts in the Point of Sale.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="form-group mb-0">
                      <label className="form-label">Font Size</label>
                      <select
                        value={fontSize}
                        onChange={(e) => setFontSize(e.target.value)}
                        className="form-select"
                      >
                        <option value="4.0">Ultra Micro - 4.0pt</option>
                        <option value="4.5">Nano - 4.5pt</option>
                        <option value="5.0">Sub Micro - 5.0pt</option>
                        <option value="5.5">Micro - 5.5pt</option>
                        <option value="6.0">Tiny - 6.0pt</option>
                        <option value="6.5">Eco Compact - 6.5pt</option>
                        <option value="7.0">Compact - 7.0pt</option>
                        <option value="7.5">Small - 7.5pt</option>
                        <option value="8.0">Standard - 8.0pt</option>
                        <option value="8.5">Medium - 8.5pt</option>
                        <option value="9.0">Large - 9.0pt</option>
                      </select>
                    </div>

                    <div className="form-group mb-0">
                      <label className="form-label">Font Family</label>
                      <select
                        value={fontFamily}
                        onChange={(e) => setFontFamily(e.target.value)}
                        className="form-select"
                      >
                        <option value="Arial">Arial (Default)</option>
                        <option value="Courier New">Courier New (Monospace)</option>
                        <option value="Times New Roman">Times New Roman (Serif)</option>
                        <option value="Verdana">Verdana (Clean)</option>
                        <option value="Georgia">Georgia (Elegant)</option>
                        <option value="Tahoma">Tahoma (Compact)</option>
                        <option value="Roboto">Roboto (Modern)</option>
                        <option value="Mono">Mono (Fixed-width)</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Barcode Type */}
                <div className="form-group">
                  <label className="form-label">Barcode Type</label>
                  <select
                    value={barcodeType}
                    onChange={(e) => setBarcodeType(e.target.value)}
                    className="form-select"
                  >
                    <option value="Default - Code 39">Default - Code 39</option>
                    <option value="Code 128">Code 128</option>
                    <option value="EAN-13">EAN-13</option>
                  </select>
                </div>

                {/* Location Selection for Preview */}
                {locations.length > 0 && (
                  <div className="form-group">
                    <label className="form-label">Select Location for Preview</label>
                    <select
                      value={selectedLocation}
                      onChange={(e) => setSelectedLocation(e.target.value)}
                      className="form-select"
                    >
                      {locations.map((loc) => (
                        <option key={loc._id || loc.name} value={loc.name}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Company Logo */}
                <div className="form-group">
                  <label className="form-label">Company Logo</label>
                  <div className="border-2 border-dashed border-gray-300 p-4 rounded-lg text-center cursor-pointer relative hover:border-sky-400 transition-colors">
                    {companyLogo ? (
                      <div className="relative">
                        <img src={companyLogo} className="mx-auto h-32 object-contain" alt="Company Logo" />
                        <button
                          onClick={removeLogo}
                          className="btn-action btn-action-danger text-xs absolute top-2 right-2"
                        >
                          REMOVE
                        </button>
                      </div>
                    ) : (
                      <p className="text-gray-400">Drop your file here or click to upload</p>
                    )}
                    <input
                      type="file"
                      accept="image/png, image/jpeg"
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      onChange={handleLogoUpload}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Logo should be no larger than 256x256 pixels in JPG or PNG format.
                  </p>
                </div>

                {/* QR Code */}
                <div className="form-group space-y-3">
                  {/* QR Mode Toggle */}
                  {locations.length > 0 && (
                    <div className="flex items-center gap-4 mb-2">
                      <label className="form-label mb-0">QR Code Mode:</label>
                      <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input
                          type="radio"
                          value="global"
                          checked={qrMode === "global"}
                          onChange={() => setQrMode("global")}
                        />
                        Global (all locations)
                      </label>
                      <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input
                          type="radio"
                          value="per-location"
                          checked={qrMode === "per-location"}
                          onChange={() => {
                            setQrMode("per-location");
                            if (!qrLocationId && locations.length > 0) {
                              setQrLocationId(locations[0]._id);
                            }
                          }}
                        />
                        Per Location
                      </label>
                    </div>
                  )}

                  {/* Per-location selector */}
                  {qrMode === "per-location" && locations.length > 0 && (
                    <div className="form-group">
                      <label className="form-label">Select Location for QR</label>
                      <select
                        value={qrLocationId}
                        onChange={(e) => setQrLocationId(e.target.value)}
                        className="form-select"
                      >
                        {locations.map((loc) => (
                          <option key={loc._id} value={loc._id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="form-label">
                      QR Code URL or Link
                      {qrMode === "per-location" && qrLocationId && (
                        <span className="text-xs text-blue-600 ml-2">
                          ({locations.find(l => l._id === qrLocationId)?.name})
                        </span>
                      )}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Example: https://google.com"
                        value={qrMode === "per-location" && qrLocationId
                          ? (locationQrData[qrLocationId]?.qrUrl || "")
                          : qrUrl}
                        onChange={(e) => {
                          if (qrMode === "per-location" && qrLocationId) {
                            setLocationQrData((prev) => ({
                              ...prev,
                              [qrLocationId]: { ...prev[qrLocationId], qrUrl: e.target.value },
                            }));
                          } else {
                            setQrUrl(e.target.value);
                          }
                        }}
                        className="form-input flex-1"
                      />
                      <button
                        type="button"
                        onClick={generateQRCode}
                        disabled={
                          qrGenerating ||
                          (qrMode === "per-location" && qrLocationId
                            ? !(locationQrData[qrLocationId]?.qrUrl || "").trim()
                            : !qrUrl.trim())
                        }
                        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                      >
                        {qrGenerating ? "Generating..." : "Generate QR Code"}
                      </button>
                    </div>
                  </div>

                  {/* QR Preview */}
                  {(() => {
                    const previewDataUrl = qrMode === "per-location" && qrLocationId
                      ? (locationQrData[qrLocationId]?.qrDataUrl || "")
                      : qrDataUrl;
                    const previewUrl = qrMode === "per-location" && qrLocationId
                      ? (locationQrData[qrLocationId]?.qrUrl || "")
                      : qrUrl;
                    return previewDataUrl ? (
                      <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <img src={previewDataUrl} alt="QR Code Preview" className="w-20 h-20 rounded" />
                        <div className="text-sm text-green-700">
                          <p className="font-medium">QR Code Generated</p>
                          <p className="text-xs text-green-600 mt-0.5 break-all">{previewUrl}</p>
                        </div>
                      </div>
                    ) : null;
                  })()}

                  <div>
                    <label className="form-label">QR Code Description</label>
                    <input
                      type="text"
                      placeholder="Please scan here and leave us a review"
                      value={qrDescription}
                      onChange={(e) => setQrDescription(e.target.value)}
                      className="form-input"
                    />
                  </div>
                </div>

                {/* Payment Status */}
                <div className="form-group">
                  <label className="form-label">Default Payment Status</label>
                  <select
                    value={paymentStatus}
                    onChange={(e) => setPaymentStatus(e.target.value)}
                    className="form-select"
                  >
                    <option value="paid">PAID</option>
                    <option value="unpaid">UNPAID</option>
                  </select>
                </div>

                {/* GUID */}
                <div className="form-group">
                  <label className="form-label">GUID (Used by Support only)</label>
                  <input
                    type="text"
                    value={GUID}
                    readOnly
                    className="form-input bg-gray-100 cursor-not-allowed text-gray-600"
                  />
                </div>
              </div>
            </div>

            {/* RIGHT SIDE - PREVIEW */}
            <div className="lg:col-span-1">
              <div className="content-card sticky top-6">
                <h2 className="text-lg font-bold mb-4 text-gray-800">Receipt Preview</h2>
              <div 
                className="bg-white rounded border border-gray-300 overflow-y-auto max-h-[700px]"
                style={{ fontSize: `${fontSize}pt`, fontFamily: fontFamily === 'Mono' || fontFamily === 'Courier New' ? '"Courier New", monospace' : fontFamily === 'Times New Roman' ? '"Times New Roman", serif' : `"${fontFamily}", sans-serif`, lineHeight: '1.18', padding: '2mm 0' }}
              >
                <div className="mx-auto w-full max-w-[280px] text-gray-900">
                  {companyLogo && (
                    <img
                      src={companyLogo}
                      alt="Logo"
                      className="mx-auto object-contain"
                      style={{ filter: 'grayscale(100%) contrast(1.05)', marginBottom: '1mm', maxHeight: '12mm' }}
                    />
                  )}

                  <div className="text-center" style={{ paddingBottom: '1.5mm', borderBottom: '0.5px dashed #444' }}>
                    <div className="font-bold uppercase" style={{ fontSize: '1.25em', letterSpacing: '0.08em' }}>
                      {previewDisplayName}
                    </div>
                    <div style={{ fontSize: '0.92em' }}>{selectedLocation || "[Location from Transaction]"}</div>
                    {previewLocation?.address && (
                      <div style={{ fontSize: '0.9em' }}>{previewLocation.address}</div>
                    )}
                    {previewContactLine && (
                      <div className="break-words" style={{ fontSize: '0.88em' }}>{previewContactLine}</div>
                    )}
                    {taxNumber && (
                      <div style={{ fontSize: '0.88em' }}>Tax ID: {taxNumber}</div>
                    )}
                  </div>

                  <div className="text-left" style={{ margin: '1mm 0' }}>
                    <div className="font-bold uppercase">Sales Receipt</div>
                    <div className="flex justify-between gap-2">
                      <span>03/07/2022 12:24:57</span>
                      <span>SAMPLE</span>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span>Staff: {staffName ? staffName : '[Staff Name]'}</span>
                      <span>{paymentStatus.toUpperCase()}</span>
                    </div>
                  </div>

                  <div style={{ borderTop: '0.5px dashed #444', padding: '1mm 0' }}>
                    <div className="grid grid-cols-[2.4fr_1fr_0.5fr_1fr] font-bold uppercase" style={{ gap: '1px', marginBottom: '0.5mm', fontSize: '0.9em' }}>
                      <span>Item</span>
                      <span className="text-right">Rate</span>
                      <span className="text-center">Qty</span>
                      <span className="text-right">Total</span>
                    </div>
                    <div>
                      <div className="grid grid-cols-[2.4fr_1fr_0.5fr_1fr]" style={{ gap: '1px' }}>
                        <span>SAMPLE ITEM 1</span>
                        <span className="text-right">₦1,500</span>
                        <span className="text-center">1</span>
                        <span className="text-right">₦1,500</span>
                      </div>
                      <div className="grid grid-cols-[2.4fr_1fr_0.5fr_1fr]" style={{ gap: '1px' }}>
                        <span>SAMPLE ITEM 2</span>
                        <span className="text-right">₦2,000</span>
                        <span className="text-center">1</span>
                        <span className="text-right">₦2,000</span>
                      </div>
                    </div>
                    <div className="flex justify-between" style={{ marginTop: '0.5mm', paddingTop: '0.5mm', fontSize: '0.84em', borderTop: '0.5px dotted #888' }}>
                      <span>Total Qty</span>
                      <span>2</span>
                    </div>
                  </div>

                  <div className="text-left" style={{ borderTop: '0.5px dashed #444', padding: '1mm 0' }}>
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span>₦3,500.00</span>
                    </div>
                    <div className="flex justify-between font-bold text-[1.02em]" style={{ paddingTop: '0.8mm', marginTop: '0.8mm', borderTop: '0.5px dashed #444' }}>
                      <span>Total</span>
                      <span>₦3,500.00</span>
                    </div>
                  </div>

                  <div className="text-left" style={{ borderTop: '0.5px dashed #444', padding: '1mm 0' }}>
                    <div className="font-bold uppercase">Payment</div>
                    <div className="flex justify-between">
                      <span>CASH</span>
                      <span>₦3,500.00</span>
                    </div>
                  </div>

                  <div className="text-center" style={{ borderTop: '0.5px dashed #444', paddingTop: '1mm', fontSize: '0.84em' }}>
                    {refundDays > 0 ? (
                      <div>Refund within {refundDays} days with receipt</div>
                    ) : null}

                    {(qrDataUrl || qrUrl || (qrMode === "per-location" && qrLocationId && locationQrData[qrLocationId]?.qrDataUrl)) ? (
                      <div style={{ marginTop: '1mm' }}>
                        {qrDescription ? <div>{qrDescription}</div> : null}
                        {(() => {
                          const previewQrDataUrl = qrMode === "per-location" && qrLocationId
                            ? (locationQrData[qrLocationId]?.qrDataUrl || "")
                            : qrDataUrl;
                          const previewQrUrl = qrMode === "per-location" && qrLocationId
                            ? (locationQrData[qrLocationId]?.qrUrl || "")
                            : qrUrl;
                          return previewQrDataUrl ? (
                            <img src={previewQrDataUrl} alt="QR Code" className="mx-auto" style={{ width: '18mm', height: '18mm', margin: '1mm auto' }} />
                          ) : previewQrUrl ? (
                            <div className="break-all text-[0.8em]">{previewQrUrl}</div>
                          ) : null;
                        })()}
                      </div>
                    ) : null}

                    {receiptMessage ? (
                      <div style={{ marginTop: '1mm' }} className="whitespace-pre-wrap">{receiptMessage}</div>
                    ) : null}

                    <div className="font-bold uppercase tracking-[0.08em]" style={{ marginTop: '1.5mm' }}>
                      Thank You
                    </div>

                    <div
                      className={`font-bold uppercase tracking-[0.08em] ${paymentStatus === 'paid' ? '' : 'border border-black bg-gray-100'}`}
                      style={{ marginTop: '1mm', paddingTop: paymentStatus === 'paid' ? '0' : '1mm', paddingBottom: paymentStatus === 'paid' ? '0' : '1mm' }}
                    >
                      {paymentStatus.toUpperCase()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-4 mt-6">
          <button
            onClick={() => window.history.back()}
            className="btn-action btn-action-danger"
            disabled={saving}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-action btn-action-success"
          >
            {saving ? "SAVING..." : "SAVE"}
          </button>
        </div>
        </div>
      </div>
    </Layout>
  );
}

