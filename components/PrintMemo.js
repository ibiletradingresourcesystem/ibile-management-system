import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { useRef, forwardRef, useImperativeHandle } from "react";
import { toWords } from "number-to-words";

const PrintMemo = forwardRef(
  (
    { order, form, editing, handleChange, onDownloading, selectedAccount, selectedDirector },
    ref
  ) => {
    const memoRef = useRef();
    const companyName = order?.supplier || "Unknown";
    const today = new Date().toISOString().split("T")[0];
    const activeDirector = selectedDirector || "Catherine Ashenuga Farrer";

    useImperativeHandle(ref, () => ({
      generatePDF: async () => {
        if (!memoRef.current) return;
        onDownloading(true);

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
        pdf.save(
          `Transfer Instruction ${today} (From 9143 to ${companyName}).pdf`
        );
        onDownloading(false);
      },
    }));

    if (!order) return null;

    const amountInWords =
      form.amount && !isNaN(Number(form.amount))
        ? `${toWords(Number(form.amount)).replace(/\b\w/g, (c) =>
            c.toUpperCase()
          )} Naira Only`
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
            {/* Logo Header */}
            <div style={{ position: "absolute", top: "1rem", right: "-2rem" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/logoName.png"
                alt="Ibile Mart Logo"
                style={{ height: "9em", width: "auto" }}
              />
            </div>

            {/* Letter Content */}
            <div style={{ paddingTop: "5.5rem" }}>
              <p style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>
                {new Date(today).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
                .
              </p>
              <p>The Branch Manager</p>
              <p>Access Bank Plc Oba</p>
              <p style={{ marginBottom: "1.5rem" }}>
                Oniru Road Victoria Island
                <br />
                Lagos
              </p>

              <p
                style={{
                  fontWeight: "600",
                  marginBottom: "1rem",
                  marginTop: "2rem",
                }}
              >
                Dear Sir,
              </p>

              <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
                <p style={{ textDecoration: "underline", fontWeight: "bold" }}>
                  ATTENTION: WILLIAMS CHEKE
                </p>
                <p style={{ fontWeight: "600" }}>TRANSFER REQUEST</p>
              </div>

              <p style={{ marginBottom: "1.5rem", paddingRight: "3rem" }}>
                Please debit our account <strong>{selectedAccount}</strong> with{" "}
                <strong>₦{form.amount.toLocaleString()}</strong> (
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
                        style={{
                          border: "1px solid black",
                          padding: "4px",
                          fontSize: "0.875rem",
                          width: "60%",
                        }}
                      />
                    </p>
                    <p>
                      Account Number -{" "}
                      <input
                        name="accountNumber"
                        value={form.accountNumber}
                        onChange={handleChange}
                        style={{
                          border: "1px solid black",
                          padding: "4px",
                          fontSize: "0.875rem",
                          width: "60%",
                        }}
                      />
                    </p>
                    <p>
                      Bank Name -{" "}
                      <input
                        name="bankName"
                        value={form.bankName}
                        onChange={handleChange}
                        style={{
                          border: "1px solid black",
                          padding: "4px",
                          fontSize: "0.875rem",
                          width: "60%",
                        }}
                      />
                    </p>
                    <p>
                      Amount -{" "}
                      <input
                        name="amount"
                        type="number"
                        value={form.amount}
                        onChange={handleChange}
                        style={{
                          border: "1px solid black",
                          padding: "4px",
                          fontSize: "0.875rem",
                          width: "60%",
                        }}
                      />
                    </p>
                  </>
                ) : (
                  order.vendor && (
                    <div>
                      <p>Account Name: {form.accountName}</p>
                      <p>Account Number: {form.accountNumber}</p>
                      <p>Bank Name: {form.bankName}</p>
                    </div>
                  )
                )}
              </div>

              <p
                style={{
                  fontWeight: "bold",
                  marginBottom: "2rem",
                  paddingTop: "5em",
                }}
              >
                Thank you.
              </p>
              <p>Yours faithfully,</p>
              <p style={{ marginBottom: "2rem" }}>
                For:{" "}
                <span style={{ fontWeight: "600" }}>
                  Ibile Trading Resource Limited.
                </span>
              </p>
              <p style={{ fontWeight: "bold", paddingTop: "3.5em" }}>
                {activeDirector}
              </p>
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
              <div
                style={{
                  fontWeight: "bold",
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                <p>Ibile Trading Resources Ltd.</p>
                <span style={{ padding: "0 1rem" }}>||</span>
                <p>Re 1s2414s</p>
              </div>
              <p>
                1, Garba Lawall Street, Off Ogombo Road, Abraham Adesanya, Ajah,
                Lagos.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <p>
                  W: <a href="https://ibilemart.com">ibilemart.com</a> || E:{" "}
                  <a href="mailto:info@ibilemart.com">info@ibilemart.com</a> ||
                  T: +234 803 240 5598
                </p>
              </div>
            </div>

            {/* Watermarks */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/LogoWaterMarkFull.png"
              alt="WatermarkLeft"
              style={{
                position: "absolute",
                left: "-3em",
                bottom: "-21em",
                opacity: 0.1,
                zIndex: 0,
                height: "25em",
                width: "auto",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
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

        {/* Mobile Scaling */}
        <style jsx>{`
          @media (max-width: 768px) {
            div[ref] {
              transform: scale(0.85);
              transform-origin: top left;
              width: 100%;
              overflow-x: auto;
            }
          }
        `}</style>
      </div>
    );
  }
);

PrintMemo.displayName = "PrintMemo";
export default PrintMemo;
