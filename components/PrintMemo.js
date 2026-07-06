import { useRef, forwardRef, useImperativeHandle } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { toWords } from "number-to-words";

const PrintMemo = forwardRef(
  ({ order, form, editing, handleChange, onDownloading, selectedAccount, selectedDirector }, ref) => {
    const memoRef = useRef();
    const companyName = order?.vendorName || order?.supplier || "Unknown";
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
        pdf.save(`Transfer Instruction ${today} (${companyName}).pdf`);
        onDownloading?.(false);
      },
    }));

    if (!order) return null;

    const amountInWords =
      form.amount && !isNaN(Number(form.amount))
        ? `${toWords(Number(form.amount)).replace(/\b\w/g, (c) => c.toUpperCase())} Naira Only`
        : "";

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
            {/* Letter Content */}
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
              <p style={{ marginBottom: "1.5rem" }}>
                Branch Address
              </p>

              <p style={{ fontWeight: "600", marginBottom: "1rem", marginTop: "2rem" }}>
                Dear Sir,
              </p>

              <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
                <p style={{ fontWeight: "600" }}>TRANSFER REQUEST</p>
              </div>

              <p style={{ marginBottom: "1.5rem", paddingRight: "3rem" }}>
                Please debit our account <strong>{selectedAccount || "Main Account"}</strong> with{" "}
                <strong>₦{Number(form.amount || 0).toLocaleString()}</strong> (
                <em>{amountInWords}</em>) and transfer as follows:
              </p>

              {/* Editable Section */}
              <div style={{ margin: "3rem 0" }}>
                {editing ? (
                  <>
                    <p>
                      Account Name -{" "}
                      <input
                        name="accountName"
                        value={form.accountName}
                        onChange={handleChange}
                        style={{ border: "1px solid black", padding: "4px", fontSize: "0.875rem", width: "60%" }}
                      />
                    </p>
                    <p>
                      Account Number -{" "}
                      <input
                        name="accountNumber"
                        value={form.accountNumber}
                        onChange={handleChange}
                        style={{ border: "1px solid black", padding: "4px", fontSize: "0.875rem", width: "60%" }}
                      />
                    </p>
                    <p>
                      Bank Name -{" "}
                      <input
                        name="bankName"
                        value={form.bankName}
                        onChange={handleChange}
                        style={{ border: "1px solid black", padding: "4px", fontSize: "0.875rem", width: "60%" }}
                      />
                    </p>
                    <p>
                      Amount -{" "}
                      <input
                        name="amount"
                        type="number"
                        value={form.amount}
                        onChange={handleChange}
                        style={{ border: "1px solid black", padding: "4px", fontSize: "0.875rem", width: "60%" }}
                      />
                    </p>
                  </>
                ) : (
                  <div>
                    <p>Account Name: {form.accountName}</p>
                    <p>Account Number: {form.accountNumber}</p>
                    <p>Bank Name: {form.bankName}</p>
                    <p>Amount: ₦{Number(form.amount || 0).toLocaleString()}</p>
                  </div>
                )}
              </div>

              <p style={{ fontWeight: "bold", marginBottom: "2rem", paddingTop: "5em" }}>
                Thank you.
              </p>
              <p>Yours faithfully,</p>
              <p style={{ fontWeight: "bold", paddingTop: "3.5em" }}>{activeDirector}</p>
              <p style={{ fontWeight: "bold" }}>Director</p>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

PrintMemo.displayName = "PrintMemo";
export default PrintMemo;
