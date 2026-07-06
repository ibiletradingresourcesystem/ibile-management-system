"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Search } from "lucide-react";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";

export default function PromotionManagement() {
  const [promotions, setPromotions] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [editIndex, setEditIndex] = useState(null);
  const [editablePromotion, setEditablePromotion] = useState({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [allProducts, setAllProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [promoPrice, setPromoPrice] = useState("");
  const [promoStart, setPromoStart] = useState("");
  const [promoEnd, setPromoEnd] = useState("");

  /* =======================
     FETCH PROMOTIONS
  ======================= */
  const fetchPromotions = async () => {
    try {
      const res = await axios.get("/api/products");
      const products = Array.isArray(res.data)
        ? res.data
        : res.data?.data || [];

      const promoProducts = products.filter(
        (p) => p.isPromotion === true
      );
      setPromotions(promoProducts);
    } catch (err) {
      console.error("Error fetching promotions:", err);
    }
  };

  useEffect(() => {
    fetchPromotions();
  }, []);

  const fetchProducts = async () => {
    try {
      const res = await axios.get("/api/products");
      setAllProducts(
        Array.isArray(res.data) ? res.data : res.data?.data || []
      );
    } catch (err) {
      console.error("Error fetching products:", err);
    }
  };

  /* =======================
     HANDLERS
  ======================= */
  const handleSearch = () => {
    const filtered = promotions.filter((p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setPromotions(filtered);
  };

  const handleEditClick = (index, promo) => {
    setEditIndex(index);
    setEditablePromotion({
      ...promo,
      promoStart: promo.promoStart
        ? promo.promoStart.slice(0, 10)
        : "",
      promoEnd: promo.promoEnd
        ? promo.promoEnd.slice(0, 16)
        : "",
    });
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setEditablePromotion((prev) => ({ ...prev, [name]: value }));
  };

  const handleUpdateClick = async (_id) => {
    try {
      await axios.put("/api/products", {
        ...editablePromotion,
        promoStart: editablePromotion.promoStart
          ? new Date(editablePromotion.promoStart)
          : null,
        promoEnd: editablePromotion.promoEnd
          ? new Date(editablePromotion.promoEnd)
          : null,
      });

      fetchPromotions();
      setEditIndex(null);
    } catch (err) {
      console.error("Failed to update promotion:", err);
      await showAlertDialog({
        title: "Update failed",
        message: "Error updating promotion.",
        tone: "danger",
      });
    }
  };

  const handleCancelClick = () => {
    setEditIndex(null);
    setEditablePromotion({});
  };

  const handleDeleteClick = async (_id) => {
    const shouldDelete = await showConfirmDialog({
      title: "Remove promotion?",
      message: "This promotion will be removed from the product.",
      tone: "danger",
      confirmLabel: "Remove promotion",
      cancelLabel: "Keep promotion",
    });
    if (!shouldDelete) return;
    try {
      await axios.put("/api/products", {
        _id,
        isPromotion: false,
        promoPrice: null,
        promoStart: null,
        promoEnd: null,
      });
      setPromotions((prev) => prev.filter((p) => p._id !== _id));
    } catch (err) {
      console.error("Failed to remove promotion:", err);
    }
  };

  /* =======================
     MODAL
  ======================= */
  const openModal = () => {
    fetchProducts();
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setSelectedProduct(null);
    setPromoPrice("");
    setPromoStart("");
    setPromoEnd("");
    setIsModalOpen(false);
  };

  const handleSavePromotion = async () => {
    if (!selectedProduct || !promoPrice) {
      await showAlertDialog({
        title: "Missing promotion details",
        message: "Please select a product and enter a promo price.",
        tone: "warning",
      });
      return;
    }

    try {
      await axios.put("/api/products", {
        _id: selectedProduct._id,
        isPromotion: true,
        promoPrice: Number(promoPrice),
        promoStart: promoStart ? new Date(promoStart) : null,
        promoEnd: promoEnd ? new Date(promoEnd) : null,
      });

      fetchPromotions();
      closeModal();
    } catch (err) {
      console.error("Error saving promotion:", err);
    }
  };

  return (
    <div className="min-h-full bg-slate-50 p-3 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between gap-3 mb-6">
        <h2 className="text-2xl md:text-3xl font-bold theme-section-title">Promotions</h2>
        <button
          onClick={openModal}
          className="btn-action-primary w-full sm:w-auto px-4 md:px-6 py-2 text-sm md:text-base"
        >
          + Add Promotion
        </button>
      </div>

      {/* Table */}
      <div className="data-table-container overflow-x-auto bg-white rounded-lg shadow">
        <table className="min-w-full text-xs md:text-sm">
          <thead className="table-header-gradient text-white">
            <tr>
              <th className="p-2 md:p-3 text-left">Product</th>
              <th className="p-2 md:p-3">Promo Price</th>
              <th className="p-2 md:p-3 hidden sm:table-cell">Start</th>
              <th className="p-2 md:p-3 hidden sm:table-cell">End</th>
              <th className="p-2 md:p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {promotions.map((promo, index) => (
              <tr key={promo._id} className="border-b">
                <td className="p-2 md:p-3 font-semibold text-xs md:text-sm">{promo.name}</td>

                <td className="p-2 md:p-3 text-xs md:text-sm">
                  {editIndex === index ? (
                    <input
                      name="promoPrice"
                      type="number"
                      value={editablePromotion.promoPrice || ""}
                      onChange={handleChange}
                      className="border p-1 rounded w-20"
                    />
                  ) : (
                    formatCurrency(promo.promoPrice || 0)
                  )}
                </td>

                <td className="p-2 md:p-3 hidden sm:table-cell text-xs md:text-sm">
                  {editIndex === index ? (
                    <input
                      type="date"
                      name="promoStart"
                      value={editablePromotion.promoStart || ""}
                      onChange={handleChange}
                      className="border p-1 rounded text-xs"
                    />
                  ) : (
                    promo.promoStart
                      ? new Date(promo.promoStart).toLocaleDateString()
                      : "-"
                  )}
                </td>

                <td className="p-2 md:p-3 hidden sm:table-cell text-xs md:text-sm">
                  {editIndex === index ? (
                    <input
                      type="datetime-local"
                      name="promoEnd"
                      value={editablePromotion.promoEnd || ""}
                      onChange={handleChange}
                      className="border p-1 rounded text-xs"
                    />
                  ) : (
                    promo.promoEnd
                      ? new Date(promo.promoEnd).toLocaleString()
                      : "-"
                  )}
                </td>

                <td className="p-2 md:p-3 flex flex-col sm:flex-row gap-1 md:gap-2">
                  {editIndex === index ? (
                    <>
                      <button
                        onClick={() => handleUpdateClick(promo._id)}
                        className="btn-action-success px-2 md:px-3 py-1 text-xs md:text-sm"
                      >
                        Save
                      </button>
                      <button
                        onClick={handleCancelClick}
                        className="btn-action-secondary px-2 md:px-3 py-1 text-xs md:text-sm"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleEditClick(index, promo)}
                        className="btn-action-secondary px-2 md:px-3 py-1 text-xs md:text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteClick(promo._id)}
                        className="btn-action-danger px-2 md:px-3 py-1 text-xs md:text-sm"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white p-4 md:p-6 rounded-lg w-full max-w-md">
            <h3 className="text-lg md:text-xl font-bold mb-4">Add Promotion</h3>

            <select
              className="border p-2 w-full mb-3 text-sm"
              onChange={(e) =>
                setSelectedProduct(
                  allProducts.find((p) => p._id === e.target.value)
                )
              }
            >
              <option value="">Select product</option>
              {allProducts.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>

            <input
              type="number"
              placeholder="Promo Price"
              className="border p-2 w-full mb-3 text-sm"
              value={promoPrice}
              onChange={(e) => setPromoPrice(e.target.value)}
            />

            <input
              type="date"
              className="border p-2 w-full mb-3 text-sm"
              value={promoStart}
              onChange={(e) => setPromoStart(e.target.value)}
            />

            <input
              type="datetime-local"
              className="border p-2 w-full mb-4 text-sm"
              value={promoEnd}
              onChange={(e) => setPromoEnd(e.target.value)}
            />

            <div className="flex flex-col sm:flex-row justify-end gap-2">
              <button onClick={closeModal} className="btn-action-secondary w-full sm:w-auto text-sm sm:text-base">
                Cancel
              </button>
              <button onClick={handleSavePromotion} className="btn-action-primary w-full sm:w-auto text-sm sm:text-base">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
