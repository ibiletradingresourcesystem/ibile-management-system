import { mongooseConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    // Check if store exists
    let store = await Store.findOne({});

    if (store) {
      const authError = authMiddleware(req, res);
      if (authError) return authError;
      if (!isStaff(req)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
    }

    if (!store) {
      // Create default store with a default location
      store = await Store.create({
        storeName: "Default Store",
        storePhone: "+234 0000000000",
        country: "Nigeria",
        locations: [
          {
            name: "Main Store",
            address: "Default Address",
            phone: "+234 0000000000",
            email: "store@example.com",
            code: "MAIN",
            isActive: true,
          },
        ],
      });
      console.log("Store initialized with default location");
    } else if (!store.locations || store.locations.length === 0) {
      // If store exists but has no locations, add a default one
      store.locations = [
        {
          name: "Main Store",
          address: "Default Address",
          phone: "+234 0000000000",
          email: "store@example.com",
          code: "MAIN",
          isActive: true,
        },
      ];
      await store.save();
      console.log("Added default location to existing store");
    }

    return res.status(200).json({
      success: true,
      message: "Store initialized successfully",
      store,
    });
  } catch (err) {
    console.error("Store initialization error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to initialize store",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}
