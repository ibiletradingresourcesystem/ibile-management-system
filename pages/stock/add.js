import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Layout from "@/components/Layout";
import { formatCurrency } from "@/lib/format";
import { Loader } from "@/components/ui";
import { apiClient } from "@/lib/api-client";
import { showAlertDialog } from "@/lib/dialogs";
import { useAuth } from "@/lib/useAuth";
import { formatVendorMovementLabel } from "@/lib/vendorDisplay";

export default function StockMovementAdd() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  
  const [locations, setLocations] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [reasons] = useState(["Restock", "Transfer", "Return", "Adjustment", "Operational Loss"]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [fromLocation, setFromLocation] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [staff, setStaff] = useState("");
  const [reason, setReason] = useState("");
  const [movementNotes, setMovementNotes] = useState("");

  const [products, setProducts] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [quantityInput, setQuantityInput] = useState(1);
  const [expiryDateInput, setExpiryDateInput] = useState("");
  const [addedProducts, setAddedProducts] = useState([]);
  
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [poRef, setPoRef] = useState(null);
  const [poLoading, setPoLoading] = useState(false);
  const [unmatchedProducts, setUnmatchedProducts] = useState([]);
  const [savingPrices, setSavingPrices] = useState({});

  const isOperationalLoss = reason === "Operational Loss";
  const requiresDestination = !isOperationalLoss;
  const isPurchaseOrderReceipt = Boolean(poRef?.id);

  useEffect(() => {
    fetch("/api/setup/setup")
      .then((res) => res.json())
      .then((data) => {
        if (data?.store?.locations) {
          const locs = data.store.locations.map((loc) => ({
            _id: loc._id,
            name: loc.name || loc,
          }));
          setLocations(locs);
        }
      })
      .catch(err => console.error("Error fetching locations:", err));

    fetch("/api/staff")
      .then((res) => res.json())
      .then(data => {
        const staffArray = Array.isArray(data) ? data : (data.data || []);
        setStaffList(staffArray);
      })
      .catch(err => console.error("Error fetching staff:", err));
  }, []);

  // Load PO data if redirected from Purchase Orders page
  useEffect(() => {
    if (!router.isReady || !router.query.poId) return;
    const poId = router.query.poId;
    setPoLoading(true);

    (async () => {
      try {
        const res = await apiClient.get(`/api/purchase-orders/${poId}`);
        const order = res.data?.order || res.data;
        if (!order) return;
        setPoRef({ id: poId, orderRef: order.orderRef, vendorName: order.vendorName });
        setFromLocation("vendor");
        setReason("Restock");

        // Match PO products to actual products — use productId first, fallback to name search
        const matched = [];
        const unmatched = [];
        for (const poProduct of (order.products || [])) {
          if (!poProduct.name && !poProduct.productId) continue;
          try {
            let match = null;

            // 1. Try fetching by productId directly (most reliable)
            if (poProduct.productId) {
              try {
                const idRes = await apiClient.get(`/api/products?id=${poProduct.productId}`);
                const product = idRes.data?.data || idRes.data;
                if (product && product._id) {
                  // If product is a child, resolve to parent
                  if (product.isChildProduct && product.parentProduct) {
                    const parentId = typeof product.parentProduct === 'object' ? product.parentProduct._id : product.parentProduct;
                    const parentRes = await apiClient.get(`/api/products?id=${parentId}`);
                    const parentProduct = parentRes.data?.data || parentRes.data;
                    if (parentProduct && parentProduct._id) {
                      match = parentProduct;
                    } else {
                      match = product;
                    }
                  } else {
                    match = product;
                  }
                }
              } catch {
                // productId lookup failed, fall through to name search
              }
            }

            // 2. Fallback: search by name if productId didn't match
            if (!match && poProduct.name) {
              const pRes = await apiClient.get(`/api/products?search=${encodeURIComponent(poProduct.name)}&excludeChild=true`);
              const productList = pRes.data?.data || (Array.isArray(pRes.data) ? pRes.data : []);
              const exactMatch = productList.find(p => p.name.toLowerCase() === poProduct.name.toLowerCase());
              const partialMatch = productList.find(p => p.name.toLowerCase().includes(poProduct.name.toLowerCase()) || poProduct.name.toLowerCase().includes(p.name.toLowerCase()));
              match = exactMatch || partialMatch || productList[0];
            }

            if (match) {
              const existing = matched.find(m => m._id === match._id);
              if (existing) {
                existing.quantity += (poProduct.quantity || 1);
              } else {
                matched.push({ ...match, quantity: poProduct.quantity || 1 });
              }
            } else {
              unmatched.push({ name: poProduct.name || 'Unknown', quantity: poProduct.quantity || 1, price: poProduct.price || 0 });
            }
          } catch {
            unmatched.push({ name: poProduct.name || 'Unknown', quantity: poProduct.quantity || 1, price: poProduct.price || 0 });
          }
        }
        if (matched.length > 0) setAddedProducts(matched);
        if (unmatched.length > 0) setUnmatchedProducts(unmatched);
      } catch (err) {
        console.error("Error loading PO:", err);
      } finally {
        setPoLoading(false);
      }
    })();
  }, [router.isReady]);

  // Load product data if redirected from Expiration Report for adjustment
  useEffect(() => {
    if (!router.isReady || !router.query.adjustProductId || router.query.poId) return;
    const { adjustProductId, adjustQty, reason: qReason } = router.query;

    (async () => {
      try {
        const res = await apiClient.get(`/api/products?id=${adjustProductId}`);
        const product = res.data?.data || res.data;
        if (product && product._id) {
          setAddedProducts([{ ...product, quantity: parseInt(adjustQty) || 1 }]);
          if (qReason) setReason(qReason);
        }
      } catch (err) {
        console.error("Error loading adjustment product:", err);
      }
    })();
  }, [router.isReady]);

  useEffect(() => {
    if (!router.isReady) return;

    if (router.query.reason) {
      setReason(String(router.query.reason));
    }

    if (router.query.lossNote) {
      setMovementNotes(String(router.query.lossNote));
    }
  }, [router.isReady, router.query.reason, router.query.lossNote]);

  useEffect(() => {
    if (isOperationalLoss) {
      setToLocation("");
    }
  }, [isOperationalLoss]);

  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      const trimmed = searchTerm.trim();
      if (trimmed.length >= 2) {
        setLoadingSearch(true);
        fetch(`/api/products?search=${encodeURIComponent(trimmed)}&stockManaged=true&excludeChild=true`)
          .then((res) => res.json())
          .then(data => {
            const productList = data.data || (Array.isArray(data) ? data : []);
            setProducts(Array.isArray(productList) ? productList : []);
          })
          .catch(err => {
            console.error("Error searching products:", err);
            setProducts([]);
          })
          .finally(() => setLoadingSearch(false));
      } else {
        setProducts([]);
        setLoadingSearch(false);
      }
    }, 500);

    return () => clearTimeout(delayDebounce);
  }, [searchTerm]);

  const handleProductSelect = (product) => {
    setSelectedProduct(product);
    setSearchTerm(""); // Clear search term to close dropdown without triggering search
    setProducts([]);
  };

  const updateProductQuantity = (productId, newQuantity) => {
    if (newQuantity < 1) return;
    setAddedProducts((prev) =>
      prev.map((p) =>
        p._id === productId
          ? { ...p, quantity: newQuantity }
          : p
      )
    );
  };

  const addProduct = () => {
    if (!selectedProduct) return;

    const existing = addedProducts.find((p) => p._id === selectedProduct._id);
    if (existing) {
      setAddedProducts((prev) =>
        prev.map((p) =>
          p._id === existing._id
            ? { ...p, quantity: p.quantity + quantityInput, expiryDate: expiryDateInput }
            : p
        )
      );
    } else {
      setAddedProducts((prev) => [
        ...prev,
        { ...selectedProduct, quantity: quantityInput, expiryDate: expiryDateInput },
      ]);
    }

    setSearchTerm("");
    setQuantityInput(1);
    setExpiryDateInput("");
    setSelectedProduct(null);
  };

  const removeProduct = (id) => {
    setAddedProducts((prev) => prev.filter((p) => p._id !== id));
  };

  // Admin: update product price inline
  const updateProductPrice = (productId, field, value) => {
    setAddedProducts((prev) =>
      prev.map((p) =>
        p._id === productId ? { ...p, [field]: Number(value) || 0 } : p
      )
    );
  };

  const saveProductPrice = async (product) => {
    setSavingPrices((prev) => ({ ...prev, [product._id]: true }));
    try {
      await apiClient.put("/api/products", {
        _id: product._id,
        costPrice: product.costPrice,
        salePriceIncTax: product.salePriceIncTax,
      });
    } catch (err) {
      await showAlertDialog({
        title: "Price save failed",
        message: "Failed to save price: " + (err.response?.data?.message || err.message),
        tone: "danger",
      });
    } finally {
      setSavingPrices((prev) => ({ ...prev, [product._id]: false }));
    }
  };

  const handleAddToStock = async () => {
    if (
      !fromLocation ||
      (requiresDestination && !toLocation) ||
      !staff ||
      !reason ||
      addedProducts.length === 0
    ) {
      await showAlertDialog({
        title: "Missing stock movement details",
        message: "Please complete all fields and add at least one product.",
        tone: "warning",
      });
      return;
    }

    try {
      setIsSubmitting(true);
      const totalCostPrice = addedProducts.reduce(
        (sum, product) => sum + (product.costPrice || 0) * product.quantity,
        0
      );

      if (isPurchaseOrderReceipt) {
        await apiClient.put(`/api/purchase-orders/${poRef.id}`, {
          action: "confirm-received",
          toLocationId: toLocation,
          staffId: staff || null,
          notes: movementNotes,
          products: addedProducts.map((product) => ({
            id: product._id,
            quantity: product.quantity,
            expiryDate: product.expiryDate || null,
            costPrice: product.costPrice || 0,
          })),
        });

        await showAlertDialog({
          title: "Purchase order received",
          message: "Purchase order received and stock updated successfully.",
          tone: "success",
        });
      } else {
        const transRef = Date.now().toString();
        const payload = {
          transRef,
          fromLocationId: fromLocation,
          toLocationId: requiresDestination ? toLocation : null,
          staffId: staff || null,
          vendorName: fromLocation === "vendor" ? poRef?.vendorName || "" : "",
          reason,
          notes: movementNotes,
          status: "Received",
          totalCostPrice,
          barcode: transRef,
          dateSent: new Date().toISOString(),
          dateReceived: new Date().toISOString(),
          products: addedProducts.map((product) => ({
            id: product._id,
            quantity: product.quantity,
            expiryDate: product.expiryDate || null,
          })),
        };

        const res = await fetch("/api/stock-movement/stock-movement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const result = await res.json();
        if (!res.ok) {
          throw new Error(result?.message || result?.error || `Server error: ${res.status}`);
        }

        await showAlertDialog({
          title: "Stock movement saved",
          message: "Stock movement added successfully.",
          tone: "success",
        });
      }

      setFromLocation("");
      setToLocation("");
      setStaff("");
      setReason("");
      setMovementNotes("");
      setAddedProducts([]);
      setSearchTerm("");
      setQuantityInput(1);
      setExpiryDateInput("");
      setSelectedProduct(null);

      setTimeout(() => {
        router.push("/stock/movement");
      }, 1500);
    } catch (err) {
      await showAlertDialog({
        title: "Save failed",
        message: "Error saving stock movement: " + err.message,
        tone: "danger",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalCost = addedProducts.reduce(
    (sum, p) => sum + (p.costPrice || 0) * p.quantity,
    0
  );

  return (
    <Layout>
      {isSubmitting && (
        <Loader
          fullScreen
          text={isPurchaseOrderReceipt ? "Receiving purchase order and updating stock..." : "Creating stock movement..."}
        />
      )}
      <div className="page-container">
        <div className="page-content">
        {/* Header */}
        <div className="page-header">
          <h1 className="page-title">{isOperationalLoss ? "Record Operational Loss" : "Create Stock Movement"}</h1>
          <p className="page-subtitle">{isOperationalLoss ? "Log damaged, wasted, expired, or missing stock with a traceable write-off." : "Transfer inventory between locations with full tracking and approval workflow"}</p>
        </div>

        {/* PO Reference Banner */}
        {poLoading && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <Loader size="sm" text="Loading purchase order details..." />
          </div>
        )}
        {poRef && !poLoading && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <p className="text-sm font-semibold text-blue-800">
              Receiving Purchase Order: {poRef.orderRef} from {poRef.vendorName}
            </p>
            <p className="text-xs text-blue-600 mt-1">
              Products have been pre-populated. Review and adjust quantities before submitting.
            </p>
            {unmatchedProducts.length > 0 && (
              <div className="mt-3 pt-3 border-t border-blue-200">
                <p className="text-xs font-semibold text-amber-700 mb-1">Unmatched PO items (add manually):</p>
                {unmatchedProducts.map((p, i) => (
                  <p key={i} className="text-xs text-amber-600">• {p.name} — Quantity: {p.quantity}, Price: {p.price.toLocaleString()}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Form Container */}
        <div className="content-card !p-0 overflow-hidden">
          {/* Section 1: Movement Details */}
          <div className="p-4 md:p-6 border-b border-gray-200">
            <h2 className="text-lg md:text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <div className="w-1.5 h-6 bg-sky-600 rounded-full"></div>
              Movement Details
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Dropdown
                label="From Location"
                value={fromLocation}
                onChange={setFromLocation}
                options={isOperationalLoss ? locations : [{ _id: "vendor", name: formatVendorMovementLabel(poRef?.vendorName) }, ...locations]}
                required
              />

              {requiresDestination ? (
                <Dropdown
                  label="To Location"
                  value={toLocation}
                  onChange={setToLocation}
                  options={locations}
                  required
                />
              ) : (
                <div className="form-group">
                  <label className="form-label">Loss Destination</label>
                  <div className="form-input bg-red-50 border-red-200 text-red-700">Recorded against operational loss register</div>
                </div>
              )}

              <Dropdown
                label="Responsible Staff"
                value={staff}
                onChange={setStaff}
                options={staffList}
                required
              />

              <Dropdown
                label="Movement Reason"
                value={reason}
                onChange={setReason}
                options={reasons.map((r) => ({ name: r, _id: r }))}
                required
              />

              <div className="md:col-span-2">
                <label className="form-label">Notes</label>
                <textarea
                  className="form-input min-h-24"
                  value={movementNotes}
                  onChange={(e) => setMovementNotes(e.target.value)}
                  placeholder={isOperationalLoss ? "Describe the loss, for example: damaged during handling, expired on shelf, broken pack, missing after recount." : "Optional notes for this movement."}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Product Selection */}
          <div className="p-4 md:p-8 border-b border-gray-200">
            <h2 className="text-lg md:text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <div className="w-1.5 h-6 bg-emerald-600 rounded-full"></div>
              Add Products
            </h2>

            <div className="space-y-4">
              {/* Product Search */}
              <div className="relative">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Search by Product Name or Barcode
                </label>
                <input
                  className="w-full border-2 border-gray-300 px-4 py-3 rounded-lg focus:border-cyan-600 focus:ring-2 focus:ring-cyan-500 transition"
                  placeholder="Type to search..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setSelectedProduct(null);
                  }}
                />
                {loadingSearch && (
                  <div className="absolute top-full mt-1 left-0 w-full bg-white border border-gray-200 rounded-lg p-4 shadow-lg z-20">
                    <Loader size="sm" text="Searching..." />
                  </div>
                )}
                {!loadingSearch && products.length > 0 && (
                  <ul className="absolute top-full mt-1 left-0 z-20 bg-white border border-gray-200 w-full max-h-64 overflow-y-auto rounded-lg shadow-lg">
                    {products.map((product) => (
                      <li
                        key={product._id}
                        className="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 transition"
                        onClick={() => handleProductSelect(product)}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-gray-900">{product.name}</span>
                          <span className="text-sm text-gray-600">{(product.salePriceIncTax || 0).toLocaleString()}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">Stock: {product.quantity || 0} units</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Selected Product Display */}
              {selectedProduct && (
                <div className="bg-cyan-50 p-4 rounded-lg border-2 border-cyan-200">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-gray-600 font-semibold">Selected Product:</p>
                      <p className="text-lg font-bold text-gray-900">{selectedProduct.name}</p>
                      <p className="text-sm text-gray-600 mt-1">
                        Available Stock: <span className="font-semibold text-gray-900">{selectedProduct.quantity || 0} units</span>
                      </p>
                      <p className="text-sm text-gray-600">
                        Cost Price: <span className="font-semibold text-cyan-700">{(selectedProduct.costPrice || 0).toLocaleString()}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedProduct(null)}
                      className="text-red-500 hover:text-red-700 font-semibold text-sm"
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>
              )}

              {/* Quantity and Expiry Date Input */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3 items-end">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Quantity
                  </label>
                  <div className="flex items-center border-2 border-gray-300 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setQuantityInput((q) => Math.max(q - 1, 1))}
                      className="bg-gray-100 hover:bg-gray-200 text-lg w-10 h-10 flex items-center justify-center transition"
                    >
                      
                    </button>
                    <input
                      type="number"
                      className="flex-1 text-center text-lg font-semibold border-0 focus:outline-none"
                      value={quantityInput}
                      onChange={(e) => {
                        const val = e.target.value.trim();
                        if (val === "") {
                          setQuantityInput("");
                        } else {
                          const num = parseInt(val);
                          if (!isNaN(num) && num > 0) {
                            setQuantityInput(num);
                          }
                        }
                      }}
                      onBlur={(e) => {
                        if (quantityInput === "" || isNaN(quantityInput)) {
                          setQuantityInput(1);
                        }
                      }}
                      onWheel={(e) => e.preventDefault()}
                    />
                    <button
                      onClick={() => setQuantityInput((q) => q + 1)}
                      className="bg-gray-100 hover:bg-gray-200 text-lg w-10 h-10 flex items-center justify-center transition"
                    >
                      +
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Expiry Date (Optional)
                  </label>
                  <input
                    type="date"
                    className="w-full border-2 border-gray-300 px-4 py-2 rounded-lg focus:border-cyan-600 focus:ring-2 focus:ring-cyan-500 transition"
                    value={expiryDateInput}
                    onChange={(e) => setExpiryDateInput(e.target.value)}
                  />
                </div>

                <button
                  onClick={addProduct}
                  disabled={!selectedProduct}
                  className="bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-400 text-white px-6 py-3 rounded-lg font-semibold transition h-10"
                >
                  Add Product
                </button>
              </div>
            </div>
          </div>

          {/* Section 3: Added Products */}
          <div className="p-4 md:p-8">
            <h2 className="text-lg md:text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <div className="w-1.5 h-6 bg-purple-600 rounded-full"></div>
              Products to Transfer ({addedProducts.length})
            </h2>

            {addedProducts.length > 0 ? (
              <div className="space-y-2 md:space-y-3 mb-6">
                {addedProducts.map((product, idx) => (
                  <div
                    key={idx}
                    className="bg-gray-50 p-3 md:p-4 rounded-lg border border-gray-200 hover:border-gray-300 transition space-y-2"
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 text-sm md:text-base">{product.name}</p>
                        <p className="text-xs md:text-sm text-gray-600">Cost: {(product.costPrice || 0).toLocaleString()} | Sell: {(product.salePriceIncTax || 0).toLocaleString()}</p>
                        {product.expiryDate && (
                          <p className="text-xs md:text-sm text-amber-600 font-medium">Expires: {new Date(product.expiryDate).toLocaleDateString()}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden bg-white">
                          <button
                            onClick={() => updateProductQuantity(product._id, product.quantity - 1)}
                            className="bg-gray-50 hover:bg-gray-100 w-8 h-8 flex items-center justify-center transition"
                          >
                            −
                          </button>
                          <span className="w-12 text-center font-semibold text-gray-900">{product.quantity}</span>
                          <button
                            onClick={() => updateProductQuantity(product._id, product.quantity + 1)}
                            className="bg-gray-50 hover:bg-gray-100 w-8 h-8 flex items-center justify-center transition"
                          >
                            +
                          </button>
                        </div>
                        <span className="font-semibold text-gray-900 min-w-fit">
                          {(product.costPrice * product.quantity).toLocaleString()}
                        </span>
                        <button
                          onClick={() => removeProduct(product._id)}
                          className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-2 rounded-lg transition font-medium"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {/* Admin: Price Adjustment */}
                    {isAdmin && (
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200">
                        <div className="flex items-center gap-1">
                          <label className="text-xs font-medium text-gray-500 whitespace-nowrap">Cost:</label>
                          <input
                            type="number"
                            value={product.costPrice || ""}
                            onChange={(e) => updateProductPrice(product._id, "costPrice", e.target.value)}
                            className="w-24 border border-gray-300 rounded px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            step="0.01"
                            min="0"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="text-xs font-medium text-gray-500 whitespace-nowrap">Sell:</label>
                          <input
                            type="number"
                            value={product.salePriceIncTax || ""}
                            onChange={(e) => updateProductPrice(product._id, "salePriceIncTax", e.target.value)}
                            className="w-24 border border-gray-300 rounded px-2 py-1 text-xs focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            step="0.01"
                            min="0"
                          />
                        </div>
                        <button
                          onClick={() => saveProductPrice(product)}
                          disabled={savingPrices[product._id]}
                          className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 transition font-medium"
                        >
                          {savingPrices[product._id] ? "Saving..." : "Save Price"}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                <p className="text-gray-600">No products added yet. Search and add products above.</p>
              </div>
            )}

            {/* Summary Card */}
            {addedProducts.length > 0 && (
              <div className="bg-gray-50 border-2 border-gray-200 rounded-lg p-4 md:p-6 mb-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <p className="text-xs md:text-sm text-gray-600 mb-1">Total Cost Price</p>
                    <p className="text-2xl md:text-3xl font-bold text-gray-900">{totalCost.toLocaleString()}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-xs md:text-sm text-gray-600 mb-1">Total Items</p>
                    <p className="text-2xl md:text-3xl font-bold text-cyan-600">{addedProducts.reduce((sum, p) => sum + p.quantity, 0)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 justify-end">
              <button
                onClick={() => router.push("/stock/movement")}
                className="btn-action-secondary w-full sm:w-auto"
              >
                Cancel
              </button>
              <button
                onClick={handleAddToStock}
                disabled={isSubmitting || addedProducts.length === 0 || !fromLocation || (requiresDestination && !toLocation) || !reason}
                className="btn-action-success w-full sm:w-auto"
              >
                {isSubmitting ? "Creating..." : isOperationalLoss ? "Record Operational Loss" : "Create Stock Movement"}
              </button>
            </div>
          </div>
        </div>
        </div>
      </div>
    </Layout>
  );
}

function Dropdown({ label, value, onChange, options, required = false }) {
  return (
    <div className="form-group">
      <label className="form-label">
        {label} {required && <span className="text-red-600">*</span>}
      </label>
      <select
        className="form-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      >
        <option value="">Select {label.toLowerCase()}...</option>
        {options.map((opt) => (
          <option key={opt._id} value={opt._id}>
            {opt.name}
          </option>
        ))}
      </select>
    </div>
  );
}

