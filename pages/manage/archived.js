import Layout from "@/components/Layout";
import { useEffect, useState } from "react";
import axios from "axios";
import { Loader } from "@/components/ui";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/lib/useAuth";


export default function Archived() {
  const [archivedProducts, setArchivedProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const { isAdmin } = useAuth();

  useEffect(() => {
    async function loadArchived() {
      try {
        setLoading(true);
        const res = await axios.get("/api/products?archived=true");
        const rows = Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res?.data?.data)
            ? res.data.data
            : [];
        setArchivedProducts(rows);
      } finally {
        setLoading(false);
      }
    }

    loadArchived();
  }, []);

  const handleRestore = async (productId) => {
    try {
      setRestoringId(productId);
      await axios.put("/api/products", { _id: productId, restore: true });
      setArchivedProducts((prev) => prev.filter((p) => p._id !== productId));
    } catch (error) {
      console.error("Restore failed", error);
      await showAlertDialog({
        title: "Restore failed",
        message: "Failed to restore product.",
        tone: "danger",
      });
    } finally {
      setRestoringId(null);
    }
  };

  const handlePermanentDelete = async (productId) => {
    const shouldDelete = await showConfirmDialog({
      title: "Delete product permanently?",
      message: "This action cannot be undone.",
      tone: "danger",
      confirmLabel: "Delete permanently",
      cancelLabel: "Keep product",
    });
    if (!shouldDelete) return;
    try {
      setDeletingId(productId);
      await axios.delete(`/api/products?id=${productId}&permanent=true`);
      setArchivedProducts((prev) => prev.filter((p) => p._id !== productId));
    } catch (error) {
      console.error("Delete failed", error);
      await showAlertDialog({
        title: "Delete failed",
        message: error?.response?.data?.message || "Failed to delete product.",
        tone: "danger",
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
          <div className="page-header">
            <h1 className="page-title">Archived Products</h1>
            <p className="page-subtitle">Products are archived instead of permanently deleted.</p>
          </div>

          <div className="data-table-container">
            {loading ? (
              <div className="p-8 flex items-center justify-center">
                <Loader size="sm" text="Loading archived products..." />
              </div>
            ) : archivedProducts.length === 0 ? (
              <div className="content-card text-center py-12">
                <p className="text-gray-500">No archived products to display</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Sale Price</th>
                    <th>Archived On</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {archivedProducts.map((item) => (
                    <tr key={item._id}>
                      <td className="p-3 text-sm font-medium">{item.name}</td>
                      <td className="p-3 text-sm">{formatCurrency(item.salePriceIncTax || 0)}</td>
                      <td className="p-3 text-sm">
                        {item.archivedAt ? new Date(item.archivedAt).toLocaleString() : "-"}
                      </td>
                      <td className="p-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleRestore(item._id)}
                            className="py-1 px-3 rounded bg-emerald-600 text-white text-xs disabled:opacity-60"
                            disabled={restoringId === item._id}
                          >
                            {restoringId === item._id ? "Restoring..." : "Restore"}
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => handlePermanentDelete(item._id)}
                              className="py-1 px-3 rounded bg-red-600 text-white text-xs disabled:opacity-60"
                              disabled={deletingId === item._id}
                            >
                              {deletingId === item._id ? "Deleting..." : "Delete"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

