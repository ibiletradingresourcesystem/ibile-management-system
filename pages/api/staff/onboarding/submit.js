import { mongooseConnect } from "@/lib/mongodb";
import Staff from "@/models/Staff";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { token, onboardingData, guarantor } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Token is required" });
  }

  await mongooseConnect();

  try {
    const staff = await Staff.findOne({ onboardingToken: token });
    if (!staff) {
      return res.status(404).json({ error: "Invalid onboarding link" });
    }

    if (staff.onboardingComplete) {
      return res.status(400).json({ error: "Onboarding already completed" });
    }

    if (onboardingData) {
      staff.onboardingData = {
        fullName: onboardingData.fullName || "",
        email: onboardingData.email || "",
        phone: onboardingData.phone || "",
        address: onboardingData.address || "",
        dateOfBirth: onboardingData.dateOfBirth || "",
        stateOfOrigin: onboardingData.stateOfOrigin || "",
        nextOfKin: onboardingData.nextOfKin || "",
        nextOfKinPhone: onboardingData.nextOfKinPhone || "",
        photo: onboardingData.photo || "",
      };
    }

    if (guarantor) {
      staff.guarantor = {
        name: guarantor.name || "",
        phone: guarantor.phone || "",
        email: guarantor.email || "",
        address: guarantor.address || "",
        relationship: guarantor.relationship || "",
        occupation: guarantor.occupation || "",
        photo: guarantor.photo || "",
      };
    }

    staff.onboardingComplete = true;
    await staff.save();

    return res.status(200).json({ message: "Onboarding completed successfully" });
  } catch (err) {
    console.error("Onboarding submit error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
