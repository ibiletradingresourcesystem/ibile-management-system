import mongoose from "mongoose";
import Tender from "@/models/Tender";
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

function normalizeTenderName(name) {
  return String(name || "").trim().toLowerCase();
}

async function connectDB() {
  await mongooseConnect();
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  }

  const { id } = req.query;

  // Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid tender ID",
    });
  }

  try {
    await connectDB();

    if (req.method === "GET") {
      // Get single tender
      const tender = await Tender.findById(id);

      if (!tender) {
        return res.status(404).json({
          success: false,
          message: "Tender not found",
        });
      }

      return res.status(200).json({
        success: true,
        tender,
      });
    }

    if (req.method === "PUT") {
      // Update tender
      const { name, description, buttonColor, tillOrder, classification } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: "Tender name is required",
        });
      }

      const cleanName = String(name).trim();
      const normalizedName = normalizeTenderName(cleanName);
      if (!normalizedName) {
        return res.status(400).json({
          success: false,
          message: "Tender name is required",
        });
      }

      // Check if another tender has this name (case/space-insensitive)
      const existingTender = await Tender.findOne({
        _id: { $ne: id },
        $expr: {
          $eq: [
            { $toLower: { $trim: { input: "$name" } } },
            normalizedName,
          ],
        },
      });

      if (existingTender) {
        return res.status(200).json({
          success: true,
          message: "Existing tender with same name found. Using existing tender ID.",
          tender: existingTender,
          linkedExisting: true,
        });
      }

      const tender = await Tender.findByIdAndUpdate(
        id,
        {
          name: cleanName,
          description: description || "",
          buttonColor: buttonColor || "#FF69B4",
          tillOrder: tillOrder || 1,
          classification: classification || "Other",
          updatedAt: new Date(),
        },
        { new: true }
      );

      if (!tender) {
        return res.status(404).json({
          success: false,
          message: "Tender not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Tender updated successfully",
        tender,
      });
    }

    if (req.method === "DELETE") {
      // Delete tender
      const tender = await Tender.findByIdAndDelete(id);

      if (!tender) {
        return res.status(404).json({
          success: false,
          message: "Tender not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Tender deleted successfully",
        tender,
      });
    }

    return res.status(405).json({
      success: false,
      message: "Method not allowed",
    });
  } catch (error) {
    console.error("Error in tender API:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}
