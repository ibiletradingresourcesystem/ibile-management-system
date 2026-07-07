import { mongooseConnect } from "@/lib/mongodb";
import DailyCash from "@/models/DailyCash";
import Expense from "@/models/Expense";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();

  const { location, date } = req.query;
  if (!location) return res.status(400).json({ error: "Location is required" });

  const targetDate = date ? new Date(date) : new Date();
  targetDate.setHours(0, 0, 0, 0);
  const nextDay = new Date(targetDate);
  nextDay.setDate(nextDay.getDate() + 1);

  // Get cash entry for the day
  const cashEntry = await DailyCash.findOne({
    location,
    date: { $gte: targetDate, $lt: nextDay },
  }).lean();

  // Get previous day's cash at hand
  const prevCash = await DailyCash.findOne({
    location,
    date: { $lt: targetDate },
  }).sort({ date: -1 }).lean();

  const cashBroughtForward = prevCash?.cashAtHand || 0;
  const cashReceived = cashEntry?.amount || 0;
  const totalCashAvailable = cashBroughtForward + cashReceived;

  // Get expenses for the day
  const expenses = await Expense.find({
    locationName: location,
    createdAt: { $gte: targetDate, $lt: nextDay },
  }).lean();

  const totalPayments = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const cashAtHand = totalCashAvailable - totalPayments;

  // Update the cash entry record if it exists
  if (cashEntry) {
    await DailyCash.findByIdAndUpdate(cashEntry._id, {
      cashBroughtForward,
      totalPayments,
      totalCashAvailable,
      cashAtHand,
    });
  }

  return res.status(200).json({
    date: targetDate,
    location,
    cashBroughtForward,
    cashReceived,
    totalCashAvailable,
    totalPayments,
    cashAtHand,
    expenses,
  });
}
