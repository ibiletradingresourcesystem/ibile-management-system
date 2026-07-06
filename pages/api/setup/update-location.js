import { connectToDatabase } from "../../../lib/mongodb";
import Store from "../../../models/Store";
import { ObjectId } from "mongodb";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  }

  if (req.method !== "PUT") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await connectToDatabase();

    const { locationId } = req.query;
    const { name, address, phone, email, code, qrUrl, qrDescription, qrDataUrl } = req.body;

    // Validate locationId format
    if (!locationId || !ObjectId.isValid(locationId)) {
      return res.status(400).json({ message: "Invalid location ID" });
    }

    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Location name is required" });
    }

    // Find the store with this location
    const store = await Store.findOne({
      "locations._id": new ObjectId(locationId),
    });

    if (!store) {
      return res.status(404).json({ message: "Location not found" });
    }

    // Update the location details
    const result = await Store.findOneAndUpdate(
      { "locations._id": new ObjectId(locationId) },
      {
        $set: {
          "locations.$.name": name.trim(),
          "locations.$.address": address || "",
          "locations.$.phone": phone || "",
          "locations.$.email": email || "",
          "locations.$.code": code || "",
          "locations.$.qrUrl": qrUrl !== undefined ? qrUrl : "",
          "locations.$.qrDescription": qrDescription !== undefined ? qrDescription : "",
          "locations.$.qrDataUrl": qrDataUrl !== undefined ? qrDataUrl : "",
        },
      },
      { new: true }
    ).populate("locations.tenders locations.categories");

    if (!result) {
      return res.status(500).json({ message: "Failed to update location" });
    }

    // Find the updated location in the result
    const updatedLocation = result.locations.find(
      (loc) => loc._id.toString() === locationId
    );

    res.status(200).json({
      message: "Location updated successfully",
      location: updatedLocation,
    });
  } catch (error) {
    console.error("Error updating location:", error);
    res.status(500).json({
      message: "Failed to update location",
      error: error.message,
    });
  }
}
