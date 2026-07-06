import { mongooseConnect } from "@/lib/mongodb";
import Staff from "@/models/Staff";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ error: "Token is required" });
  }

  await mongooseConnect();

  try {
    const staff = await Staff.findOne({ onboardingToken: token })
      .select("name location onboardingComplete onboardingData guarantor photo")
      .lean();

    if (!staff) {
      return res.status(404).json({ error: "Invalid onboarding link" });
    }

    if (staff.onboardingComplete) {
      return res.status(200).json({ staff, alreadyComplete: true });
    }

    return res.status(200).json({ staff, alreadyComplete: false });
  } catch (err) {
    console.error("Onboarding GET error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
