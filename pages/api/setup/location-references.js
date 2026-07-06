import mongoose from "mongoose";
import { mongooseConnect } from "@/lib/mongodb";
import Store from "@/models/Store";
import Staff from "@/models/Staff";
import Expense from "@/models/Expense";
import PurchaseOrder from "@/models/PurchaseOrder";
import StockTake from "@/models/StockTake";
import Till from "@/models/Till";
import EndOfDayReport from "@/models/EndOfDayReport";
import StockMovement from "@/models/StockMovement";
import { authMiddleware, isAdmin } from "@/lib/auth-middleware";

function buildIdOrNameFilter(id, names = [], idFields = [], nameFields = []) {
  const orConditions = [];

  if (id) {
    for (const field of idFields) {
      orConditions.push({ [field]: id });
    }
  }

  const validNames = names.filter(Boolean);
  if (validNames.length > 0) {
    for (const field of nameFields) {
      orConditions.push({ [field]: { $in: validNames } });
    }
  }

  if (orConditions.length === 0) return null;
  if (orConditions.length === 1) return orConditions[0];
  return { $or: orConditions };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isAdmin(req)) {
    return res.status(403).json({ success: false, message: "Only admin users can check location references" });
  }

  const { locationId } = req.query;

  if (!locationId || !mongoose.Types.ObjectId.isValid(locationId)) {
    return res.status(400).json({ success: false, message: "Valid locationId is required" });
  }

  await mongooseConnect();

  const objectId = new mongoose.Types.ObjectId(locationId);
  const store = await Store.findOne({ "locations._id": objectId }, { "locations.$": 1 }).lean();
  const location = store?.locations?.[0];

  if (!location) {
    return res.status(404).json({ success: false, message: "Location not found" });
  }

  const locationNames = [location.name, location.locationName].filter(Boolean);

  const [staffCount, expenseCount, purchaseOrderCount, stockTakeCount, tillCount, eodCount, stockMovementCount] = await Promise.all([
    Staff.countDocuments(buildIdOrNameFilter(objectId, locationNames, ["locationId"], ["location", "locationName"])),
    Expense.countDocuments(buildIdOrNameFilter(objectId, locationNames, ["locationId"], ["locationName"])),
    PurchaseOrder.countDocuments(buildIdOrNameFilter(objectId, locationNames, ["locationId"], ["location"])),
    StockTake.countDocuments(buildIdOrNameFilter(objectId, locationNames, ["locationId"], ["locationName"])),
    Till.countDocuments(buildIdOrNameFilter(objectId, [], ["locationId"], [])),
    EndOfDayReport.countDocuments(buildIdOrNameFilter(objectId, [], ["locationId"], [])),
    StockMovement.countDocuments(buildIdOrNameFilter(objectId, [], ["fromLocationId", "toLocationId"], [])),
  ]);

  const references = {
    staff: staffCount,
    expenses: expenseCount,
    purchaseOrders: purchaseOrderCount,
    stockTakes: stockTakeCount,
    tills: tillCount,
    endOfDayReports: eodCount,
    stockMovements: stockMovementCount,
    tenders: Array.isArray(location.tenders) ? location.tenders.length : 0,
    categories: Array.isArray(location.categories) ? location.categories.length : 0,
  };

  const totalReferences = Object.values(references).reduce((sum, count) => sum + count, 0);

  return res.status(200).json({
    success: true,
    location: {
      _id: String(location._id),
      name: location.name,
    },
    references,
    totalReferences,
  });
}