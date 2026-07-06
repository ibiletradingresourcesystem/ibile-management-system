"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Search } from "lucide-react";
import Layout from "@/components/Layout";
import axios from "axios";
import Link from "next/link";
import useSWR, { mutate } from "swr";
import { showAlertDialog, showConfirmDialog } from "@/lib/dialogs";
import { formatCurrency } from "@/lib/format";

const entriesPerPageDefault = 20;

// --- fetcher for SWR
const fetcher = (url) => axios.get(url).then((r) => r.data);

// Debounce utility
function debounce(func, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

export default function Promotions() {
  // SWR-backed promotion list
  const { data: productsData, error } = useSWR("/api/products", fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 60000,
  });

  // local UI state
  const [allPromotions, setAllPromotions] = useState([]);
  const [filteredPromotions, setFilteredPromotions] = useState([]);
  const [editIndex, setEditIndex] = useState(null);
  const [editablePromotion, setEditablePromotion] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("* Show All");
  const [filterCustomer, setFilterCustomer] = useState("* Show All");
  const [expandedRow, setExpandedRow] = useState(null);

  // pagination
  const [entriesPerPage] = useState(entriesPerPageDefault);
  const [visibleCount, setVisibleCount] = useState(entriesPerPageDefault);

  // Load promotions on data change
  useEffect(() => {
    if (productsData) {
      const products = Array.isArray(productsData)
        ? productsData
        : productsData?.data || [];
      const promoProducts = products.filter((p) => p.isPromotion === true);
      setAllPromotions(promoProducts);
      setFilteredPromotions(promoProducts);
    }
  }, [productsData]);

  // Debounced search
  const debouncedSearch = useCallback(
    debounce((term, promos) => {
      const filtered = promos.filter((p) =>
        p.name.toLowerCase().includes(term.toLowerCase())
      );
      setFilteredPromotions(filtered);
      setVisibleCount(entriesPerPageDefault);
    }, 300),
    []
  );

  const handleSearchChange = (e) => {
    const term = e.target.value;
    setSearchTerm(term);
    debouncedSearch(term, allPromotions);
  };

  const handleSearch = () => {
    const filtered = allPromotions.filter((p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredPromotions(filtered);
    setVisibleCount(entriesPerPageDefault);
  };

  const handleEditClick = (index, promo) => {
    setEditIndex(index);
    setEditablePromotion({
      ...promo,
      promoStart: promo.promoStart
        ? promo.promoStart.split("T")[0]
        : "",
      promoEnd: promo.promoEnd
        ? promo.promoEnd.split("T")[0]
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
        _id,
        ...editablePromotion,
        promoStart: editablePromotion.promoStart
          ? new Date(editablePromotion.promoStart)
          : null,
        promoEnd: editablePromotion.promoEnd
          ? new Date(editablePromotion.promoEnd)
          : null,
      });
      mutate("/api/products");
      setEditIndex(null);
      setEditablePromotion({});
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
      mutate("/api/products");
      setAllPromotions((prev) => prev.filter((p) => p._id !== _id));
      setFilteredPromotions((prev) => prev.filter((p) => p._id !== _id));
    } catch (err) {
      console.error("Failed to remove promotion:", err);
      await showAlertDialog({
        title: "Remove failed",
        message: "Error removing promotion.",
        tone: "danger",
      });
    }
  };

  const handleLoadMore = () => {
    setVisibleCount((prev) => prev + entriesPerPageDefault);
  };

  const visibleData = filteredPromotions.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPromotions.length;

  return (
    <Layout>
      <div className="page-container">
        <div className="page-content">
        {/* Header */}
        <div className="page-header flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <h1 className="page-title">Promotions</h1>
            <span className="theme-badge-soft text-xs px-2 py-1 rounded-full font-medium">
              HELP
            </span>
          </div>
          <Link
            href="/manage/add-promotion"
            className="btn-action-primary w-full sm:w-auto text-center"
          >
            + Add Promotion
          </Link>
        </div>

        {/* Filters and Search */}
        <div className="content-card mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {/* Filter by Promotion Type */}
            <div className="form-group">
              <label className="form-label">
                Filter by Promotion Type
              </label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="form-select"
              >
                <option>* Show All</option>
                <option>Percentage Discount</option>
                <option>Fixed Price</option>
                <option>Bundle Deal</option>
                <option>Buy N Get M</option>
              </select>
            </div>

            {/* Filter by Customer Type */}
            <div>
              <label className="text-sm font-semibold text-gray-700 block mb-2">
                Filter by Customer Type
              </label>
              <select
                value={filterCustomer}
                onChange={(e) => setFilterCustomer(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>* Show All</option>
                <option>Retail</option>
                <option>Wholesale</option>
                <option>VIP</option>
              </select>
            </div>
          </div>

          {/* Search Bar */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="Search by Name or Description"
                value={searchTerm}
                onChange={handleSearchChange}
                className="w-full border border-gray-300 rounded-lg p-3 pl-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            </div>
            <button
              onClick={handleSearch}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
            >
              SEARCH
            </button>
          </div>
        </div>

        {/* Promotions Table */}
        <div className="overflow-x-auto bg-white rounded-lg shadow-md border border-gray-200">
          <table className="w-full text-sm">
            <thead className="table-header-gradient text-white sticky top-0">
              <tr>
                <th className="px-6 py-4 text-left font-semibold">NAME</th>
                <th className="px-6 py-4 text-left font-semibold">DESCRIPTION</th>
                <th className="px-6 py-4 text-center font-semibold">START DATE</th>
                <th className="px-6 py-4 text-center font-semibold">END DATE</th>
                <th className="px-6 py-4 text-center font-semibold">DEAL</th>
                <th className="px-6 py-4 text-center font-semibold">TYPE</th>
                <th className="px-6 py-4 text-center font-semibold">REQUIRED QUANTITY</th>
                <th className="px-6 py-4 text-center font-semibold">AMOUNT</th>
                <th className="px-6 py-4 text-center font-semibold">MIX AND MATCH</th>
                <th className="px-6 py-4 text-center font-semibold">NOT USED IN CONJUNCTION</th>
                <th className="px-6 py-4 text-center font-semibold">ENABLED</th>
                <th className="px-6 py-4 text-center font-semibold">DAYS ENABLED</th>
                <th className="px-6 py-4 text-center font-semibold">CUSTOMER TYPE</th>
                <th className="px-6 py-4 text-center font-semibold">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {visibleData.length > 0 ? (
                visibleData.map((promo, index) => (
                  <tr
                    key={promo._id}
                    className="hover:bg-blue-50 transition-colors"
                  >
                    <td className="px-6 py-4 font-semibold text-gray-900">
                      {editIndex === index ? (
                        <input
                          type="text"
                          name="name"
                          value={editablePromotion.name || ""}
                          onChange={handleChange}
                          className="border border-gray-300 rounded px-2 py-1 w-full"
                        />
                      ) : (
                        promo.name
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-700">
                      {editIndex === index ? (
                        <input
                          type="text"
                          name="description"
                          value={editablePromotion.description || ""}
                          onChange={handleChange}
                          className="border border-gray-300 rounded px-2 py-1 w-full"
                        />
                      ) : (
                        promo.description || "-"
                      )}
                    </td>
                    <td className="px-6 py-4 text-center text-gray-700">
                      {editIndex === index ? (
                        <input
                          type="date"
                          name="promoStart"
                          value={editablePromotion.promoStart || ""}
                          onChange={handleChange}
                          className="border border-gray-300 rounded px-2 py-1 w-full"
                        />
                      ) : (
                        promo.promoStart
                          ? new Date(promo.promoStart).toLocaleDateString("en-GB")
                          : "-"
                      )}
                    </td>
                    <td className="px-6 py-4 text-center text-gray-700">
                      {editIndex === index ? (
                        <input
                          type="date"
                          name="promoEnd"
                          value={editablePromotion.promoEnd || ""}
                          onChange={handleChange}
                          className="border border-gray-300 rounded px-2 py-1 w-full"
                        />
                      ) : (
                        promo.promoEnd
                          ? new Date(promo.promoEnd).toLocaleDateString("en-GB")
                          : "-"
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {editIndex === index ? (
                        <select
                          name="dealType"
                          value={editablePromotion.dealType || "X For N"}
                          onChange={handleChange}
                          className="border border-gray-300 rounded px-2 py-1 w-full"
                        >
                          <option>X For N</option>
                          <option>Percentage Off</option>
                          <option>Fixed Discount</option>
                        </select>
                      ) : (
                        <span className="theme-badge-soft px-3 py-1 rounded-full text-xs font-semibold">
                          {promo.dealType || "X For N"}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center text-gray-700">
                      {editIndex === index ? (
                        <select
                          name="promoType"
                          value={editablePromotion.promoType || "Sales"}
                          onChange={handleChange}
                          className="border border-gray-300 rounded px-2 py-1 w-full"
                        >
                          <option>Sales</option>
                          <option>Bundle</option>
                          <option>Seasonal</option>
                        </select>
                      ) : (
                        promo.promoType || "Sales"
                      )}
                    </td>
                    <td className="px-6 py-4 text-center text-gray-700">
                      {editIndex === index ? (
                        <input
                          type="number"
                          name="requiredQuantity"
                          value={editablePromotion.requiredQuantity || ""}
                          onChange={handleChange}
                          className="border border-gray-300 rounded px-2 py-1 w-full"
                        />
                      ) : (
                        promo.requiredQuantity || "-"
                      )}
                    </td>
                    <td className="px-6 py-4 text-center text-gray-700">
                      {editIndex === index ? (
                        <input
                          type="number"
                          name="promoPrice"
                          value={editablePromotion.promoPrice || ""}
                          onChange={handleChange}
                          className="border border-gray-300 rounded px-2 py-1 w-full"
                        />
                      ) : (
                        formatCurrency(promo.promoPrice || 0)
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {editIndex === index ? (
                        <input
                          type="checkbox"
                          name="mixAndMatch"
                          checked={editablePromotion.mixAndMatch || false}
                          onChange={(e) =>
                            setEditablePromotion((prev) => ({
                              ...prev,
                              mixAndMatch: e.target.checked,
                            }))
                          }
                          className="w-4 h-4"
                        />
                      ) : promo.mixAndMatch ? (
                        <span className="text-green-600 font-bold"></span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center text-gray-700">
                      {editIndex === index ? (
                        <input
                          type="checkbox"
                          name="notUsedInConjunction"
                          checked={editablePromotion.notUsedInConjunction || false}
                          onChange={(e) =>
                            setEditablePromotion((prev) => ({
                              ...prev,
                              notUsedInConjunction: e.target.checked,
                            }))
                          }
                          className="w-4 h-4"
                        />
                      ) : promo.notUsedInConjunction ? (
                        <span className="text-green-600 font-bold"></span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {editIndex === index ? (
                        <input
                          type="checkbox"
                          name="enabled"
                          checked={editablePromotion.enabled !== false}
                          onChange={(e) =>
                            setEditablePromotion((prev) => ({
                              ...prev,
                              enabled: e.target.checked,
                            }))
                          }
                          className="w-4 h-4"
                        />
                      ) : promo.enabled !== false ? (
                        <span className="text-green-600 font-bold">Enabled</span>
                      ) : (
                        <span className="text-red-600 font-semibold">Disabled</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center text-gray-700 text-xs">
                      {editIndex === index ? (
                        <input
                          type="text"
                          name="daysEnabled"
                          value={editablePromotion.daysEnabled || ""}
                          onChange={handleChange}
                          className="border border-gray-300 rounded px-2 py-1 w-full"
                        />
                      ) : (
                        promo.daysEnabled ||
                        "Mon, Tue, Wed, Thu, Fri, Sat, Sun"
                      )}
                    </td>
                    <td className="px-6 py-4 text-center text-gray-700">
                      {editIndex === index ? (
                        <select
                          name="customerType"
                          value={editablePromotion.customerType || "All"}
                          onChange={handleChange}
                          className="border border-gray-300 rounded px-2 py-1 w-full"
                        >
                          <option>All</option>
                          <option>Retail</option>
                          <option>Wholesale</option>
                          <option>VIP</option>
                        </select>
                      ) : (
                        promo.customerType || "All"
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex gap-2 justify-center">
                        {editIndex === index ? (
                          <>
                            <button
                              onClick={() => handleUpdateClick(promo._id)}
                              className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-semibold transition-colors"
                            >
                              Save
                            </button>
                            <button
                              onClick={handleCancelClick}
                              className="bg-gray-400 hover:bg-gray-500 text-white px-3 py-1 rounded text-xs font-semibold transition-colors"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleEditClick(index, promo)}
                              className="border border-blue-600 text-blue-600 hover:bg-blue-50 px-3 py-1 rounded text-xs font-semibold transition-colors"
                            >
                              EDIT
                            </button>
                            <button
                              onClick={() => handleDeleteClick(promo._id)}
                              className="border border-red-600 text-red-600 hover:bg-red-50 px-3 py-1 rounded text-xs font-semibold transition-colors"
                            >
                              
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan="14"
                    className="px-6 py-8 text-center text-gray-500"
                  >
                    No promotions found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Load More Button */}
        {hasMore && (
          <div className="text-center mt-6">
            <button
              onClick={handleLoadMore}
              className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-2 rounded-lg font-semibold transition-colors"
            >
              Load More
            </button>
          </div>
        )}
        </div>
      </div>
    </Layout>
  );
}
