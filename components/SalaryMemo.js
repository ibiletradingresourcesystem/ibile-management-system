import { useRef, forwardRef, useImperativeHandle } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const SalaryMemo = forwardRef(
  ({ staffPayroll = [], selectedAccount, selectedDirector, onDownloading }, ref) => {
    const memoRef = useRef();
    const today = new Date().toISOString().split("T")[0];
    const activeDirector = selectedDirector || "Director";

    useImperativeHandle(ref, () => ({
      generatePDF: async () => {
        if (!memoRef.current) return;
        onDownloading?.(true);

        const canvas = await html2canvas(memoRef.current, {
          scale: 2,
          useCORS: true,
          backgroundColor: "#ffffff",
        });

        const imgData = canvas.toDataURL("image/jpeg", 0.6);
        const pdf = new jsPDF("p", "mm", "a4");
        const imgProps = pdf.getImageProperties(imgData);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

        pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
        pdf.save(`Salary Memo ${today}.pdf`);
        onDownloading?.(false);
      },
    }));

    if (!staffPayroll.length) return null;

    const totalNet = staffPayroll.reduce((sum, s) => {
      const penalties = (s.penalty || []).reduce((p, pen) => p + Number(pen.amount || 0), 0);
      return sum + (Number(s.salary || 0) - penalties);
    }, 0);

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
          {/* Sidebar */}
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
            <div style={{ paddingTop: "5.5rem" }}>
              <p style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>
                {new Date(today).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
              <p>The Branch Manager</p>
              <p>Bank Office</p>
              <p style={{ marginBottom: "1.5rem" }}>Branch Address</p>

              <p style={{ fontWeight: "600", marginBottom: "1rem", marginTop: "2rem" }}>
                Dear Sir,
              </p>

              <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
                <p style={{ fontWeight: "600" }}>SALARY TRANSFER INSTRUCTION</p>
              </div>

              <p style={{ marginBottom: "1.5rem" }}>
                Kindly debit our account <strong>{selectedAccount || "Main Account"}</strong> with the
                total sum of <strong>₦{totalNet.toLocaleString()}</strong> and credit the
                following accounts accordingly:
              </p>

              {/* Staff Table */}
              <table
                style={{ width: "100%", borderCollapse: "collapse", marginBottom: "2rem", fontSize: "12px" }}
              >
                <thead>
                  <tr style={{ backgroundColor: "#f5f7fa" }}>
                    <th style={thStyle}>#</th>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Bank</th>
                    <th style={thStyle}>Account</th>
                    <th style={thStyle}>Salary</th>
                    <th style={thStyle}>Deductions</th>
                    <th style={thStyle}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {staffPayroll.map((staff, i) => {
                    const penalties = (staff.penalty || []).reduce(
                      (p, pen) => p + Number(pen.amount || 0),
                      0
                    );
                    const net = Number(staff.salary || 0) - penalties;
                    return (
                      <tr key={staff._id || i}>
                        <td style={tdStyle}>{i + 1}</td>
                        <td style={tdStyle}>{staff.name}</td>
                        <td style={tdStyle}>{staff.bankName || "—"}</td>
                        <td style={tdStyle}>{staff.accountNumber || "—"}</td>
                        <td style={tdStyle}>₦{Number(staff.salary || 0).toLocaleString()}</td>
                        <td style={tdStyle}>{penalties > 0 ? `₦${penalties.toLocaleString()}` : "—"}</td>
                        <td style={{ ...tdStyle, fontWeight: "bold" }}>₦{net.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ backgroundColor: "#f0f4f8", borderTop: "2px solid #ddd" }}>
                    <td colSpan={6} style={{ ...tdStyle, fontWeight: "bold" }}>Total</td>
                    <td style={{ ...tdStyle, fontWeight: "bold" }}>₦{totalNet.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>

              <p style={{ fontWeight: "bold", marginBottom: "2rem", paddingTop: "3em" }}>
                Thank you.
              </p>
              <p>Yours faithfully,</p>
              <p style={{ fontWeight: "bold", paddingTop: "3em" }}>{activeDirector}</p>
              <p style={{ fontWeight: "bold" }}>Director</p>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

const thStyle = { borderBottom: "1px solid black", padding: "6px 8px", textAlign: "left" };
const tdStyle = { borderBottom: "1px solid #ccc", padding: "5px 8px" };

SalaryMemo.displayName = "SalaryMemo";
export default SalaryMemo;
