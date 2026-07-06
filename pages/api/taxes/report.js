import PDFDocument from "pdfkit";
import { mongooseConnect } from "@/lib/mongodb";
import Transaction from "@/models/Transactions";
import Expense from "@/models/Expense";
import Product from "@/models/Product";
import Store from "@/models/Store";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";
import { buildPeriodRange, computeTaxAnalysis } from "@/lib/tax-analysis";

function money(value = 0) {
  return `NGN ${Number(value || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("en-NG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function drawSignatureBlock(doc, options = {}) {
  const left = options.left || 48;
  const top = doc.y;
  const width = options.width || 240;
  const lineY = top + 28;

  doc
    .moveTo(left, lineY)
    .lineTo(left + width, lineY)
    .strokeColor("#9CA3AF")
    .stroke();

  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(options.title || "Authorized Signatory", left, lineY + 6, { width });

  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#4B5563")
    .text(options.subtitle || "", left, lineY + 20, { width });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authError = authMiddleware(req, res);
  if (authError) return authError;
  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  try {
    await mongooseConnect();

    const period = String(req.query.period || "last-month");
    const now = new Date();
    const { start, end, label } = buildPeriodRange(period, now);
    const dateFilter = { createdAt: { $gte: start, $lte: end } };

    const [transactions, expenses, store, products] = await Promise.all([
      Transaction.find({ ...dateFilter, status: "completed" }).lean().exec(),
      Expense.find(dateFilter).lean().exec(),
      Store.findOne({}).lean(),
      Product.find({}, { _id: 1, costPrice: 1, taxRate: 1 }).lean().exec(),
    ]);

    // Build product lookup map
    const productMap = {};
    for (const p of products) {
      productMap[String(p._id)] = { costPrice: p.costPrice || 0, taxRate: p.taxRate || 0 };
    }

    const tax = computeTaxAnalysis({
      transactions,
      expenses,
      productMap,
      period,
      generatedAt: now,
      periodLabel: label,
    });

    const filename = `Tax_Compliance_Report_${period}_${now.toISOString().split("T")[0]}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ margin: 48, size: "A4" });
    doc.pipe(res);

    const businessName = store?.storeName || store?.companyName || "N/A";
    const reportPeriodLabel = tax.periodLabel || label;
    const periodRange = `${formatDate(start)} to ${formatDate(end)}`;

    doc
      .rect(48, 48, 499, 90)
      .fill("#0F172A");
    doc
      .fillColor("#FFFFFF")
      .font("Helvetica-Bold")
      .fontSize(22)
      .text("TAX COVER LETTER", 48, 76, { align: "center" });
    doc
      .font("Helvetica")
      .fontSize(11)
      .text("Prepared for FIRS / relevant state internal revenue service", 48, 106, {
        align: "center",
      });

    doc.moveDown(6);
    doc.fillColor("#111827").font("Helvetica").fontSize(11);
    doc.text(`Date: ${formatDate(now)}`);
    doc.moveDown(0.8);
    doc.text("To:");
    doc.text("The Reviewing Tax Officer");
    doc.text("Federal Inland Revenue Service / Applicable State IRS");
    doc.moveDown(1);
    doc.text(`Subject: Submission of tax compliance schedule for ${businessName}`);
    doc.moveDown(1);
    doc.text(
      `Please find attached the tax computation schedule for ${businessName} covering ${reportPeriodLabel}. This package includes revenue, allowable expenses, and the resulting tax estimates generated from the business records maintained in the inventory platform.`
    );
    doc.moveDown(0.8);
    doc.text(
      "The enclosed figures should be reviewed together with supporting invoices, expense records, and any accountant adjustments required before final statutory filing."
    );
    doc.moveDown(1.4);
    doc.font("Helvetica-Bold").fontSize(12).text("Submission Snapshot");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10);
    doc.text(`Business Name: ${businessName}`);
    doc.text(`Reporting Period: ${reportPeriodLabel}`);
    doc.text(`Covered Dates: ${periodRange}`);
    doc.text(`Prepared By: ${req.user?.name || req.user?.email || "System User"}`);
    doc.text(`Total Estimated Tax Liability: ${money(tax.totalTaxLiability)}`);
    doc.moveDown(2);

    drawSignatureBlock(doc, {
      title: "Prepared By",
      subtitle: "Management / Internal Finance Representative",
      left: 48,
      width: 210,
    });
    drawSignatureBlock(doc, {
      title: "Accountant Sign-Off",
      subtitle: "Name, signature, firm stamp and date",
      left: 320,
      width: 210,
    });

    doc.moveDown(6);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#4B5563")
      .text(
        "This cover letter is generated for print and submission support. Final filing values should be confirmed by a qualified accountant before lodgement."
      );

    doc.addPage();

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#111827").text("OFFICIAL TAX COMPLIANCE REPORT", { align: "center" });
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(11).fillColor("#374151").text("Prepared for submission to tax authorities (FIRS / relevant state IRS)", { align: "center" });
    doc.moveDown(1.2);

    doc.font("Helvetica-Bold").fontSize(12).text("Business Information");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10);
    doc.text(`Business Name: ${businessName}`);
    doc.text(`Country: ${store?.country || "N/A"}`);
    doc.text(`Business Phone: ${store?.storePhone || "N/A"}`);
    doc.text(`Business Email: ${store?.email || "N/A"}`);
    doc.text(`Report Period: ${reportPeriodLabel}`);
    doc.text(`Range: ${periodRange}`);
    doc.text(`Generated On: ${now.toLocaleString("en-NG")}`);
    doc.text(`Generated By: ${req.user?.name || req.user?.email || "System User"}`);
    doc.moveDown(1);

    doc.font("Helvetica-Bold").fontSize(12).text("Tax Summary");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10);
    doc.text(`Total Revenue: ${money(tax.totalRevenue)}`);
    doc.text(`Total Allowable Expenses: ${money(tax.totalExpenses)}`);
    doc.text(`Net Profit: ${money(tax.netProfit)}`);
    doc.text(`Tax Band Classification: ${tax.band}`);
    doc.text(`Company Income Tax (CIT @ ${tax.citRate}%): ${money(tax.companyIncomeTax)}`);
    doc.text(`Value Added Tax (VAT @ ${tax.vatRate}%): ${money(tax.vatOnSales)}`);
    doc.text(`National Health Insurance Levy (NHL @ ${tax.nhlRate}%): ${money(tax.nhlAmount)}`);
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(11).text(`Total Tax Liability: ${money(tax.totalTaxLiability)}`);
    doc.moveDown(1);

    doc.font("Helvetica-Bold").fontSize(12).text("Period-by-Period Tax Breakdown");
    doc.moveDown(0.4);

    const tableLeft = 48;
    const tableTop = doc.y;
    const col = {
      period: 160,
      revenue: 95,
      expenses: 90,
      vat: 70,
      cit: 70,
      nhl: 62,
    };

    const drawHeader = () => {
      doc.rect(tableLeft, doc.y, 499, 20).fill("#1F2937");
      doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(8);
      let x = tableLeft + 6;
      doc.text("Period", x, doc.y + 6, { width: col.period });
      x += col.period;
      doc.text("Revenue", x, doc.y + 6, { width: col.revenue, align: "right" });
      x += col.revenue;
      doc.text("Expenses", x, doc.y + 6, { width: col.expenses, align: "right" });
      x += col.expenses;
      doc.text("VAT", x, doc.y + 6, { width: col.vat, align: "right" });
      x += col.vat;
      doc.text("CIT", x, doc.y + 6, { width: col.cit, align: "right" });
      x += col.cit;
      doc.text("NHL", x, doc.y + 6, { width: col.nhl, align: "right" });
      doc.fillColor("#000000");
      doc.y += 20;
    };

    drawHeader();

    const rows = tax.breakdown?.length
      ? tax.breakdown
      : [{ month: tax.periodLabel || label, income: tax.totalRevenue, expenses: tax.totalExpenses, vat: tax.vatOnSales, cit: tax.companyIncomeTax, nhl: tax.nhlAmount }];

    rows.forEach((row, idx) => {
      if (doc.y > 730) {
        doc.addPage();
        drawHeader();
      }

      doc.rect(tableLeft, doc.y, 499, 18).fill(idx % 2 ? "#F9FAFB" : "#FFFFFF");
      doc.fillColor("#111827").font("Helvetica").fontSize(8);
      let x = tableLeft + 6;
      doc.text(String(row.month || "-"), x, doc.y + 5, { width: col.period });
      x += col.period;
      doc.text(money(row.income || 0).replace("NGN ", ""), x, doc.y + 5, { width: col.revenue, align: "right" });
      x += col.revenue;
      doc.text(money(row.expenses || 0).replace("NGN ", ""), x, doc.y + 5, { width: col.expenses, align: "right" });
      x += col.expenses;
      doc.text(money(row.vat || 0).replace("NGN ", ""), x, doc.y + 5, { width: col.vat, align: "right" });
      x += col.vat;
      doc.text(money(row.cit || 0).replace("NGN ", ""), x, doc.y + 5, { width: col.cit, align: "right" });
      x += col.cit;
      doc.text(money(row.nhl || 0).replace("NGN ", ""), x, doc.y + 5, { width: col.nhl, align: "right" });
      doc.y += 18;
    });

    doc.moveDown(1.2);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text("Declaration");
    doc.font("Helvetica").fontSize(9).fillColor("#374151").text(
      "We certify that this report is generated from business transaction and expense records maintained in the inventory system and reflects the tax computations for the selected reporting period."
    );
    doc.moveDown(0.8);
    drawSignatureBlock(doc, {
      title: "Management Authorization",
      subtitle: "Name, signature and date",
      left: 48,
      width: 210,
    });
    drawSignatureBlock(doc, {
      title: "Accountant Review",
      subtitle: "Name, signature, stamp and date",
      left: 320,
      width: 210,
    });
    doc.moveDown(5.5);
    doc.fontSize(8).fillColor("#4B5563").text(
      "Reference tax basis: Nigeria Finance Act (CIT thresholds, VAT and applicable levies). This schedule is intended to support filing preparation and should be validated by your accountant before submission.",
      { align: "left" }
    );

    doc.end();
  } catch (error) {
    console.error("Tax report generation error:", error);
    return res.status(500).json({
      error: "Failed to generate tax report",
      message: error?.message || "Unknown error",
    });
  }
}
