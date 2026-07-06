import { mongooseConnect } from "@/lib/mongodb";
import Customer from "@/models/Customer";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  const { id } = req.query;

  if (req.method === "PUT") {
    // Update customer
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

      const creditEnabled = Boolean(isCreditCustomer || type === "CREDIT");
      const updateData = {
        name,
        email: email || undefined,
        phone,
        address: address || "",
        isCreditCustomer: creditEnabled,
        creditLimit: Number(creditLimit || 0),
        creditBalance: Number(creditBalance || 0),
        creditNotes: creditNotes || "",
      };
      if (type || creditEnabled) updateData.type = creditEnabled ? "CREDIT" : type;

      const customer = await Customer.findByIdAndUpdate(
        id,
        updateData,
        { new: true }
      );

      if (!customer) {
        return res.status(404).json({
          success: false,
          message: "Customer not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Customer updated successfully",
        customer,
      });
    } catch (error) {
      console.error("Error updating customer:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to update customer",
      });
    }
  } else if (req.method === "DELETE") {
    // Delete customer
    try {
      await mongooseConnect();

      const customer = await Customer.findByIdAndDelete(id);

      if (!customer) {
        return res.status(404).json({
          success: false,
          message: "Customer not found",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Customer deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting customer:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to delete customer",
      });
    }
  } else {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }
}
