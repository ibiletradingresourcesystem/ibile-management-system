import { mongooseConnect } from "@/lib/mongodb";
import ExpenseCategory from "@/models/ExpenseCategory";
import { expenseTreatment } from "@/lib/financial-basis";

// Buying stock is not a running cost, so that category is seeded as INVENTORY:
// the spend sits in inventory and reaches profit as cost of goods sold.
const defaultCategories = [
  { name: "Power/Utilities" },
  { name: "Logistics (Tansportation)" },
  { name: "Repairs/Maintenance" },
  { name: "Petty Cash Vendor" },
  { name: "Supplies/Stock Purchase", treatment: "INVENTORY" },
];

function normalizeTreatment(value) {
  return String(value || "").toUpperCase() === "INVENTORY" ? "INVENTORY" : "EXPENSE";
}

/**
 * What a category is actually treated as: the choice made for it, or what its
 * name says when no choice has been made.
 */
function withEffectiveTreatment(category) {
  const chosen = category.treatment === "EXPENSE" || category.treatment === "INVENTORY" ? category.treatment : null;
  return {
    ...category,
    treatment: chosen,
    effectiveTreatment: chosen || expenseTreatment({ categoryName: category.name }),
  };
}

/** Categories by name, with "Other" last, as the pages expect them. */
async function listCategories() {
  const categories = await ExpenseCategory.find().sort({ name: 1 }).lean();
  const reordered = categories.filter((category) => category.name !== "Other");
  const other = categories.find((category) => category.name === "Other");
  if (other) reordered.push(other);
  return reordered.map(withEffectiveTreatment);
}

export default async function handler(req, res) {
  await mongooseConnect();

  // 👇 Seed default categories once if collection is empty
  const count = await ExpenseCategory.countDocuments();
  if (count === 0) {
    await ExpenseCategory.insertMany(defaultCategories);
  }

  if (req.method === "GET") {
    return res.status(200).json(await listCategories());
  }

  if (req.method === "POST") {
    let { name, treatment } = req.body;

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Category name required" });
    }

    name = name.trim();
    if (!name) {
      return res.status(400).json({ error: "Category name cannot be empty" });
    }

    const exists = await ExpenseCategory.findOne({ name });
    if (!exists) {
      await ExpenseCategory.create({
        name,
        ...(treatment === undefined ? {} : { treatment: normalizeTreatment(treatment) }),
      });
    }

    return res.status(201).json(await listCategories());
  }

  return res.status(405).json({ error: "Method not allowed" });
}

