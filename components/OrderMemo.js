import { useRef, forwardRef, useImperativeHandle } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const th = { borderBottom: "1px solid black", padding: "8px", textAlign: "left" };
const td = { borderBottom: "1px solid #ccc", padding: "6px 8px", fontSize: "13px" };

const OrderMemo = forwardRef(({ order = {}, onDownloading = () => {} }, ref) => {
  const memoRef = useRef();
  const today = order.date
    ? new Date(order.date).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];
  const vendorName = order.vendorName || order.supplier || "Vendor";

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
      pdf.save(`Order Memo - ${vendorName} - ${today}.pdf`);
      onDownloading(false);
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

        <div style={{ position: "relative", zIndex: 2, paddingTop: "5.8rem" }}>
          <div style={{ marginBottom: "1.5rem" }}>
            <p style={{ fontWeight: "600", fontSize: "15px" }}>
              ORDER MEMO — {vendorName}
            </p>
          </div>

          <p style={{ marginBottom: "1.5rem" }}>
            Order placed on{" "}
            <strong>
              {new Date(today).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </strong>
          </p>

          {/* Vendor Details */}
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: "5px",
              padding: "1rem",
              backgroundColor: "#f9f9f9",
              marginBottom: "2rem",
            }}
          >
            <p style={{ fontWeight: "bold", marginBottom: "0.5rem" }}>Vendor Details:</p>
            <p><strong>Name:</strong> {vendorName}</p>
            {order.contact && <p><strong>Phone:</strong> {order.contact}</p>}
            {order.location && <p><strong>Location:</strong> {order.location}</p>}
          </div>

          {/* Products Table */}
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "2rem" }}>
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
                  <td style={td}>{product.name || product.productName}</td>
                  <td style={td}>{product.quantity}</td>
                  <td style={td}>₦{Number(product.price || 0).toLocaleString()}</td>
                  <td style={td}>
                    ₦{(Number(product.price || 0) * Number(product.quantity || 0)).toLocaleString()}
                  </td>
                </tr>
              ))}
              <tr style={{ backgroundColor: "#f0f4f8", borderTop: "2px solid #ddd" }}>
                <td colSpan={4} style={{ ...td, fontWeight: "bold" }}>Total</td>
                <td style={{ ...td, fontWeight: "bold" }}>
                  ₦{Number(order.grandTotal || 0).toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Payment Status */}
          {order.status && (
            <div style={{ marginTop: "1rem" }}>
              <p>
                <strong>Payment Status:</strong> {order.status}
              </p>
              {order.paymentMade > 0 && (
                <p>
                  <strong>Paid:</strong> ₦{Number(order.paymentMade).toLocaleString()} |{" "}
                  <strong>Balance:</strong> ₦{Number(order.balance || 0).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

OrderMemo.displayName = "OrderMemo";
export default OrderMemo;
