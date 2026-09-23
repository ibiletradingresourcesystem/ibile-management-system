import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { useRef, forwardRef, useImperativeHandle } from "react";
import { toWords } from "number-to-words";
import { payrollTotal } from "@/lib/payroll";

/**
 * The payroll transfer instruction: one bank letter listing the staff to be paid.
 *
 * Same letterhead, watermarks and footer as the vendor payment memo, so every memo
 * the business sends out looks like it came from the same place.
 */
const SalaryMemo = forwardRef(
  ({ rows = [], selectedAccount, selectedDirector, part = 1, partCount = 1, onDownloading }, ref) => {
    const memoRef = useRef();
    const today = new Date().toISOString().split("T")[0];
    const activeDirector = selectedDirector || "Director";
    const total = payrollTotal(rows);

    useImperativeHandle(ref, () => ({
      generatePDF: async () => {
        if (!memoRef.current) return;
        onDownloading?.(true);
        try {
          const canvas = await html2canvas(memoRef.current, {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
          });
          const imgData = canvas.toDataURL("image/jpeg", 0.75);
          const pdf = new jsPDF("p", "mm", "a4");
          const imgProps = pdf.getImageProperties(imgData);
          const pdfWidth = pdf.internal.pageSize.getWidth();
          const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
          pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
          pdf.save(`Ibile Payroll ${today}${partCount > 1 ? ` Part ${part}` : ""}.pdf`);
        } finally {
          onDownloading?.(false);
        }
      },
    }));

    const amountInWords = total
      ? `${toWords(Math.round(total)).replace(/\b\w/g, (c) => c.toUpperCase())} Naira Only`
      : "";

    const cell = { border: "1px solid #999", padding: "5px 7px", fontSize: "12px" };
    const headCell = { ...cell, fontWeight: "bold", backgroundColor: "#eef6f8", textAlign: "left" };

    return (
      <div>
        <div
          ref={memoRef}
          style={{
            fontFamily: `"Segoe UI", "Helvetica Neue", Arial, sans-serif`,
            backgroundColor: "#ffffff",
            color: "#000000",
            width: "21cm",
            minHeight: "29.7cm",
            margin: "2rem auto",
            position: "relative",
            overflow: "hidden",
            paddingLeft: "2cm",
            paddingRight: "1.5cm",
          }}
        >
          {/* Sidebar Strip */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: "1.5cm",
              backgroundColor: "#D5F3F6",
              zIndex: 0,
            }}
          />

          <div style={{ position: "relative", zIndex: 10 }}>
            {/* Logo Header */}
            <div style={{ position: "absolute", top: "1rem", right: "-2rem" }}>
              <img src="/images/logoName.png" alt="Ibile Mart Logo" style={{ height: "9em", width: "auto" }} />
            </div>

            <div style={{ paddingTop: "5.5rem" }}>
              <p style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>
                {new Date(today).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}.
              </p>
              <p>The Branch Manager</p>
              <p>Access Bank Plc Oba</p>
              <p style={{ marginBottom: "1.5rem" }}>
                Oniru Road Victoria Island
                <br />
                Lagos
              </p>

              <p style={{ fontWeight: "600", marginBottom: "1rem", marginTop: "1.5rem" }}>Dear Sir,</p>

              <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
                <p style={{ textDecoration: "underline", fontWeight: "bold" }}>
                  SALARY PAYMENT{" "}
                  {new Date(today).toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase()}
                </p>
                <p style={{ fontWeight: "600" }}>
                  TRANSFER REQUEST{partCount > 1 ? ` (PART ${part} OF ${partCount})` : ""}
                </p>
              </div>

              <p style={{ marginBottom: "1.25rem", paddingRight: "3rem" }}>
                Please debit our account <strong>{selectedAccount || "—"}</strong> with{" "}
                <strong>₦{total.toLocaleString()}</strong> (<em>{amountInWords}</em>) and transfer as follows:
              </p>

              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "1.5rem" }}>
                <thead>
                  <tr>
                    <th style={{ ...headCell, width: "28px", textAlign: "center" }}>#</th>
                    <th style={headCell}>Account Name</th>
                    <th style={headCell}>Account Number</th>
                    <th style={headCell}>Bank</th>
                    <th style={{ ...headCell, textAlign: "right" }}>Amount (₦)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row._id || index}>
                      <td style={{ ...cell, textAlign: "center" }}>{index + 1}</td>
                      <td style={cell}>{row.accountName || row.name}</td>
                      <td style={cell}>{row.accountNumber || "—"}</td>
                      <td style={cell}>{row.bankName || "—"}</td>
                      <td style={{ ...cell, textAlign: "right" }}>{row.netPay.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{ ...cell, fontWeight: "bold", textAlign: "right" }}>
                      Total
                    </td>
                    <td style={{ ...cell, fontWeight: "bold", textAlign: "right" }}>₦{total.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>

              <p style={{ fontWeight: "bold", marginBottom: "2rem", paddingTop: "2.5em" }}>Thank you.</p>
              <p>Yours faithfully,</p>
              <p style={{ marginBottom: "2rem" }}>
                For: <span style={{ fontWeight: "600" }}>Ibile Trading Resource Limited.</span>
              </p>
              <p style={{ fontWeight: "bold", paddingTop: "3em" }}>{activeDirector}</p>
              <p style={{ fontWeight: "bold" }}>Director</p>
            </div>

            {/* Footer */}
            <div
              style={{
                fontSize: "10px",
                color: "#444",
                position: "absolute",
                bottom: "-11.4rem",
                right: "1.2rem",
              }}
            >
              <div style={{ fontWeight: "bold", display: "flex", justifyContent: "flex-end" }}>
                <p>Ibile Trading Resources Ltd.</p>
                <span style={{ padding: "0 1rem" }}>||</span>
                <p>Re 1s2414s</p>
              </div>
              <p>1, Garba Lawall Street, Off Ogombo Road, Abraham Adesanya, Ajah, Lagos.</p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <p>
                  W: <a href="https://ibilemart.com">ibilemart.com</a> || E:{" "}
                  <a href="mailto:info@ibilemart.com">info@ibilemart.com</a> || T: +234 803 240 5598
                </p>
              </div>
            </div>

            {/* Watermarks */}
            <img
              src="/images/LogoWaterMarkFull.png"
              alt="WatermarkLeft"
              style={{ position: "absolute", left: "-3em", bottom: "-21em", opacity: 0.1, zIndex: 0, height: "25em", width: "auto" }}
            />
            <img
              src="/images/LogoWaterMark.png"
              alt="WatermarkRight"
              style={{
                position: "absolute",
                right: "-21em",
                top: "20em",
                opacity: 0.1,
                zIndex: 0,
                height: "40em",
                width: "auto",
                transform: "rotate(340deg)",
              }}
            />
          </div>
        </div>
      </div>
    );
  }
);

SalaryMemo.displayName = "SalaryMemo";
export default SalaryMemo;
