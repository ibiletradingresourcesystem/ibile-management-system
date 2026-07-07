import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { useRef, forwardRef, useImperativeHandle, useState } from "react";

const OrderMemo = forwardRef(
  ({ order = {}, onDownloading = () => {}, memoIndex }, ref) => {
    
console.log("Order Details:", order)

    const memoRef = useRef();
    const today = order.createdAt
  ? new Date(order.createdAt).toISOString().split("T")[0]
  : "N/A"; // fallback or handle gracefully
 const vendor = order.vendor || {};
 

    useImperativeHandle(ref, () => ({
      generatePDF: async () => {
        if (!memoRef.current) return;
        if (typeof onDownloading === "function") onDownloading(true);

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
        const pageNum = (memoIndex ?? 0) + 1;
        pdf.save(`Ibile Order ${vendor.companyName} on ${today}.pdf`);
        if (typeof onDownloading === "function") onDownloading(false);
      },
    }));



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
            fontSize: "13px", 
          }}
        >
              <div style={{ pageBreakAfter: "always" }}>
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: -10,
                    height: "100%",
                    width: "1.5cm",
                    backgroundColor: "#D5F3F6",
                    zIndex: 0,
                  }}
                />
                <div
                  style={{ position: "absolute", top: "1rem", right: "2rem" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/image/LogoName.png"
                    alt="Ibile Mart Logo"
                    style={{ height: "9em", width: "auto" }}
                  />
                </div>

                <div
                  style={{
                    paddingTop: "5.8rem",
                    position: "relative",
                    zIndex: 2,
                  }}
                >

      {/* Content Wrapper */}
      <div style={{ position: "relative", zIndex: 2, paddingTop: "1rem" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          <p style={{ fontWeight: "600", fontSize: "15px" }}>
            ORDER MEMO FROM IBILE MART – ORDER #{order._id}
          </p>
        </div>

        <p style={{ marginBottom: "1.5rem" }}>
          Order details placed on{" "}
          <strong>
            {new Date(today).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </strong>
        </p>

        {/* Vendor */}
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: "5px",
            padding: "1rem",
            backgroundColor: "#f9f9f9",
            marginBottom: "2rem",
          }}
        >
          <p style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>
            Vendor Details:
          </p>
          <p><strong>Name:</strong> {vendor.companyName || "N/A"}</p>
          <p><strong>Phone:</strong> {vendor.repPhone || "N/A"}</p>
          <p><strong>Product:</strong> {vendor.mainProduct || "N/A"}</p>
        </div>

        {/* Table */}
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginBottom: "2rem",
          }}
        >
          <thead>
            <tr style={{ backgroundColor: "#f5f7fa" }}>
              <th style={th}>#</th>
              <th style={th}>Product</th>
              <th style={th}>Qty</th>
              <th style={th}>Price</th>
              <th style={th}>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {order.products?.map((product, i) => (
              <tr key={i}>
                <td style={td}>{i + 1}</td>
                <td style={td}>{product.name}</td>
                <td style={td}>{product.quantity}</td>
                <td style={td}>₦{product.price.toLocaleString()}</td>
                <td style={td}>
                  ₦{(product.price * product.quantity).toLocaleString()}
                </td>
              </tr>
            ))}
            <tr
              style={{
                backgroundColor: "#f0f4f8",
                borderTop: "2px solid #ddd",
              }}
            >
              <td colSpan={4} style={{ ...td, fontWeight: "bold" }}>
                Total
              </td>
              <td style={{ ...td, fontWeight: "bold" }}>
                ₦{order.grandTotal?.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>               
                </div>

                {/* Footer */}
                <div
                  style={{
                    fontSize: "10px",
                    color: "#444",
                    position: "absolute",
                    bottom: "1.2rem",
                    right: "1.3rem",
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
                    1, Garba Lawall Street, Off Ogombo Road, Abraham Adesanya,
                    Ajah, Lagos.
                  </p>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <p>
                      W: <a href="https://ibilemart.com">ibilemart.com</a> || E:{" "}
                      <a href="mailto:info@ibilemart.com">info@ibilemart.com</a>{" "}
                      || T: +234 803 240 5598
                    </p>
                  </div>
                </div>

                {/* Watermarks */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/image/LogoWaterMarkFull.png"
                  alt="WatermarkLeft"
                  style={{
                    position: "absolute",
                    left: "2em",
                    bottom: "-10em",
                    opacity: 0.1,
                    zIndex: 0,
                    height: "25em",
                    width: "auto",
                  }}
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/image/LogoWaterMark.png"
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

const th = {
  borderBottom: "1px solid black",
  padding: "8px",
  textAlign: "left",
};

const td = {
  borderBottom: "1px solid #ccc",
  padding: "6px 8px",
  fontSize: "13px",
};

OrderMemo.displayName = "OrderMemo";
export default OrderMemo;