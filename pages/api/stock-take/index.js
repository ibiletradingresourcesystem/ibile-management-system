// pages/api/stock-take/index.js
import { mongooseConnect } from "@/lib/mongodb";
import StockTake from "@/models/StockTake";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

function generateRef() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ST-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${rand}`;
}

function buildStockTakeTitle(locationName) {
  const dateLabel = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return [dateLabel, locationName].filter(Boolean).join(" - ");
}

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) {
    return res.status(403).json({ success: false, message: "Insufficient permissions" });
  }

  await mongooseConnect();

  /* ========== GET — List stock takes ========== */
  if (req.method === "GET") {
    try {
      const { status, location, limit = 50, page = 1 } = req.query;
      const filter = {};
      if (status) filter.status = status;
      if (location) filter.locationName = location;

      const skip = (Number(page) - 1) * Number(limit);
      const [stockTakes, total] = await Promise.all([
        StockTake.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .select("-items")
          .lean(),
        StockTake.countDocuments(filter),
      ]);

      return res.status(200).json({ success: true, stockTakes, total });
    } catch (err) {
      console.error("Stock take GET error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  /* ========== POST — Create new stock take ========== */
  if (req.method === "POST") {
    try {
      const { locationId, locationName, createdBy } = req.body;

      if (!locationName || !createdBy) {
        return res.status(400).json({ success: false, message: "locationName and createdBy are required" });
      }

      const title = buildStockTakeTitle(locationName);

      const stockTake = await StockTake.create({
        reference: generateRef(),
        title,
        description: "",
        locationId: locationId || null,
        locationName,
        type: "full",
        category: "",
        items: [],
        totalItems: 0,
        totalSystemQty: 0,
        createdBy: createdBy || req.user?.name || "",
        status: "in-progress",
        startedAt: new Date(),
      });

      return res.status(201).json({ success: true, stockTake: { ...stockTake.toObject(), items: undefined }, id: stockTake._id });
    } catch (err) {
      console.error("Stock take POST error:", err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ message: "Method not allowed" });
}
