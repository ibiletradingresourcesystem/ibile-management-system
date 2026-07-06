import mongoose, { Schema, models } from "mongoose";

const SystemThemeSchema = new Schema(
  {
    // Only one theme document per system (singleton)
    key: { type: String, default: "system-theme", unique: true },

    // Primary color palette
    primaryColor: { type: String, default: "#0ea5e9" }, // sky-500
    
    // Secondary color
    secondaryColor: { type: String, default: "#06b6d4" }, // cyan-500

    // Sidebar / Nav
    sidebarBg: { type: String, default: "#f9fafb" }, // gray-50
    sidebarActiveGradientFrom: { type: String, default: "#2563eb" }, // blue-600
    sidebarActiveGradientTo: { type: String, default: "#1d4ed8" }, // blue-700

    // Table header
    tableHeaderGradientFrom: { type: String, default: "#0284c7" }, // sky-600
    tableHeaderGradientTo: { type: String, default: "#0369a1" }, // sky-700

    // Button primary
    buttonPrimaryBg: { type: String, default: "#0284c7" }, // sky-600
    buttonPrimaryHover: { type: String, default: "#0369a1" }, // sky-700

    // Page background
    pageBg: { type: String, default: "#f9fafb" }, // gray-50

    // Accent colors
    successColor: { type: String, default: "#10b981" },
    warningColor: { type: String, default: "#f59e0b" },
    errorColor: { type: String, default: "#ef4444" },
    infoColor: { type: String, default: "#3b82f6" },

    // Preset name (for quick switching)
    presetName: { type: String, default: "Default Blue" },
  },
  { timestamps: true }
);

export default models.SystemTheme || mongoose.model("SystemTheme", SystemThemeSchema);
