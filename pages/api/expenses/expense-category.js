import { mongooseConnect } from "@/lib/mongodb";
import ExpenseCategory from "@/models/ExpenseCategory";

const defaultCategories = [
  "Power/Utilities",
    "Logistics (Tansportation)",
    "Repairs/Maintenance",
    "Petty Cash",
    "Supplies/Stock Purchase",
];

export default async function handler(req, res) {
  await mongooseConnect();

  // 👇 Seed default categories once if collection is empty
  const count = await ExpenseCategory.countDocuments();
  if (count === 0) {
    await ExpenseCategory.insertMany(
      defaultCategories.map(name => ({ name }))
    );
  }

  if (req.method === "GET") {
    const categories = await ExpenseCategory.find().sort({ name: 1 });

    const reordered = categories.filter(c => c.name !== "Other");
    const other = categories.find(c => c.name === "Other");
    if (other) reordered.push(other);

    return res.status(200).json(reordered);
  }

  if (req.method === "POST") {
    let { name } = req.body;

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Category name required" });
    }

    name = name.trim();
    if (!name) {
      return res.status(400).json({ error: "Category name cannot be empty" });
    }

    const exists = await ExpenseCategory.findOne({ name });
    if (!exists) {
      await ExpenseCategory.create({ name });
    }

    const categories = await ExpenseCategory.find().sort({ name: 1 });
    const reordered = categories.filter(c => c.name !== "Other");
    const other = categories.find(c => c.name === "Other");
    if (other) reordered.push(other);

    return res.status(201).json(reordered);
  }

  return res.status(405).json({ error: "Method not allowed" });
}

