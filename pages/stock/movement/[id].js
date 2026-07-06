import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { formatCurrency } from "@/lib/format";

export default function MovementDetails() {
  const router = useRouter();
  const { id } = router.query;
  const [movement, setMovement] = useState(null);

  useEffect(() => {
    if (!router.isReady) return;

    const movementId = router.query.id;

    async function fetchMovement() {
      try {
        const res = await fetch(`/api/stock-movement/${movementId}`);
        const data = await res.json();
        setMovement(data);
      } catch (err) {
        console.error("Failed to fetch movement:", err);
      }
    }

    fetchMovement();
  }, [router.isReady, router.query.id]);

  function exportToCSV() {
    if (!movement || !Array.isArray(movement.products)) return;

    const rows = [["Product", "Cost Price", "Quantity", "Subtotal"]];
    movement.products.forEach((p) => {
      const name = p?.id?.name || "N/A";
      const cost = p?.id?.costPrice || 0;
      const qty = p.quantity || 0;
      const subtotal = cost * qty;
      rows.push([name, cost, qty, subtotal]);
    });

    const csvContent = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `stock_movement_${id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function exportToExcel() {
    const html = document.getElementById("movement-report")?.outerHTML || "";
    const blob = new Blob([html], {
      type: "application/vnd.ms-excel",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `stock_movement_${id}.xls`;
    link.click();
  }

if (!movement)
  return (
    <Layout>
      <div className="page-container">
        <div className="page-content flex items-center justify-center min-h-[60vh]">
          <div className="skeleton h-8 w-64"></div>
        </div>
      </div>
    </Layout>
  );

  const totalCost = formatCurrency(movement.totalCostPrice || 0);

  const products = Array.isArray(movement.products) ? movement.products : [];


  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
        <div className="page-header flex-row items-center justify-between">
          <h1 className="page-title">
            Stock Movement Details
          </h1>
          <button className="btn-action btn-action-primary">
            PRINT LABELS
          </button>
        </div>
        <div id="print-section">
          <div className="content-card mb-6 overflow-hidden p-0">
            <div className="p-4 bg-gray-50 border-b font-semibold text-sm text-gray-700">
              Stock Movement Info
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 text-sm text-gray-700">
              <div>
                <strong>From Location:</strong> {movement.fromLocation}
              </div>
              <div>
                <strong>To Location:</strong> {movement.toLocation}
              </div>
              <div>
                <strong>Ref. Number:</strong>{" "}
                <div className="font-mono text-lg mt-1">
                  *{movement.transRef}*
                </div>
              </div>
              <div>
                <strong>Reason:</strong> {movement.reason}
              </div>
              <div>
                <strong>Staff Sent:</strong> {movement.staff}
              </div>
              <div>
                <strong>Date Sent:</strong>{" "}
                {new Date(movement.dateSent).toLocaleString("en-NG")}
              </div>
              <div>
                <strong>Status:</strong> {movement.status}
              </div>
              <div>
                <strong>Staff Received:</strong> {movement.staff}
              </div>
              <div>
                <strong>Date Received:</strong>{" "}
                {movement.dateReceived
                  ? new Date(movement.dateReceived).toLocaleString("en-NG")
                  : "---"}
              </div>
              <div>
                <strong>Note:</strong> 
                <div className="mt-1 text-gray-600">{movement.notes || "—"}</div>
              </div>
            </div>
          </div>

          {/* Products Table */}
          <div className="data-table-container mb-6">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Unit Cost Price</th>
                  <th>Sent</th>
                  <th>Received</th>
                  <th>Total Cost Price</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, idx) => {
                  const name = p.productName || "N/A";
                  const cost = p.costPrice || 0;
                  const qty = p.quantity || 0;
                  const subtotal = cost * qty;
                  return (
                    <tr key={idx}>
                      <td>{name}</td>
                      <td>{cost.toLocaleString()}</td>
                      <td>{qty}</td>
                      <td>{qty}</td>
                      <td className="font-medium">
                        {subtotal.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
                <tr className="theme-table-summary-row font-bold">
                  <td colSpan={4}>
                    Total:
                  </td>
                  <td>{totalCost}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="flex flex-wrap gap-4">
          <button
            onClick={() => router.push("/stock/movement")}
            className="btn-action btn-action-danger"
          >
            BACK
          </button>
          <button
            onClick={() => router.push(`/stock/movement/edit/${id}`)}
            className="btn-action btn-action-primary"
          >
            EDIT / RECEIVE
          </button>
          <button
            onClick={exportToCSV}
            className="btn-action btn-action-secondary"
          >
            EXPORT TO .CSV
          </button>
          <button
            onClick={exportToExcel}
            className="btn-action btn-action-secondary"
          >
            EXPORT TO EXCEL
          </button>
          <button
            onClick={() => window.print()}
            className="btn-action btn-action-secondary"
          >
            PRINT
          </button>
        </div>
        </div>
      </div>
    </Layout>
  );
}
