"use client";

import Layout from "@/components/Layout";
import { Loader } from "@/components/ui";
import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import { showConfirmDialog } from "@/lib/dialogs";
import { showToastMessage } from "@/lib/toast-state";
import useProgress from "@/lib/useProgress";

export default function PromotionsManagementPage() {
  const [promotions, setPromotions] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [visiblePromotions, setVisiblePromotions] = useState(30);
  const { progress, start, onFetch, onProcess, complete } = useProgress();

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    targetCustomerTypes: [],
    valueType: "DISCOUNT",
    discountType: "PERCENTAGE",
    discountValue: 0,
    fixedAmountApplyMode: "PER_ITEM",
    applicationType: "ALL_PRODUCTS",
    products: [],
    categories: [],
    startDate: "",
    endDate: "",
    indefinite: false,
    active: true,
    maxUses: "",
    displayAbovePrice: true,
    priority: 0,
  });

  const filteredCategories = useMemo(() => {
    const query = categorySearch.trim().toLowerCase();
    const list = query
      ? categories.filter((cat) => cat.name?.toLowerCase().includes(query))
      : categories;
    return showAllCategories ? list : list.slice(0, 150);
  }, [categories, categorySearch, showAllCategories]);

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    const list = query
      ? products.filter((prod) => prod.name?.toLowerCase().includes(query))
      : products;
    return showAllProducts ? list : list.slice(0, 200);
  }, [products, productSearch, showAllProducts]);

  const visiblePromoList = useMemo(
    () => promotions.slice(0, visiblePromotions),
    [promotions, visiblePromotions]
  );

  useEffect(() => {
    fetchPromotions();
  }, []);

  useEffect(() => {
    if (!showForm) return;
    if (products.length && categories.length) return;
    loadReferenceData();
  }, [showForm, products.length, categories.length]);

  useEffect(() => {
    if (!error) return;
    showToastMessage({ title: "Campaign promotions", text: error, fallbackTone: "danger" });
    setError("");
  }, [error]);

  useEffect(() => {
    if (!success) return;
    showToastMessage({ title: "Campaign promotions", text: success, fallbackTone: "success" });
    setSuccess("");
  }, [success]);

  async function fetchPromotions() {
    try {
      setLoading(true);
      start();
      
      // Fetch promotions
      const promoRes = await fetch("/api/promotions");
      onFetch();
      if (promoRes.ok) {
        const data = await promoRes.json();
        onProcess();
        setPromotions(data.promotions || []);
      }
    } catch (err) {
      console.error("Error fetching data:", err);
      setError("Failed to load data");
    } finally {
      complete();
      setLoading(false);
    }
  }

  async function loadReferenceData() {
    try {
      setLoadingRefs(true);

      const cachedProducts = sessionStorage.getItem("promo-products-cache");
      const cachedCategories = sessionStorage.getItem("promo-categories-cache");
      if (cachedProducts && cachedCategories) {
        setProducts(JSON.parse(cachedProducts));
        setCategories(JSON.parse(cachedCategories));
        return;
      }

      const [prodRes, catRes] = await Promise.all([
        fetch("/api/products"),
        fetch("/api/categories"),
      ]);

      if (prodRes.ok) {
        const data = await prodRes.json();
        const productsList = Array.isArray(data) ? data : (data.data || []);
        setProducts(productsList);
        sessionStorage.setItem("promo-products-cache", JSON.stringify(productsList));
      }

      if (catRes.ok) {
        const data = await catRes.json();
        const categoriesList = Array.isArray(data) ? data : (data.categories || []);
        setCategories(categoriesList);
        sessionStorage.setItem("promo-categories-cache", JSON.stringify(categoriesList));
      }
    } catch (err) {
      console.error("Error fetching reference data:", err);
      setError("Failed to load products or categories");
    } finally {
      setLoadingRefs(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!formData.name) {
      setError("Promotion name is required");
      return;
    }

    // Only require dates if NOT indefinite
    if (!formData.indefinite) {
      if (!formData.startDate) {
        setError("Start date is required");
        return;
      }
      if (!formData.endDate) {
        setError("End date is required");
        return;
      }
    }

    if (formData.applicationType === "ONE_PRODUCT" && formData.products.length === 0) {
      setError("Please select a product");
      return;
    }

    if (formData.applicationType === "CATEGORY" && formData.categories.length === 0) {
      setError("Please select at least one category");
      return;
    }

    if (formData.targetCustomerTypes.length === 0) {
      setError("Please select at least one customer type");
      return;
    }

    try {
      const url = editing ? `/api/promotions/${editing}` : "/api/promotions";
      const method = editing ? "PUT" : "POST";

      // Prepare data - handle dates properly
      const dataToSend = { ...formData };
      
      // Ensure dates are properly formatted
      if (dataToSend.indefinite) {
        // For indefinite promotions, set a 1-year date range
        const today = new Date();
        const oneYearLater = new Date();
        oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
        
        dataToSend.startDate = dataToSend.startDate ? new Date(dataToSend.startDate) : today;
        dataToSend.endDate = dataToSend.endDate ? new Date(dataToSend.endDate) : oneYearLater;
      } else {
        // For regular promotions, ensure both dates are Date objects
        if (dataToSend.startDate && typeof dataToSend.startDate === 'string') {
          dataToSend.startDate = new Date(dataToSend.startDate);
        }
        if (dataToSend.endDate && typeof dataToSend.endDate === 'string') {
          dataToSend.endDate = new Date(dataToSend.endDate);
        }
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataToSend),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to save promotion");
      }

      setSuccess(`Promotion ${editing ? "updated" : "created"} successfully!`);
      resetForm();
      fetchPromotions();
    } catch (err) {
      setError(err.message);
    }
  }

  function resetForm() {
    setFormData({
      name: "",
      description: "",
      targetCustomerTypes: [],
      valueType: "DISCOUNT",
      discountType: "PERCENTAGE",
      discountValue: 0,
      fixedAmountApplyMode: "PER_ITEM",
      applicationType: "ALL_PRODUCTS",
      products: [],
      categories: [],
      startDate: "",
      endDate: "",
      indefinite: false,
      active: true,
      maxUses: "",
      displayAbovePrice: true,
      priority: 0,
    });
    setEditing(null);
    setShowForm(false);
  }

  function handleEdit(promo) {
    setFormData({
      ...promo,
      products: promo.products?.map(p => p._id || p) || [],
      categories: promo.categories?.map(c => c._id || c) || [],
    });
    setEditing(promo._id);
    setShowForm(true);
  }

  async function handleDelete(id) {
    const shouldDelete = await showConfirmDialog({
      title: "Delete promotion?",
      message: "This promotion will be removed permanently.",
      tone: "danger",
      confirmLabel: "Delete promotion",
      cancelLabel: "Keep promotion",
    });
    if (!shouldDelete) return;

    try {
      const res = await fetch(`/api/promotions/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSuccess("Promotion deleted successfully!");
        fetchPromotions();
      }
    } catch (err) {
      setError(err.message);
    }
  }

  const toggleCustomerType = (type) => {
    setFormData({
      ...formData,
      targetCustomerTypes: formData.targetCustomerTypes.includes(type)
        ? formData.targetCustomerTypes.filter(t => t !== type)
        : [...formData.targetCustomerTypes, type],
    });
  };

  const toggleProduct = (id) => {
    setFormData({
      ...formData,
      products: formData.products.includes(id)
        ? formData.products.filter(p => p !== id)
        : [...formData.products, id],
    });
  };

  const toggleCategory = (id) => {
    setFormData({
      ...formData,
      categories: formData.categories.includes(id)
        ? formData.categories.filter(c => c !== id)
        : [...formData.categories, id],
    });
  };

  if (loading) {
    return (
      <Layout>
        <Loader size="lg" text="Loading promotions..." progress={progress} />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="page-container">
        <div className="max-w-7xl mx-auto">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="page-header flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="page-title">Campaign Promotions</h1>
            </div>
            <button
              onClick={() => {
                resetForm();
                setShowForm(!showForm);
              }}
              className="btn-action btn-action-primary"
            >
              + Create Promotion
            </button>
          </div>

          {/* Form */}
          {showForm && (
            <div className="content-card mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                {editing ? "Edit Promotion" : "Create New Promotion"}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Promotion Name *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="form-input"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Description
                    </label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="form-input"
                    />
                  </div>
                </div>

                {/* Discount/Increment Settings */}
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-3">Price Adjustment Settings</h3>
                  
                  {/* Value Type Toggle */}
                  <div className="mb-4 flex gap-2">
                    <label className="flex-1 flex items-center p-3 border-2 rounded-lg cursor-pointer" style={{
                      borderColor: formData.valueType === "DISCOUNT" ? "#06b6d4" : "#e5e7eb",
                      backgroundColor: formData.valueType === "DISCOUNT" ? "#ecf9fb" : "white",
                    }}>
                      <input
                        type="radio"
                        name="valueType"
                        value="DISCOUNT"
                        checked={formData.valueType === "DISCOUNT"}
                        onChange={(e) => setFormData({ ...formData, valueType: e.target.value })}
                        className="w-4 h-4"
                      />
                      <span className="ml-2 font-semibold text-gray-700"> Discount (Reduce Price)</span>
                    </label>
                    <label className="flex-1 flex items-center p-3 border-2 rounded-lg cursor-pointer" style={{
                      borderColor: formData.valueType === "INCREMENT" ? "#06b6d4" : "#e5e7eb",
                      backgroundColor: formData.valueType === "INCREMENT" ? "#ecf9fb" : "white",
                    }}>
                      <input
                        type="radio"
                        name="valueType"
                        value="INCREMENT"
                        checked={formData.valueType === "INCREMENT"}
                        onChange={(e) => setFormData({ ...formData, valueType: e.target.value })}
                        className="w-4 h-4"
                      />
                      <span className="ml-2 font-semibold text-gray-700"> Increment (Increase Price)</span>
                    </label>
                  </div>

                  {/* Amount Settings */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Type *
                      </label>
                      <select
                        value={formData.discountType}
                        onChange={(e) => setFormData({ ...formData, discountType: e.target.value })}
                        className="form-input"
                      >
                        <option value="PERCENTAGE">Percentage (%)</option>
                        <option value="FIXED">Fixed Amount ()</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Value * ({formData.valueType === "DISCOUNT" ? "Discount" : "Increment"})
                      </label>
                      <input
                        type="number"
                        value={formData.discountValue}
                        onChange={(e) => setFormData({ ...formData, discountValue: parseFloat(e.target.value) })}
                        className="form-input"
                        required
                        min="0"
                        placeholder={formData.discountType === "PERCENTAGE" ? "Enter 0-100" : "Enter amount in "}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Max Uses (Optional)
                      </label>
                      <input
                        type="number"
                        value={formData.maxUses}
                        onChange={(e) => setFormData({ ...formData, maxUses: e.target.value ? parseInt(e.target.value) : "" })}
                        className="form-input"
                        min="0"
                      />
                    </div>
                  </div>

                  {/* Fixed Amount Apply Mode - Only show when FIXED is selected */}
                  {formData.discountType === "FIXED" && (
                    <div className="mt-4">
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Apply Fixed Amount To *
                      </label>
                      <div className="flex gap-2">
                        <label className="flex-1 flex items-center p-3 border-2 rounded-lg cursor-pointer" style={{
                          borderColor: formData.fixedAmountApplyMode === "PER_ITEM" ? "#06b6d4" : "#e5e7eb",
                          backgroundColor: formData.fixedAmountApplyMode === "PER_ITEM" ? "#ecf9fb" : "white",
                        }}>
                          <input
                            type="radio"
                            name="fixedAmountApplyMode"
                            value="PER_ITEM"
                            checked={formData.fixedAmountApplyMode === "PER_ITEM"}
                            onChange={(e) => setFormData({ ...formData, fixedAmountApplyMode: e.target.value })}
                            className="w-4 h-4"
                          />
                          <span className="ml-2 font-semibold text-gray-700">Each Product</span>
                          <span className="ml-1 text-xs text-gray-500">(deduct/add per item)</span>
                        </label>
                        <label className="flex-1 flex items-center p-3 border-2 rounded-lg cursor-pointer" style={{
                          borderColor: formData.fixedAmountApplyMode === "TOTAL" ? "#06b6d4" : "#e5e7eb",
                          backgroundColor: formData.fixedAmountApplyMode === "TOTAL" ? "#ecf9fb" : "white",
                        }}>
                          <input
                            type="radio"
                            name="fixedAmountApplyMode"
                            value="TOTAL"
                            checked={formData.fixedAmountApplyMode === "TOTAL"}
                            onChange={(e) => setFormData({ ...formData, fixedAmountApplyMode: e.target.value })}
                            className="w-4 h-4"
                          />
                          <span className="ml-2 font-semibold text-gray-700">Cart Total</span>
                          <span className="ml-1 text-xs text-gray-500">(deduct/add once on total)</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                {/* Customer Types */}
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-3">Target Customer Types *</h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {["REGULAR", "VIP", "NEW", "INACTIVE", "BULK_BUYER", "ONLINE", "CREDIT"].map((type) => (
                      <label key={type} className="flex items-center p-2 border-2 rounded-lg cursor-pointer hover:bg-gray-50" style={{
                        borderColor: formData.targetCustomerTypes.includes(type) ? "#06b6d4" : "#e5e7eb",
                        backgroundColor: formData.targetCustomerTypes.includes(type) ? "#ecf9fb" : "white",
                      }}>
                        <input
                          type="checkbox"
                          checked={formData.targetCustomerTypes.includes(type)}
                          onChange={() => toggleCustomerType(type)}
                          className="w-4 h-4"
                        />
                        <span className="ml-2 text-sm font-semibold text-gray-700">{type}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Application Type */}
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-3">Apply To *</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      { value: "ALL_PRODUCTS", label: "All Products" },
                      { value: "CATEGORY", label: "Specific Categories" },
                      { value: "ONE_PRODUCT", label: "Specific Products" },
                    ].map((option) => (
                      <label key={option.value} className="flex items-center p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50" style={{
                        borderColor: formData.applicationType === option.value ? "#06b6d4" : "#e5e7eb",
                        backgroundColor: formData.applicationType === option.value ? "#ecf9fb" : "white",
                      }}>
                        <input
                          type="radio"
                          name="applicationType"
                          value={option.value}
                          checked={formData.applicationType === option.value}
                          onChange={(e) => setFormData({ ...formData, applicationType: e.target.value })}
                          className="w-4 h-4"
                        />
                        <span className="ml-2 text-sm font-semibold text-gray-700">{option.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Categories Selection */}
                {formData.applicationType === "CATEGORY" && (
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 mb-3">Select Categories *</h3>
                    <div className="mb-3">
                      <input
                        type="text"
                        value={categorySearch}
                        onChange={(e) => {
                          setCategorySearch(e.target.value);
                          setShowAllCategories(false);
                        }}
                        className="search-input"
                        placeholder="Search categories..."
                      />
                    </div>
                    {loadingRefs ? (
                      <div className="text-sm text-gray-500">Loading categories...</div>
                    ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto">
                      {filteredCategories.map((cat) => (
                        <label key={cat._id} className="flex items-center p-2 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={formData.categories.includes(cat._id)}
                            onChange={() => toggleCategory(cat._id)}
                            className="w-4 h-4"
                          />
                          <span className="ml-2 text-sm text-gray-700">{cat.name}</span>
                        </label>
                      ))}
                    </div>
                    )}
                    {!showAllCategories && filteredCategories.length < categories.length && (
                      <button
                        type="button"
                        onClick={() => setShowAllCategories(true)}
                        className="btn-action btn-action-secondary btn-sm mt-2"
                      >
                        Show all categories
                      </button>
                    )}
                  </div>
                )}

                {/* Products Selection */}
                {formData.applicationType === "ONE_PRODUCT" && (
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 mb-3">Select Products *</h3>
                    <div className="mb-3">
                      <input
                        type="text"
                        value={productSearch}
                        onChange={(e) => {
                          setProductSearch(e.target.value);
                          setShowAllProducts(false);
                        }}
                        className="search-input"
                        placeholder="Search products..."
                      />
                    </div>
                    {loadingRefs ? (
                      <div className="text-sm text-gray-500">Loading products...</div>
                    ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                      {filteredProducts.map((prod) => (
                        <label key={prod._id} className="flex items-center p-2 border-2 border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={formData.products.includes(prod._id)}
                            onChange={() => toggleProduct(prod._id)}
                            className="w-4 h-4"
                          />
                          <span className="ml-2 text-sm text-gray-700">{prod.name}</span>
                        </label>
                      ))}
                    </div>
                    )}
                    {!showAllProducts && filteredProducts.length < products.length && (
                      <button
                        type="button"
                        onClick={() => setShowAllProducts(true)}
                        className="btn-action btn-action-secondary btn-sm mt-2"
                      >
                        Show all products
                      </button>
                    )}
                  </div>
                )}

                {/* Date Range */}
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-3">Promotion Period</h3>
                  
                  {/* Indefinite Option */}
                  <div className="mb-4">
                    <label className="flex items-center p-3 border-2 rounded-lg cursor-pointer" style={{
                      borderColor: formData.indefinite ? "#06b6d4" : "#e5e7eb",
                      backgroundColor: formData.indefinite ? "#ecf9fb" : "white",
                    }}>
                      <input
                        type="checkbox"
                        checked={formData.indefinite}
                        onChange={(e) => setFormData({ ...formData, indefinite: e.target.checked })}
                        className="w-4 h-4"
                      />
                      <span className="ml-2 font-semibold text-gray-700"> Indefinite (Never Expires)</span>
                    </label>
                  </div>

                  {/* Date Inputs - Hidden when Indefinite */}
                  {!formData.indefinite && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                          Start Date *
                        </label>
                        <input
                          type="datetime-local"
                          value={formData.startDate}
                          onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                          className="form-input"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                          End Date *
                        </label>
                        <input
                          type="datetime-local"
                          value={formData.endDate}
                          onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                          className="form-input"
                          required
                        />
                      </div>
                    </div>
                  )}

                  {/* Message when Indefinite is Selected */}
                  {formData.indefinite && (
                    <div className="p-4 bg-cyan-50 border-2 border-cyan-300 rounded-lg text-center">
                      <p className="text-cyan-900 font-semibold">
                         This promotion will run indefinitely starting from today
                      </p>
                    </div>
                  )}
                </div>

                {/* Active Status */}
                <div>
                  <label className="flex items-center p-3 border-2 border-gray-300 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.active}
                      onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span className="ml-2 text-sm font-semibold text-gray-700">Promotion is Active</span>
                  </label>
                </div>

                {/* Display Settings */}
                <div className="border-2 border-gray-200 rounded-lg p-4 bg-cyan-50">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Display Settings</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="flex items-center p-3 border-2 border-gray-300 rounded-lg cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.displayAbovePrice}
                          onChange={(e) => setFormData({ ...formData, displayAbovePrice: e.target.checked })}
                          className="w-4 h-4"
                        />
                        <span className="ml-2 text-sm font-semibold text-gray-700">Show Promotion Above Product Price</span>
                      </label>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Priority Level (0 = highest)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={formData.priority}
                        onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                        className="form-input"
                      />
                    </div>
                  </div>
                </div>

                {/* Submit */}
                <div className="flex gap-2 pt-4 border-t">
                  <button
                    type="submit"
                    className="flex-1 px-4 py-3 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg font-semibold"
                  >
                    {editing ? "Update" : "Create"} Promotion
                  </button>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="flex-1 px-4 py-3 bg-gray-300 hover:bg-gray-400 text-gray-900 rounded-lg font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Promotions List */}
          <div className="grid grid-cols-1 gap-4">
            {promotions.length === 0 ? (
              <div className="content-card p-12 text-center">
                <p className="text-lg text-gray-600">No promotions yet. Create one to get started!</p>
              </div>
            ) : (
              visiblePromoList.map((promo) => (
                <div key={promo._id} className="content-card p-6 border-l-4" style={{
                  borderColor: promo.active ? "#06b6d4" : "#ccc"
                }}>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">{promo.name}</h3>
                      <p className="text-sm text-gray-600">{promo.description}</p>
                    </div>
                    <div className="text-right">
                      <div className={`text-2xl font-bold ${promo.valueType === "DISCOUNT" ? (promo.discountType === "PERCENTAGE" ? "text-green-600" : "text-green-600") : (promo.discountType === "PERCENTAGE" ? "text-orange-600" : "text-orange-600")}`}>
                        {promo.valueType === "DISCOUNT" ? "-" : "+"}{promo.discountValue}{promo.discountType === "PERCENTAGE" ? "%" : "₦"}
                      </div>
                      {promo.discountType === "FIXED" && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {promo.fixedAmountApplyMode === "TOTAL" ? "Applied to total" : "Per item"}
                        </div>
                      )}
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${promo.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                        {promo.active ? "Active" : "Inactive"}
                      </span>
                      <div className="text-xs text-gray-600 mt-1">{promo.valueType === "DISCOUNT" ? " Discount" : " Increment"}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
                    <div>
                      <p className="text-gray-600">Customer Types</p>
                      <p className="font-semibold text-gray-900">{promo.targetCustomerTypes?.join(", ") || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Apply To</p>
                      <p className="font-semibold text-gray-900">
                        {promo.applicationType === "ONE_PRODUCT" && promo.products?.length > 0
                          ? promo.products.map(p => p.name || p).join(", ")
                          : promo.applicationType === "CATEGORY" && promo.categories?.length > 0
                          ? promo.categories.map(c => c.name || c).join(", ")
                          : promo.applicationType?.replace(/_/g, " ")}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">Period</p>
                      <p className="font-semibold text-gray-900">
                        {new Date(promo.startDate).toLocaleDateString()} {promo.indefinite ? "-  Never expires" : `- ${new Date(promo.endDate).toLocaleDateString()}`}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">Times Used</p>
                      <p className="font-semibold text-gray-900">
                        {promo.timesUsed || 0}{promo.maxUses ? `/${promo.maxUses}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4 text-sm bg-cyan-50 p-3 rounded border border-cyan-200">
                    <div>
                      <p className="text-gray-600">Display Above Price</p>
                      <p className="font-semibold text-cyan-600">
                        {promo.displayAbovePrice ? " Yes" : " No"}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-600">Priority Level</p>
                      <p className="font-semibold text-gray-900">{promo.priority || 0}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Max Uses</p>
                      <p className="font-semibold text-gray-900">{promo.maxUses || "Unlimited"}</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(promo)}
                      className="btn-action-primary flex-1 px-3 py-2 text-sm font-semibold"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(promo._id)}
                      className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-semibold"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {promotions.length > visiblePromotions && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setVisiblePromotions((prev) => prev + 30)}
                className="btn-action btn-action-secondary"
              >
                Load more promotions
              </button>
            </div>
          )}
        </div>
        </div>
      </div>
    </Layout>
  );
}
