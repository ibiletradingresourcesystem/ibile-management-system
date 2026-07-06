import { mongooseConnect } from "@/lib/mongodb";
import Order from "@/models/Order";
import mongoose from "mongoose";
import Customer from "@/models/Customer";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  await mongooseConnect();

  if (req.method === "GET") {
    const {
      page = 1,
      limit = 10,
      search = "",
      locationId = "",
      locationName = "",
    } = req.query;

    try {
      let query = {};
      const numericLimit = Math.max(1, Number(limit) || 10);
      const numericPage = Math.max(1, Number(page) || 1);

      if (locationId && mongoose.Types.ObjectId.isValid(locationId)) {
        query.locationId = locationId;
      } else if (locationName) {
        query.locationName = locationName;
      }

      // 🔍 Search logic (by ID or customer fields)
      if (search) {
        if (mongoose.Types.ObjectId.isValid(search)) {
          query = { ...query, _id: search };
        } else {
          query = {
            ...query,
            $or: [
              { "shippingDetails.name": { $regex: search, $options: "i" } },
              { "shippingDetails.email": { $regex: search, $options: "i" } },
              { "shippingDetails.phone": { $regex: search, $options: "i" } },
              { locationName: { $regex: search, $options: "i" } },
            ],
          };
        }
      }

      // 🔹 Count and paginate
      const total = await Order.countDocuments(query);
      const totalPages = Math.ceil(total / numericLimit);

      // 🔹 Fetch orders and populate customer reference
      const orders = await Order.find(query)
        .populate("customer") // ✅ This is the key change
        .sort({ createdAt: -1 })
        .skip((numericPage - 1) * numericLimit)
        .limit(numericLimit)
        .lean(); // Converts to plain objects for better performance

      return res.status(200).json({
        orders,
        totalPages,
        total,
      });
    } catch (error) {
      console.error("❌ Failed to fetch orders:", error);
      return res.status(500).json({ 
        error: "Internal Server Error",
        message: process.env.NODE_ENV === 'development' ? error.message : undefined 
      });
    }
  }

  // 🔹 Update order status
  else if (req.method === "PUT") {
    try {
      const { id } = req.query;
      const { status } = req.body;

      const order = await Order.findById(id);
      if (!order) return res.status(404).json({ error: "Order not found" });

      order.status = status;
      await order.save();

      return res.status(200).json(order.toObject());
    } catch (error) {
      console.error("❌ Failed to update order:", error);
      return res.status(500).json({ 
        error: "Internal Server Error",
        message: process.env.NODE_ENV === 'development' ? error.message : undefined 
      });
    }
  }

  // 🔹 Invalid method
  else {
    return res.status(405).json({ error: "Method Not Allowed" });
  }
}

