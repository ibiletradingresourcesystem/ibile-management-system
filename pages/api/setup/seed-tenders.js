import mongoose from "mongoose";
import Tender from "@/models/Tender";
import { mongooseConnect } from "@/lib/mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

async function connectDB() {
  await mongooseConnect();
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await connectDB();

    // Default tenders to seed
    const defaultTenders = [
      {
        name: "ACCESS ONLINE TRANSFER",
        description: "Online bank transfer via ACCESS Bank",
        buttonColor: "#FF69B4",
        tillOrder: 1,
        classification: "Other",
      },
      {
        name: "ACCESS POS",
        description: "Debit, Credit, and POS cards",
        buttonColor: "#22C55E",
        tillOrder: 2,
        classification: "Card",
      },
      {
        name: "CASH",
        description: "Cash payment",
        buttonColor: "#E5E7EB",
        tillOrder: 3,
        classification: "Cash",
      },
      {
        name: "HYDROGEN POS",
        description: "Hydrogen POS payment",
        buttonColor: "#A3E635",
        tillOrder: 4,
        classification: "Other",
      },
      {
        name: "ZENITH POS",
        description: "Zenith Bank POS and cards",
        buttonColor: "#EF4444",
        tillOrder: 5,
        classification: "Card",
      },
    ];

    // Check if tenders already exist
    const existingCount = await Tender.countDocuments();

    if (existingCount === 0) {
      // Create all default tenders
      const createdTenders = await Tender.insertMany(defaultTenders);
      console.log(`✅ Seeded ${createdTenders.length} default tenders`);

      return res.status(201).json({
        success: true,
        message: `Successfully created ${createdTenders.length} tenders`,
        tenders: createdTenders,
      });
    } else {
      // Tenders already exist
      const allTenders = await Tender.find().sort({ tillOrder: 1 });
      return res.status(200).json({
        success: true,
        message: "Tenders already exist in the database",
        count: existingCount,
        tenders: allTenders,
      });
    }
  } catch (error) {
    console.error("Error seeding tenders:", error);

    // If it's a duplicate key error, return existing tenders
    if (error.code === 11000) {
      try {
        const existingTenders = await Tender.find().sort({ tillOrder: 1 });
        return res.status(200).json({
          success: true,
          message: "Tenders already exist",
          tenders: existingTenders,
        });
      } catch (err) {
        return res.status(500).json({
          success: false,
          message: "Error retrieving tenders",
          error: process.env.NODE_ENV === "development" ? err.message : undefined,
        });
      }
    }

    return res.status(500).json({
      success: false,
      message: "Failed to seed tenders",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}
