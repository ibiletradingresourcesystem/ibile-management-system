// pages/api/expenses/report.js
import { mongooseConnect } from "@/lib/mongodb";
import Expense from "@/models/Expense";
import PDFDocument from "pdfkit";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    const expenses = await Expense.find()
      .sort({ createdAt: -1 })
      .lean();

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="ExpenseReport.pdf"'
    );

    doc.pipe(res);

    doc.fontSize(20).text("Expense Report", { align: "center" });
    doc.moveDown();

    let total = 0;

    expenses.forEach((exp, i) => {
      doc
        .fontSize(12)
        .fillColor("black")
        .text(`${i + 1}. ${exp.title}`, { continued: true })
        .fillColor("blue")
        .text(` ₦${Number(exp.amount).toLocaleString()}`, {
          align: "right",
        });

      doc
        .fontSize(10)
        .fillColor("gray")
        .text(
          `Category: ${exp.categoryName || "Uncategorized"} | ${new Date(
            exp.createdAt
          ).toLocaleDateString()}`
        );

      if (exp.description) {
        doc.text(`Note: ${exp.description}`);
      }

      doc.moveDown();
      total += Number(exp.amount);
    });

    doc.moveDown(1);
    doc
      .fontSize(14)
      .fillColor("black")
      .text(`Total Expenses: ₦${total.toLocaleString()}`, {
        align: "right",
      });

    doc.end();
  } catch (error) {
    console.error("Expense report error:", error);
    res.status(500).json({ message: "Failed to generate report" });
  }
}

