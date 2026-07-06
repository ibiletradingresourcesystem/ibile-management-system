import { mongooseConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import User from "@/models/User";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { authMiddleware, isAdmin, isStaff } from "@/lib/auth-middleware";
import { createMailTransport, getMailFromAddress } from "@/lib/mail";
import { deleteS3Url } from "@/lib/s3";

function sanitizeUser(user) {
  if (!user) return null;
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    pendingEmail: user.pendingEmail || "",
    emailChangeExpiresAt: user.emailChangeExpiresAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function getAppBaseUrl(req) {
  const configuredBaseUrl = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.APP_URL,
    process.env.NEXTAUTH_URL,
    process.env.SITE_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
  ].find((value) => typeof value === "string" && value.trim());

  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function hashEmailChangeToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function buildPendingEmailRestoreUpdate(user) {
  const set = {};
  const unset = {};

  if (user?.pendingEmail) set.pendingEmail = user.pendingEmail;
  else unset.pendingEmail = 1;

  if (user?.emailChangeTokenHash) set.emailChangeTokenHash = user.emailChangeTokenHash;
  else unset.emailChangeTokenHash = 1;

  if (user?.emailChangeExpiresAt) set.emailChangeExpiresAt = user.emailChangeExpiresAt;
  else unset.emailChangeExpiresAt = 1;

  const update = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return update;
}

async function sendAdminEmailChangeVerificationEmail({ req, currentEmail, currentName, pendingEmail, token }) {
  const transporter = createMailTransport();
  if (!transporter) {
    throw new Error("Email configuration is missing. Configure SMTP or EMAIL_USER/EMAIL_PASS to verify admin email changes.");
  }

  const verifyUrl = new URL(
    `/setup/verify-admin-email?token=${encodeURIComponent(token)}`,
    getAppBaseUrl(req)
  ).toString();

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; background: #f8fafc; color: #0f172a;">
      <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);">
        <div style="background: #0f766e; color: white; padding: 24px;">
          <h1 style="margin: 0; font-size: 22px;">Verify Admin Email Change</h1>
          <p style="margin: 8px 0 0; opacity: 0.9;">Confirm this change from the current admin inbox before the login email is updated.</p>
        </div>
        <div style="padding: 24px; line-height: 1.6;">
          <p>Hello ${currentName || "Admin"},</p>
          <p>You requested to change the admin login email for your inventory system.</p>
          <div style="background: #f1f5f9; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p style="margin: 0 0 8px;"><strong>Current email:</strong> ${currentEmail}</p>
            <p style="margin: 0;"><strong>New email:</strong> ${pendingEmail}</p>
          </div>
          <p>If you initiated this request, verify it below. This link expires in 24 hours.</p>
          <div style="margin: 24px 0; text-align: center;">
            <a href="${verifyUrl}" style="display: inline-block; background: #0f766e; color: white; text-decoration: none; padding: 12px 22px; border-radius: 999px; font-weight: 700;">
              Verify Admin Email Change
            </a>
          </div>
          <p style="margin-bottom: 0; color: #475569; font-size: 14px;">If the button does not work, copy and paste this link into your browser:<br /><a href="${verifyUrl}">${verifyUrl}</a></p>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: getMailFromAddress("Inventory Setup"),
    to: currentEmail,
    subject: "Verify your admin email change",
    html,
  });
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      await mongooseConnect();

      const [store, user] = await Promise.all([
        Store.findOne({}),
        User.findOne({ role: "admin" }).select(
          "name email role isActive pendingEmail emailChangeExpiresAt createdAt updatedAt"
        ),
      ]);

      // Once setup exists, access requires authenticated staff.
      if (store || user) {
        const authError = authMiddleware(req, res);
        if (authError) return authError;
        if (!isStaff(req)) {
          return res
            .status(403)
            .json({ success: false, message: "Insufficient permissions" });
        }

        if (req.user?.id) {
          const currentUser = await User.findById(req.user.id).select(
            "name email role isActive pendingEmail emailChangeExpiresAt createdAt updatedAt"
          );

          return res.status(200).json({
            success: true,
            store: store ? store.toObject() : null,
            user: sanitizeUser(currentUser || user),
          });
        }
      }

      return res.status(200).json({
        success: true,
        store: store ? store.toObject() : null,
        user: sanitizeUser(user),
      });
    } catch (error) {
      console.error("Setup GET error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch setup",
      });
    }
  }

  if (req.method === "POST") {
    return handlePost(req, res);
  }

  return res.status(405).json({ message: "Method not allowed" });
}

async function handlePost(req, res) {
  const {
    storeName,
    storePhone,
    country,
    email,
    logo,
    locations = [],
    receiptSettings,
    adminName,
    adminEmail,
    adminPassword,
  } = req.body || {};

  try {
    await mongooseConnect();

    const [existingAdmin, existingStore] = await Promise.all([
      User.findOne({ role: "admin" }).select("_id name email"),
      Store.findOne({}).select("_id"),
    ]);
    const bootstrapMode = !existingAdmin || !existingStore;
    const normalizedAdminEmail = normalizeEmail(adminEmail);

    if (bootstrapMode && (!storeName || !storePhone || !country || !adminName || !adminEmail)) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: storeName, storePhone, country, adminName, adminEmail",
      });
    }

    if (bootstrapMode && !adminPassword) {
      return res.status(400).json({
        success: false,
        message: "adminPassword is required during initial setup",
      });
    }

    if (bootstrapMode && !isValidEmail(normalizedAdminEmail)) {
      return res.status(400).json({
        success: false,
        message: "A valid adminEmail is required during initial setup",
      });
    }

    // After bootstrap, only admins can mutate setup.
    if (!bootstrapMode) {
      const authError = authMiddleware(req, res);
      if (authError) return authError;
      if (!isAdmin(req)) {
        return res.status(403).json({
          success: false,
          message: "Only admin users can update setup configuration",
        });
      }
    }

    let passwordUpdate = {};
    if (adminPassword) {
      passwordUpdate.password = await bcrypt.hash(adminPassword, 10);
    }

    let adminRecord = null;
    if (bootstrapMode && existingAdmin?._id) {
      adminRecord = await User.findById(existingAdmin._id).select(
        "_id name email role isActive pendingEmail emailChangeTokenHash emailChangeExpiresAt createdAt updatedAt"
      );
    } else if (!bootstrapMode && req.user?.id) {
      adminRecord = await User.findById(req.user.id).select(
        "_id name email role isActive pendingEmail emailChangeTokenHash emailChangeExpiresAt createdAt updatedAt"
      );

      if (!adminRecord || adminRecord.role !== "admin") {
        return res.status(404).json({
          success: false,
          message: "Admin user not found",
        });
      }
    }

    if (bootstrapMode && adminRecord && normalizedAdminEmail) {
      const existingEmailOwner = await User.findOne({
        email: normalizedAdminEmail,
        _id: { $ne: adminRecord._id },
      }).select("_id");

      if (existingEmailOwner) {
        return res.status(409).json({
          success: false,
          message: "That admin email is already in use by another account",
        });
      }
    }

    let store = await Store.findOne({});
    const nextStoreName = storeName || store?.storeName;
    const nextStorePhone = storePhone || store?.storePhone;
    const nextCountry = country || store?.country;

    if (!nextStoreName || !nextStorePhone || !nextCountry) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: storeName, storePhone, country",
      });
    }

    const existingLocations = Array.isArray(store?.locations) ? store.locations : [];
    const existingLocationsById = new Map(
      existingLocations
        .filter((loc) => loc?._id)
        .map((loc) => [String(loc._id), loc])
    );
    const preparedLocations = [];

    for (const loc of Array.isArray(locations) ? locations : []) {
      const locationId = loc?._id ? String(loc._id) : "";

      if (locationId && !existingLocationsById.has(locationId)) {
        return res.status(400).json({
          success: false,
          message: `Invalid location reference: ${locationId}`,
        });
      }

      const existingLocation = locationId ? existingLocationsById.get(locationId) : null;

      preparedLocations.push({
        ...(locationId ? { _id: loc._id } : {}),
        name: loc.name || "Unnamed Location",
        address: loc.address || "",
        phone: loc.phone || "",
        email: loc.email || "",
        code: loc.code || "",
        isActive: loc.isActive !== false,
        // Per-location QR code data
        qrUrl: loc.qrUrl ?? existingLocation?.qrUrl ?? "",
        qrDataUrl: loc.qrDataUrl ?? existingLocation?.qrDataUrl ?? "",
        // Preserve location-linked references when saving company details.
        tenders: Array.isArray(loc.tenders) ? loc.tenders : existingLocation?.tenders || [],
        categories: Array.isArray(loc.categories) ? loc.categories : existingLocation?.categories || [],
      });
    }

    const normalizedReceiptSettings = receiptSettings && typeof receiptSettings === "object"
      ? {
          companyDisplayName: receiptSettings.companyDisplayName || store?.companyDisplayName || "St's Michael Hub",
          taxNumber: receiptSettings.taxNumber || "",
          website: receiptSettings.website || "",
          refundDays: Number(receiptSettings.refundDays) || 0,
          receiptMessage: receiptSettings.receiptMessage || "Thank you for shopping with us!",
          fontSize: String(receiptSettings.fontSize || store?.fontSize || "8.0"),
          fontFamily: String(receiptSettings.fontFamily || store?.fontFamily || "Arial"),
          barcodeType: receiptSettings.barcodeType || store?.barcodeType || "Default - Code 39",
          qrUrl: receiptSettings.qrUrl || "",
          qrDescription: receiptSettings.qrDescription || "",
          qrDataUrl: receiptSettings.qrDataUrl || "",
          paymentStatus: receiptSettings.paymentStatus || "paid",
          shippingBaseCost: Math.max(0, Number(receiptSettings.shippingBaseCost) || 0),
          shippingRatePerKm: Math.max(0, Number(receiptSettings.shippingRatePerKm) || 0),
          shippingFallbackCost: Math.max(
            0,
            Number(receiptSettings.shippingFallbackCost) ||
              Number(receiptSettings.shippingBaseCost) ||
              0
          ),
        }
      : null;

    if (!store) {
      store = new Store({
        storeName: nextStoreName,
        storePhone: nextStorePhone,
        country: nextCountry,
        email: email || "",
        logo: logo || "",
        locations: preparedLocations,
        devices: [],
        openingHours: [],
        tenderTypes: [],
        taxRates: [],
        pettyCashReasons: [],
        ...(normalizedReceiptSettings || {}),
      });
    } else {
      store.storeName = nextStoreName;
      store.storePhone = nextStorePhone;
      store.country = nextCountry;
      if (Array.isArray(locations) && locations.length > 0) {
        store.locations = preparedLocations;
      }
      if (typeof email === "string") store.email = email;
      if (typeof logo === "string") {
        // Delete old logo from S3 if it's being replaced
        if (store.logo && store.logo !== logo) {
          deleteS3Url(store.logo).catch((err) =>
            console.error("[Setup] S3 logo cleanup failed:", err.message)
          );
        }
        store.logo = logo;
      }
      if (normalizedReceiptSettings) {
        Object.assign(store, normalizedReceiptSettings);
      }
      // Apply per-location QR data if provided
      if (receiptSettings?.locationQrData && typeof receiptSettings.locationQrData === "object") {
        const locQrData = receiptSettings.locationQrData;
        if (Array.isArray(store.locations)) {
          store.locations.forEach((loc) => {
            const locId = String(loc._id);
            if (locQrData[locId]) {
              loc.qrUrl = locQrData[locId].qrUrl || "";
              loc.qrDataUrl = locQrData[locId].qrDataUrl || "";
            }
          });
        }
      }
      if (!store.devices) store.devices = [];
      if (!store.openingHours) store.openingHours = [];
      if (!store.tenderTypes) store.tenderTypes = [];
      if (!store.taxRates) store.taxRates = [];
      if (!store.pettyCashReasons) store.pettyCashReasons = [];
    }

    const savedStore = await store.save();

    let user = adminRecord ? sanitizeUser(adminRecord) : null;
    const messageParts = ["✅ Setup saved successfully."];

    if (bootstrapMode) {
      const nextAdminName = adminName || adminRecord?.name;

      if (nextAdminName && normalizedAdminEmail && (bootstrapMode || adminName || adminEmail || adminPassword)) {
        if (adminRecord?._id) {
          user = await User.findByIdAndUpdate(
            adminRecord._id,
            {
              $set: {
                name: nextAdminName,
                email: normalizedAdminEmail,
                role: "admin",
                ...passwordUpdate,
              },
              $unset: {
                pendingEmail: 1,
                emailChangeTokenHash: 1,
                emailChangeExpiresAt: 1,
              },
            },
            { new: true }
          ).select("name email role isActive pendingEmail emailChangeExpiresAt createdAt updatedAt");
        } else {
          user = await User.create({
            name: nextAdminName,
            email: normalizedAdminEmail,
            role: "admin",
            ...passwordUpdate,
          });
        }
      }
    } else if (adminRecord?._id) {
      const nextAdminName = adminName || adminRecord.name;
      const currentAdminEmail = normalizeEmail(adminRecord.email);
      const requestedAdminEmail = normalizedAdminEmail || currentAdminEmail;
      const now = new Date();

      const userSet = {
        role: "admin",
        name: nextAdminName,
        ...passwordUpdate,
      };

      let pendingEmailRequest = null;

      if (requestedAdminEmail && requestedAdminEmail !== currentAdminEmail) {
        if (!isValidEmail(requestedAdminEmail)) {
          messageParts.push("⚠️ Admin email was not updated because the new email address is invalid.");
        } else if (
          normalizeEmail(adminRecord.pendingEmail) === requestedAdminEmail &&
          adminRecord.emailChangeExpiresAt &&
          new Date(adminRecord.emailChangeExpiresAt) > now
        ) {
          messageParts.push(`📧 Admin email change is already pending verification for ${requestedAdminEmail}. Check ${adminRecord.email} to approve it.`);
        } else {
          const existingEmailOwner = await User.findOne({
            email: requestedAdminEmail,
            _id: { $ne: adminRecord._id },
          }).select("_id");

          if (existingEmailOwner) {
            messageParts.push("⚠️ Admin email was not updated because that email address is already in use.");
          } else {
            const rawToken = crypto.randomBytes(32).toString("hex");
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            userSet.pendingEmail = requestedAdminEmail;
            userSet.emailChangeTokenHash = hashEmailChangeToken(rawToken);
            userSet.emailChangeExpiresAt = expiresAt;
            pendingEmailRequest = {
              token: rawToken,
              currentEmail: adminRecord.email,
              currentName: nextAdminName,
              pendingEmail: requestedAdminEmail,
            };
          }
        }
      }

      user = await User.findByIdAndUpdate(
        adminRecord._id,
        { $set: userSet },
        { new: true }
      ).select("name email role isActive pendingEmail emailChangeExpiresAt createdAt updatedAt");

      if (pendingEmailRequest) {
        try {
          await sendAdminEmailChangeVerificationEmail({
            req,
            currentEmail: pendingEmailRequest.currentEmail,
            currentName: pendingEmailRequest.currentName,
            pendingEmail: pendingEmailRequest.pendingEmail,
            token: pendingEmailRequest.token,
          });

          messageParts.push(
            `📧 We sent a verification link to ${pendingEmailRequest.currentEmail}. The admin login email will switch to ${pendingEmailRequest.pendingEmail} after you approve the change from the current inbox.`
          );
        } catch (mailError) {
          console.error("Admin email change mail error:", mailError);

          await User.findByIdAndUpdate(
            adminRecord._id,
            buildPendingEmailRestoreUpdate(adminRecord)
          );

          user = await User.findById(adminRecord._id).select(
            "name email role isActive pendingEmail emailChangeExpiresAt createdAt updatedAt"
          );

          messageParts.push(
            `⚠️ Setup was saved, but the admin email verification mail could not be sent. ${mailError.message || "Please check your email configuration and try again."}`
          );
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: messageParts.join(" "),
      data: { store: savedStore, user: sanitizeUser(user) },
    });
  } catch (error) {
    console.error("Setup POST error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}
