import { mongooseConnect } from "@/lib/mongoose";
import { authMiddleware } from "@/lib/auth-middleware";
import DailyCash from "@/models/DailyCash";
import Expense from "@/models/Expense";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return;

  await mongooseConnect();

  if (req.method === "GET") {
    try {
      const { location, startDate, endDate } = req.query;
      const filter = {};

      if (location) filter.location = location;
      if (startDate || endDate) {
        filter.date = {};
        if (startDate) filter.date.$gte = new Date(startDate);
        if (endDate) filter.date.$lte = new Date(endDate);
      }

      const records = await DailyCash.find(filter).sort({ date: -1 }).limit(90);
      return res.status(200).json({ success: true, records });
    } catch (error) {
      console.error("Daily cash fetch error:", error);
      return res.status(500).json({ error: "Failed to fetch daily cash records" });
    }
  }

  if (req.method === "POST") {
    try {
      const { date, amount, location } = req.body || {};

      if (!date || amount === undefined || !location) {
        return res.status(400).json({ error: "Date, amount, and location are required." });
      }

      const parsedDate = new Date(date);
      parsedDate.setHours(0, 0, 0, 0);

      // Check for existing record on same date + location
      const existing = await DailyCash.findOne({
        location,
        date: parsedDate,
      });
      if (existing) {
        return res.status(400).json({
          error: "A daily cash record already exists for this date and location.",
        });
      }

      // Get previous day's cash at hand for this location
      const previousRecord = await DailyCash.findOne({
        location,
        date: { $lt: parsedDate },
      }).sort({ date: -1 });

      const cashBroughtForward = previousRecord?.cashAtHand || 0;

      // Get today's expenses for this location
      const dayEnd = new Date(parsedDate);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const expenses = await Expense.find({
        locationName: location,
        expenseDate: { $gte: parsedDate, $lt: dayEnd },
      }).lean();

      const totalPayments = expenses.reduce(
        (sum, e) => sum + Number(e.amount || 0),
        0
      );

      const totalCashAvailable = cashBroughtForward + Number(amount);
      const cashAtHand = totalCashAvailable - totalPayments;

      const record = await DailyCash.create({
        date: parsedDate,
        amount: Number(amount),
        cashBroughtForward,
        totalPayments,
        totalCashAvailable,
        cashAtHand,
        location,
        staff: {
          _id: req.user._id || req.user.id,
          name: req.user.name || "",
          role: req.user.role || "",
        },
      });

      return res.status(201).json({ success: true, record });
    } catch (error) {
      console.error("Daily cash create error:", error);
      return res.status(500).json({ error: "Failed to create daily cash record" });
    }
  }

  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
