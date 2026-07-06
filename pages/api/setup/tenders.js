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

  try {
    await connectDB();

    if (req.method === "GET") {
      // Get all tenders
      const tenders = await Tender.find().sort({ tillOrder: 1 });
      return res.status(200).json({
        success: true,
        tenders,
      });
    }

    if (req.method === "POST") {
      // Create new tender
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

      // Check if tender with same name already exists (case/space-insensitive)
      const existingTender = await Tender.findOne({
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
          message: "Tender already exists. Linked to existing tender ID.",
          tender: existingTender,
          linkedExisting: true,
        });
      }

      const newTender = await Tender.create({
        name: cleanName,
        description: description || "",
        buttonColor: buttonColor || "#FF69B4",
        tillOrder: tillOrder || 1,
        classification: classification || "Other",
      });

      return res.status(201).json({
        success: true,
        message: "Tender created successfully",
        tender: newTender,
      });
    }

    return res.status(405).json({
      success: false,
      message: "Method not allowed",
    });
  } catch (error) {
    console.error("Error in tenders API:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}

