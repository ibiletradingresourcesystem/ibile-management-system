// pages/api/expenses/analysis.js
import PDFDocument from "pdfkit";
import { mongooseConnect } from "@/lib/mongodb";
import Expense from "@/models/Expense";
import path from "path";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    const expenses = await Expense.find()
      .sort({ createdAt: -1 })
      .lean();

    const totalSpent = expenses.reduce(
      (sum, exp) => sum + Number(exp.amount),
      0
    );

    // Group by category
    const categoryTotals = {};
    expenses.forEach((exp) => {
      const category = exp.categoryName || "Uncategorized";
      categoryTotals[category] =
        (categoryTotals[category] || 0) + Number(exp.amount);
    });

    // Group by location
    const locationTotals = {};
    expenses.forEach((exp) => {
      const location = exp.locationName || "Unassigned";
      locationTotals[location] =
        (locationTotals[location] || 0) + Number(exp.amount);
    });

    // Group by staff
    const staffTotals = {};
    expenses.forEach((exp) => {
      const staff = exp.staffName || "Unknown";
      staffTotals[staff] = (staffTotals[staff] || 0) + Number(exp.amount);
    });

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ExpenseReport_${new Date().toISOString().split('T')[0]}.pdf"`
    );
    res.setHeader("Content-Type", "application/pdf");

    doc.pipe(res);

    // Logo (safe path)
    const logoPath = path.join(
      process.cwd(),
      "public/images/logo.png"
    );

    try {
      doc.image(logoPath, 50, 40, { width: 60 });
    } catch (_) {}

    // Title
    doc
      .font("Helvetica-Bold")
      .fontSize(24)
      .fillColor("#0284C7")
      .text("Expense Report", 120, 50)
      .moveDown(0.3);

    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#666")
      .text(`Generated: ${new Date().toLocaleString()}`, 120, 75);

    doc.moveDown(3);

    // Summary Box
    doc
      .rect(50, 120, 495, 80)
      .fill("#f0f9ff")
      .stroke();

    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#0284C7")
      .text("SUMMARY", 70, 135);

    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor("#059669")
      .text(`₦${totalSpent.toLocaleString()}`, 70, 155);

    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#666")
      .text("Total Expenses", 70, 180);

    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor("#0284C7")
      .text(`${expenses.length}`, 250, 155);

    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#666")
      .text("Transactions", 250, 180);

    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor("#f59e0b")
      .text(`${Object.keys(categoryTotals).length}`, 400, 155);

    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#666")
      .text("Categories", 400, 180);

    doc.moveDown(4);

    // Category Breakdown Section
    let yPos = 220;
    
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor("#0284C7")
      .text("Category Breakdown", 50, yPos);

    yPos += 25;

    // Table header
    doc
      .rect(50, yPos, 495, 25)
      .fill("#0284C7");

    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#fff")
      .text("Category", 60, yPos + 8)
      .text("Amount", 400, yPos + 8);

    yPos += 25;

    // Table rows
    Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, amount], index) => {
        const bgColor = index % 2 === 0 ? "#f9fafb" : "#fff";
        doc.rect(50, yPos, 495, 22).fill(bgColor);

        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor("#374151")
          .text(name, 60, yPos + 6)
          .text(`₦${amount.toLocaleString()}`, 400, yPos + 6);

        yPos += 22;
      });

    yPos += 20;

    // Location Breakdown Section (if we have space)
    if (yPos < 500 && Object.keys(locationTotals).length > 1) {
      doc
        .font("Helvetica-Bold")
        .fontSize(14)
        .fillColor("#0284C7")
        .text("Location Breakdown", 50, yPos);

      yPos += 25;

      doc
        .rect(50, yPos, 495, 25)
        .fill("#059669");

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor("#fff")
        .text("Location", 60, yPos + 8)
        .text("Amount", 400, yPos + 8);

      yPos += 25;

      Object.entries(locationTotals)
        .sort((a, b) => b[1] - a[1])
        .forEach(([name, amount], index) => {
          const bgColor = index % 2 === 0 ? "#f9fafb" : "#fff";
          doc.rect(50, yPos, 495, 22).fill(bgColor);

          doc
            .font("Helvetica")
            .fontSize(10)
            .fillColor("#374151")
            .text(name, 60, yPos + 6)
            .text(`₦${amount.toLocaleString()}`, 400, yPos + 6);

          yPos += 22;
        });

      yPos += 20;
    }

    // Add new page for expense details
    doc.addPage();

    // Expense Details
    doc
      .font("Helvetica-Bold")
      .fontSize(14)
      .fillColor("#0284C7")
      .text("Expense Details", 50, 50);

    yPos = 80;

    // Table header
    doc
      .rect(50, yPos, 495, 25)
      .fill("#374151");

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#fff")
      .text("Title", 60, yPos + 8)
      .text("Category", 180, yPos + 8)
      .text("Location", 280, yPos + 8)
      .text("Amount", 370, yPos + 8)
      .text("Date", 450, yPos + 8);

    yPos += 25;

    expenses.slice(0, 25).forEach((exp, index) => {
      if (yPos > 750) {
        doc.addPage();
        yPos = 50;
      }

      const bgColor = index % 2 === 0 ? "#f9fafb" : "#fff";
      doc.rect(50, yPos, 495, 22).fill(bgColor);

      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#374151")
        .text(exp.title?.substring(0, 20) || "N/A", 60, yPos + 7)
        .text(exp.categoryName?.substring(0, 15) || "Uncategorized", 180, yPos + 7)
        .text(exp.locationName?.substring(0, 12) || "N/A", 280, yPos + 7)
        .text(`₦${Number(exp.amount).toLocaleString()}`, 370, yPos + 7)
        .text(new Date(exp.createdAt).toLocaleDateString(), 450, yPos + 7);

      yPos += 22;
    });

    if (expenses.length > 25) {
      doc
        .font("Helvetica-Oblique")
        .fontSize(9)
        .fillColor("#666")
        .text(`... and ${expenses.length - 25} more expenses`, 50, yPos + 10);
    }

    // Footer
    doc
      .fontSize(9)
      .fillColor("#9CA3AF")
      .text(
        `St. Micheals Inventory System - Expense Report`,
        50,
        doc.page.height - 50,
        { align: "center", width: 500 }
      );

    doc.end();
  } catch (error) {
    console.error("Expense analysis PDF error:", error);
    res.status(500).json({
      message: "Failed to generate expense report",
    });
  }
}

