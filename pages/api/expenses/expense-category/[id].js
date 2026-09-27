import { mongooseConnect } from "@/lib/mongodb";
import ExpenseCategory from "@/models/ExpenseCategory";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) return res.status(403).json({ error: "Insufficient permissions" });

  await mongooseConnect();
  const { id } = req.query;

  if (req.method === "PUT") {
    const { name, treatment } = req.body;
    const update = {};

    if (name !== undefined) {
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Category name is required" });
      }
      update.name = name.trim();
    }

    // How the spending is treated: a running cost, or stock that sits in
    // inventory until it sells.
    if (treatment !== undefined) {
      update.treatment = String(treatment).toUpperCase() === "INVENTORY" ? "INVENTORY" : "EXPENSE";
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const category = await ExpenseCategory.findByIdAndUpdate(id, update, { new: true });
    if (!category) return res.status(404).json({ error: "Category not found" });
    return res.status(200).json(category);
  }

  if (req.method === "DELETE") {
    await ExpenseCategory.findByIdAndDelete(id);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
