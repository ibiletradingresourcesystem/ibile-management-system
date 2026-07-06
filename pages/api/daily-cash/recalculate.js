import { mongooseConnect } from "@/lib/mongoose";
import { authMiddleware } from "@/lib/auth-middleware";
import { recalculateDailyCashForLocation } from "@/lib/petty-cash-transactions";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  await mongooseConnect();

  try {
    const { location } = req.body || {};
    if (!location) {
      return res.status(400).json({ error: "Location is required." });
    }

    await recalculateDailyCashForLocation(location);
    return res.status(200).json({ success: true, message: "Recalculation complete." });
  } catch (error) {
    console.error("Daily cash recalculate error:", error);
    return res.status(500).json({ error: "Failed to recalculate daily cash." });
  }
}
