import { mongooseConnect } from "@/lib/mongodb";
import TenderAssignment from "@/models/TenderAssignment";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

const ASSIGNMENTS_KEY = "default";

export default async function handler(req, res) {
  try {
    const authError = authMiddleware(req, res);
    if (authError) return authError;

    if (!isStaff(req)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    await mongooseConnect();

    if (req.method === "GET") {
      const doc = await TenderAssignment.findOne({ key: ASSIGNMENTS_KEY }).lean();
      return res.status(200).json({
        success: true,
        tenderAssignments: doc?.deviceTenders || {},
      });
    }

    if (req.method === "POST") {
      const { deviceTenders } = req.body;

      if (!deviceTenders) {
        return res.status(400).json({
          success: false,
          message: "Device tenders data is required",
        });
      }

      await TenderAssignment.findOneAndUpdate(
        { key: ASSIGNMENTS_KEY },
        { $set: { deviceTenders } },
        { upsert: true, new: true }
      );

      return res.status(200).json({
        success: true,
        message: "Tender assignments saved successfully",
        tenderAssignments: deviceTenders,
      });
    }

    return res.status(405).json({
      success: false,
      message: "Method not allowed",
    });
  } catch (error) {
    console.error("Error in tender assignments API:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

