import { mongooseConnect } from "@/lib/mongodb";
import Customer from "@/models/Customer";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method === "GET") {
    // Get all customers
    try {
      await mongooseConnect();
      const customers = await Customer.find({}).lean();
      return res.status(200).json({ success: true, customers });
    } catch (error) {
      console.error("Error fetching customers:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch customers" });
    }
  } else if (req.method === "POST") {
    // Create new customer
    try {
      await mongooseConnect();

      const {
        name,
        email,
        phone,
        address,
        type,
        isCreditCustomer,
        creditLimit,
        creditBalance,
        creditNotes,
      } = req.body;

      if (!name || !phone) {
        return res.status(400).json({
          success: false,
          message: "Name and phone are required",
        });
      }

      // Check if customer with this email already exists
      if (email) {
        const existing = await Customer.findOne({ email });
        if (existing) {
          return res.status(409).json({
            success: false,
            message: "Customer with this email already exists",
          });
        }
      }

      const creditEnabled = Boolean(isCreditCustomer || type === "CREDIT");

      const customer = await Customer.create({
        name,
        email: email || undefined,
        phone,
        address: address || "",
        type: creditEnabled ? "CREDIT" : (type || "REGULAR"),
        isCreditCustomer: creditEnabled,
        creditLimit: Number(creditLimit || 0),
        creditBalance: Number(creditBalance || 0),
        creditNotes: creditNotes || "",
      });

      return res.status(201).json({
        success: true,
        message: "Customer created successfully",
        customer,
      });
    } catch (error) {
      console.error("Error creating customer:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to create customer",
      });
    }
  } else {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }
}
