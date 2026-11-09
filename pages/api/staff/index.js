import { mongooseConnect } from "@/lib/mongodb";
import Staff from "@/models/Staff";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { authMiddleware, isAdmin, isStaff } from "@/lib/auth-middleware";
import { userCan } from "@/lib/permission-utils";
import {
  normalizePosPermissions,
  normalizeStaffRole,
} from "@/lib/pos-permissions";
import { staffLocationFields } from "@/lib/staffLocation";

// Pages that only pick a staff member get names and locations; pay, bank details and onboarding
// papers are for those who manage staff
const PRIVATE_FIELDS = "-accountName -accountNumber -bankName -salary -penalty -onboardingToken -onboardingData -guarantor";

let staffIndexesSynced = false;

async function ensureStaffIndexes() {
  if (staffIndexesSynced) return;
  // Only sync if not already done - fire and forget to not block the request
  staffIndexesSynced = true;
  Staff.syncIndexes().catch((err) => {
    console.error("Staff index sync error (background):", err);
    staffIndexesSynced = false; // retry next time
  });
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  try {
    await mongooseConnect();
  } catch (err) {
    console.error("MongoDB connection error:", err);
    return res.status(500).json({ error: "Failed to connect to DB", details: err.message });
  }

  // Fire and forget - don't block the request
  ensureStaffIndexes();

  const managesStaff = userCan(req.user, "manage.staff");

  if (req.method === "GET") {
    try {
      if (!managesStaff) {
        return res.status(200).json(await Staff.find().select(`-password ${PRIVATE_FIELDS}`).lean());
      }

      const staff = await Staff.find().select("-password").lean();

      // Auto-generate onboardingToken for any staff missing it
      const needTokens = staff.filter((s) => !s.onboardingToken);
      if (needTokens.length > 0) {
        const bulkOps = needTokens.map((s) => ({
          updateOne: {
            filter: { _id: s._id, onboardingToken: { $exists: false } },
            update: { $set: { onboardingToken: crypto.randomBytes(24).toString("hex") } },
          },
        }));
        await Staff.bulkWrite(bulkOps).catch(() => {});
        // Re-fetch to include newly generated tokens
        const refreshed = await Staff.find().select("-password").lean();
        return res.status(200).json(refreshed);
      }

      return res.status(200).json(staff);
    } catch (error) {
      console.error("Error fetching staff:", error);
      return res.status(500).json({ error: "Failed to fetch staff", details: error.message });
    }
  }

  if (req.method === "POST") {
    if (!managesStaff) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const {
      name,
      password,
      location,
      role,
      posPermissions,
      accountName,
      accountNumber,
      bankName,
      salary,
    } = req.body;

    if (!name || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const normalizedRole = normalizeStaffRole(role);
      if (normalizedRole === "admin" && !isAdmin(req)) {
        return res.status(403).json({ error: "Only an admin can give someone the admin role" });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const onboardingToken = crypto.randomBytes(24).toString("hex");
      const staff = await Staff.create({
        name,
        password: hashedPassword,
        // location, and the locationName and locationId the till reads
        ...(await staffLocationFields(location)),
        role: normalizedRole,
        posPermissions: normalizePosPermissions(normalizedRole, posPermissions),
        accountName: accountName || "",
        accountNumber: accountNumber || "",
        bankName: bankName || "",
        salary: salary ? parseInt(salary) : 0,
        photo: req.body.photo || "",
        onboardingToken,
      });
      const { password: _passwordHash, ...created } = staff.toObject();
      return res.status(201).json(created);
    } catch (error) {
      console.error("Error creating staff:", error);
      return res.status(500).json({ error: "Error creating staff", details: error.message });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}

