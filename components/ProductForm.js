import axios from "axios";
import { useRouter } from "next/router";
import { Fragment, useState, useEffect, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash, faBarcode } from "@fortawesome/free-solid-svg-icons";
import Loader from "./Loader";
import useProgress from "@/lib/useProgress";
import { formatCurrency } from "@/lib/format";
import { getCachedCategories } from "@/lib/categoriesCache";
import { clearCache } from "@/lib/useIndexedDBCache";
import { useAuth } from "@/lib/useAuth";
import {
  calculateMarginPercent,
  calculateSalePriceIncTax,
  getPriceBreakdown,
  VAT_RATE,
} from "@/lib/pricing";
import { isDerivedChild } from "@/lib/packUnits";
import AIPriceSuggestion from "@/components/AIPriceSuggestion";
import ProductPackLinks from "@/components/ProductPackLinks";

const DAY_MS = 24 * 60 * 60 * 1000;

function toDateInputValue(v) {
  if (!v) return "";
  try {
    const s = typeof v === "string" ? v : new Date(v).toISOString();
    return s.slice(0, 10);
  } catch {
    return "";
  }
}

function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatShortDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

function formatQty(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? String(parseFloat(n.toFixed(2))) : "0";
}

function normalizeVendorIds(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      if (!value) return "";
      if (typeof value === "string") return value;
      if (typeof value === "object" && value._id) return String(value._id);
      if (typeof value?.toString === "function") return value.toString();
      return "";
    })
    .filter(Boolean);
}

export default function ProductForm(props) {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const returnTo = typeof router.query.returnTo === "string" ? router.query.returnTo : "";
  const returnRow = typeof router.query.returnRow === "string"
    ? Number(router.query.returnRow)
    : null;

  // --- State ---
  const [name, setName] = useState(props.name || "");
  const [description, setDescription] = useState(props.description || "");
  const [costPrice, setCostPrice] = useState(props.costPrice ?? "");
  // Existing products keep whether VAT was applied; new products get VAT by default
  const [applyTax, setApplyTax] = useState(props._id ? Number(props.taxRate) > 0 : true);
  const [salePriceIncTax, setSalePriceIncTax] = useState(
    props.salePriceIncTax ?? ""
  );
  const [margin, setMargin] = useState(props.margin ?? "");
  const [barcode, setBarcode] = useState(props.barcode || "");
  const [quantity, setQuantity] = useState(props.quantity ?? "");
  const [quantityEdited, setQuantityEdited] = useState(false);
  const [category, setCategory] = useState(props.category || "Top Level");
  const [categories, setCategories] = useState([]);
  const [images, setImages] = useState(props.images || []);
  const [properties, setProperties] = useState(props.properties || []);
  const [minStock, setMinStock] = useState(props.minStock ?? "");
  const [selectedVendors, setSelectedVendors] = useState(normalizeVendorIds(props.vendors));
  const [allVendors, setAllVendors] = useState([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [packType, setPackType] = useState(props.packType || "unit");
  const [qtyPerPack, setQtyPerPack] = useState(props.qtyPerPack ?? 1);
  const [childSalePrice, setChildSalePrice] = useState(props.childSalePrice ?? "");
  const [isLinkedChild, setIsLinkedChild] = useState(isDerivedChild(props));
  // Existing products converted to a pack usually get existing products linked as children instead
  const [autoCreateUnitChild, setAutoCreateUnitChild] = useState(!props._id);
  const [selectedLocations, setSelectedLocations] = useState(props.locations || []);
  const [allLocations, setAllLocations] = useState([]);
  const [showOnWeb, setShowOnWeb] = useState(props.showOnWeb || false);

  const [isPromotion, setIsPromotion] = useState(props.isPromotion || false);
  const [promoPrice, setPromoPrice] = useState(props.promoPrice ?? "");
  const [promoStart, setPromoStart] = useState(
    toDateInputValue(props.promoStart)
  );
  const [promoEnd, setPromoEnd] = useState(toDateInputValue(props.promoEnd));
  const [expiryDate, setExpiryDate] = useState(toDateInputValue(props.expiryDate || ""));

  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const { start, onFetch, onProcess, complete } = useProgress();
  const {
    progress: saveProgress,
    start: startSave,
    onFetch: onSaveFetch,
    onProcess: onSaveProcess,
    complete: completeSave,
    reset: resetSave,
  } = useProgress();
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [goToProducts, setGoToProducts] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [descriptionEdited, setDescriptionEdited] = useState(false);

  // Sync props to state if they change
  useEffect(() => {
    setName(props.name || "");
    setDescription(props.description || "");
    setCostPrice(props.costPrice ?? "");
    setApplyTax(props._id ? Number(props.taxRate) > 0 : true);
    setSalePriceIncTax(props.salePriceIncTax ?? "");
    setMargin(props.margin ?? "");
    setBarcode(props.barcode || "");
    setQuantity(props.quantity ?? "");
    setQuantityEdited(false);
    setCategory(props.category || "Top Level");
    setImages(props.images || []);
    setProperties(props.properties || []);
    setMinStock(props.minStock ?? "");
    setSelectedVendors(normalizeVendorIds(props.vendors));
    setPackType(props.packType || "unit");
    setQtyPerPack(props.qtyPerPack ?? 1);
    setChildSalePrice(props.childSalePrice ?? "");
    setIsLinkedChild(isDerivedChild(props));
    setAutoCreateUnitChild(!props._id);
    setSelectedLocations(props.locations || []);
    setShowOnWeb(props.showOnWeb || false);
    setIsPromotion(props.isPromotion || false);
    setPromoPrice(props.promoPrice ?? "");
    setPromoStart(toDateInputValue(props.promoStart));
    setPromoEnd(toDateInputValue(props.promoEnd));
    setExpiryDate(toDateInputValue(props.expiryDate || ""));
    setDescriptionEdited(Boolean(props.description));
  }, [props]);

  // Load categories with caching
  useEffect(() => {
    start();
    onFetch();
    getCachedCategories()
      .then((data) => {
        onProcess();
        setCategories(Array.isArray(data) ? data : []);
      })
      .finally(() => {
        setCategoriesLoading(false);
        complete();
      });
  }, [start, onFetch, onProcess, complete]);

  // Load vendors
  useEffect(() => {
    axios.get("/api/vendors?active=true&includePettyCash=true")
      .then((res) => {
        const list = res.data?.vendors || res.data;
        setAllVendors(Array.isArray(list) ? list : []);
      })
      .catch(() => {})
      .finally(() => setVendorsLoading(false));
  }, []);

  // Load locations
  useEffect(() => {
    axios.get("/api/setup/get")
      .then((res) => {
        const store = res.data?.store;
        if (store?.locations && Array.isArray(store.locations)) {
          setAllLocations(store.locations.map((loc) => loc.name || loc));
        }
      })
      .catch(() => {});
  }, []);

  // Reset promo fields if unchecked
  useEffect(() => {
    if (!isPromotion) {
      setPromoPrice("");
      setPromoStart("");
      setPromoEnd("");
    }
  }, [isPromotion]);

  // --- Effective Price ---
  const effectivePrice =
    isPromotion && promoPrice ? promoPrice : salePriceIncTax;

  // --- Pricing logic: cost → margin → price before VAT → VAT → sale price ---
  const taxRate = applyTax ? VAT_RATE : 0;

  function handleCostPriceChange(value) {
    setCostPrice(value);
    if (fieldErrors.costPrice) {
      setFieldErrors((prev) => ({ ...prev, costPrice: null }));
    }
    // Keep the sale price and re-derive the margin; with no sale price yet, price from the margin
    if (Number(salePriceIncTax) > 0 || margin === "") {
      setMargin(calculateMarginPercent(value, salePriceIncTax, taxRate).toFixed(2));
    } else {
      setSalePriceIncTax(calculateSalePriceIncTax(value, margin, taxRate).toFixed(2));
    }
  }

  function handleMarginChange(value) {
    setMargin(value);
    if (value !== "") {
      setSalePriceIncTax(calculateSalePriceIncTax(costPrice, value, taxRate).toFixed(2));
    }
  }

  function handleSalePriceChange(value) {
    setSalePriceIncTax(value);
    setMargin(calculateMarginPercent(costPrice, value, taxRate).toFixed(2));
  }

  function handleApplyTaxChange(checked) {
    setApplyTax(checked);
    setMargin(calculateMarginPercent(costPrice, salePriceIncTax, checked ? VAT_RATE : 0).toFixed(2));
  }

  const priceBreakdown = getPriceBreakdown(costPrice, salePriceIncTax, taxRate);

  const handleRelationsChange = useCallback((relations) => {
    const current = relations?.product;
    if (!current) return;
    const linkedAsChild = isDerivedChild(current) && Boolean(relations.parent);
    setIsLinkedChild(linkedAsChild);
    if (linkedAsChild) {
      setPackType("unit");
      setQtyPerPack(1);
    }
    // Linking can move stock into this pack, and unlinking resets a child's stock
    setQuantity((prev) => (quantityEdited ? prev : current.quantity ?? ""));
  }, [quantityEdited]);

  // --- Promotion impact ---
  function handlePromotionToggle(enabled) {
    setIsPromotion(enabled);
    if (enabled && !promoStart) setPromoStart(todayInputValue());
  }

  const promoPriceNumber = Number(promoPrice) || 0;
  const salePriceNumber = Number(salePriceIncTax) || 0;
  const promoBreakdown =
    isPromotion && promoPriceNumber > 0 ? getPriceBreakdown(costPrice, promoPriceNumber, taxRate) : null;
  const promoDiscountPercent =
    promoBreakdown && salePriceNumber > 0 ? ((salePriceNumber - promoPriceNumber) / salePriceNumber) * 100 : null;
  const promoDays =
    promoStart && promoEnd ? Math.round((new Date(promoEnd) - new Date(promoStart)) / DAY_MS) : null;
  const promoIssues = [];
  if (isPromotion) {
    if (!promoPriceNumber || !promoStart || !promoEnd) {
      promoIssues.push({ tone: "info", text: "Promo price, start date and end date are all required." });
    }
    if (promoPriceNumber > 0 && salePriceNumber > 0 && promoPriceNumber >= salePriceNumber) {
      promoIssues.push({
        tone: "warning",
        text: `Promo price should be lower than the sale price (${formatCurrency(salePriceNumber)}).`,
      });
    }
    if (promoBreakdown && promoBreakdown.marginAmount < 0) {
      promoIssues.push({
        tone: "danger",
        text: `Below cost: you lose ${formatCurrency(-promoBreakdown.marginAmount)} on every sale.`,
      });
    }
    if (promoDays !== null && promoDays <= 0) {
      promoIssues.push({ tone: "danger", text: "End date must be after the start date." });
    }
  }

  // --- Save product ---
  async function saveProduct(e) {
    e.preventDefault();
    if (isSaving) return;
    setErrorMessage("");
    setFieldErrors({});

    const nextErrors = {};
    if (!String(name || "").trim()) nextErrors.name = "Name is required.";
    if (!String(description || "").trim()) {
      nextErrors.description = "Description is required.";
    }
    if (costPrice === "" || costPrice === null || costPrice === undefined) {
      nextErrors.costPrice = "Cost price is required.";
    }
    if (!String(category || "").trim()) {
      nextErrors.category = "Category is required.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setErrorMessage("Please fill the required fields highlighted in red.");
      return;
    }

    const data = {
      name,
      description,
      costPrice,
      taxRate,
      salePriceIncTax,
      margin,
      barcode,
      category,
      images,
      properties,
      minStock: minStock === "" ? undefined : Number(minStock),
      // Only send qty when it was typed here, so a stale value never overwrites stock changed by sales
      quantity: quantityEdited && quantity !== "" ? Number(quantity) : undefined,
      expiryDate,
      isPromotion,
      promoPrice: isPromotion ? promoPrice : "",
      promoStart: isPromotion ? promoStart : "",
      promoEnd: isPromotion ? promoEnd : "",
      effectivePrice, // ✅ enforce effective price
      vendors: selectedVendors,
      locations: selectedLocations,
      packType,
      qtyPerPack: packType === "pack" ? Number(qtyPerPack) || 1 : 1,
      childSalePrice: packType === "pack" ? Number(childSalePrice) || 0 : undefined,
      autoCreateUnitChild: packType === "pack" ? autoCreateUnitChild : undefined,
      showOnWeb,
    };

    try {
      setIsSaving(true);
      startSave();
      onSaveFetch();

      let savedId = props._id || null;
      if (props._id) {
        const res = await axios.put("/api/products", { ...data, _id: props._id });
        savedId = res?.data?.data?._id || props._id;
        setSuccessMessage("Product updated successfully!");
      } else {
        const res = await axios.post("/api/products", data);
        savedId = res?.data?.data?._id || null;
        setSuccessMessage("Product added successfully!");
      }
      onSaveProcess();

      await Promise.allSettled([
        clearCache("products_cache"),
        clearCache("stock_products_cache"),
      ]);

      if (typeof window !== "undefined") {
        sessionStorage.setItem("products:refresh", "1");
        if (savedId) sessionStorage.setItem("products:highlight", String(savedId));
      }
      completeSave();
      setGoToProducts(true);
    } catch (err) {
      console.error(err);
      completeSave();
      if (!err?.response) {
        setErrorMessage("Could not save product. Check your network and try again.");
      } else {
        const apiMessage =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          "Failed to save product. Please try again.";
        setErrorMessage(apiMessage);
      }
    } finally {
      setTimeout(() => {
        resetSave();
      }, 250);
      setIsSaving(false);
    }
  }

  useEffect(() => {
    if (!goToProducts) return;

    if (typeof window !== "undefined" && returnTo) {
      const pendingVendorProduct = {
        rowIndex: Number.isInteger(returnRow) && returnRow >= 0 ? returnRow : 0,
        product: {
          _id: String(sessionStorage.getItem("products:highlight") || ""),
          name,
          packType,
          qtyPerPack: packType === "pack" ? Number(qtyPerPack) || 1 : 1,
          price: Number(costPrice) || 0,
        },
      };

      sessionStorage.setItem(
        "vendors:pendingProduct",
        JSON.stringify(pendingVendorProduct)
      );
      router.push(returnTo);
      return;
    }

    router.push("/manage/products");
  }, [goToProducts, router, returnTo, returnRow, name, packType, qtyPerPack, costPrice]);

  const handleCancel = () => {
    if (typeof window !== "undefined" && props._id) {
      sessionStorage.setItem("products:highlight", String(props._id));
    }

    router.push("/manage/products");
  };

  function generateBarcode() {
    const base = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const newCode = base.slice(-13);
    setBarcode((prev) => prev ? `${prev}, ${newCode}` : newCode);
  }

  async function handleImageUpload(e) {
    const files = e.target.files;
    if (!files?.length) return;
    setIsUploading(true);
    const formData = new FormData();
    for (const f of files) formData.append("file", f);
    const previews = Array.from(files).map((f) => ({
      full: URL.createObjectURL(f),
      thumb: URL.createObjectURL(f),
      isTemp: true,
    }));
    setImages((prev) => [...prev, ...previews]);
    try {
      const res = await axios.post("/api/upload", formData);
      const uploaded = res.data?.links || [];
      setImages((prev) => [
        ...prev.filter((img) => !img.isTemp),
        ...uploaded,
      ]);
    } catch {
      setImages((prev) => prev.filter((img) => !img.isTemp));
    } finally {
      setIsUploading(false);
    }
  }

  const isPack = !isLinkedChild && packType === "pack" && Number(qtyPerPack) > 1;
  const stockSummary = isLinkedChild
    ? "Taken from parent pack"
    : quantity === "" || quantity === null
    ? "—"
    : isPack
    ? `${formatQty(quantity)} packs · ${formatQty(Number(quantity) * Number(qtyPerPack))} units`
    : formatQty(quantity);

  return (
    <form
      onSubmit={saveProduct}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target?.tagName !== "TEXTAREA") {
          e.preventDefault();
        }
      }}
      className="page-container !px-0 !pt-0 !pb-24 lg:!pb-8 lg:!pt-16"
    >
      {isSaving && (
        <Loader
          fullScreen
          text="Saving product..."
          progress={saveProgress}
        />
      )}

      {/* Action bar: under the top nav on desktop, pinned to the bottom on smaller screens */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 shadow-sm backdrop-blur md:left-20 lg:bottom-auto lg:top-16 lg:border-b lg:border-t-0">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2.5 pr-24 md:px-6 md:pr-6">
          <div className="min-w-0 flex-1">
            <p className="hidden truncate text-sm font-semibold text-gray-900 lg:block">
              {props._id ? "Edit product" : "New product"}
              {name ? ` · ${name}` : ""}
            </p>
            <p className={`truncate text-xs ${errorMessage ? "font-medium text-red-600" : "text-gray-500"}`}>
              {errorMessage ||
                successMessage ||
                `Sale ${formatCurrency(priceBreakdown.sale)} · Margin ${priceBreakdown.marginPercent.toFixed(2)}%`}
            </p>
          </div>
          <button type="button" onClick={handleCancel} className="btn-action-secondary !py-2">
            Cancel
          </button>
          <button
            type="submit"
            className={`btn-action-primary !py-2 ${isSaving || isUploading ? "opacity-50 cursor-not-allowed" : ""}`}
            disabled={isSaving || isUploading}
          >
            {isSaving ? `Saving… ${Math.round(saveProgress)}%` : "Save product"}
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-7xl py-4 md:py-6">
        <div className="mb-5">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
            {props._id ? "Edit Product" : "Add New Product"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {props._id ? name || "Update this product's details" : "Fill in the details, then save."}
          </p>
        </div>

        {errorMessage && (
          <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-3 lg:grid-rows-[auto_1fr] lg:items-start">
          {/* Main column (top) */}
          <div className="space-y-5 lg:col-span-2">
            <Card title="Basic information">
              <div className="grid gap-4 md:grid-cols-2">
                <InputField
                  label="Name"
                  value={name}
                  setValue={(v) => {
                    setName(v);
                    if (!descriptionEdited || !String(description || "").trim()) {
                      setDescription(v);
                    }
                    if (fieldErrors.name) {
                      setFieldErrors((prev) => ({ ...prev, name: null }));
                    }
                  }}
                  required
                  error={fieldErrors.name}
                />
                <div className="form-group">
                  <label className="form-label">Barcode</label>
                  <div className="flex gap-2">
                    <input
                      name="barcode"
                      type="text"
                      className="form-input"
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      placeholder="Scan or type; separate several with commas"
                    />
                    <button
                      type="button"
                      onClick={generateBarcode}
                      className="btn-action-secondary whitespace-nowrap"
                    >
                      <FontAwesomeIcon icon={faBarcode} className="mr-2" />
                      Generate
                    </button>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <InputField
                    label="Description"
                    value={description}
                    setValue={(v) => {
                      setDescription(v);
                      setDescriptionEdited(true);
                      if (fieldErrors.description) {
                        setFieldErrors((prev) => ({ ...prev, description: null }));
                      }
                    }}
                    textarea
                    required
                    error={fieldErrors.description}
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* Side panel */}
          <aside className="space-y-5 lg:col-start-3 lg:row-span-2 lg:row-start-1">
            <Card title="Summary" className="hidden lg:block">
              <p className="text-2xl font-bold tabular-nums text-gray-900">{formatCurrency(priceBreakdown.sale)}</p>
              <p className="text-xs text-gray-500">{applyTax ? `Includes ${VAT_RATE}% VAT` : "No VAT"}</p>
              <dl className="mt-4 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-gray-100 pt-4 text-sm">
                <dt className="text-gray-500">Margin</dt>
                <dd className={priceBreakdown.marginAmount < 0 ? "font-medium text-red-600" : "font-medium text-gray-900"}>
                  {priceBreakdown.marginPercent.toFixed(2)}% ({formatCurrency(priceBreakdown.marginAmount)})
                </dd>
                <dt className="text-gray-500">Profit margin</dt>
                <dd className={priceBreakdown.marginAmount < 0 ? "font-medium text-red-600" : "font-medium text-gray-900"}>
                  {priceBreakdown.profitMarginPercent.toFixed(2)}% of the sale
                </dd>
                <dt className="text-gray-500">Add-ons</dt>
                <dd className="font-medium text-gray-900">{formatCurrency(priceBreakdown.totalAddOns)}</dd>
                <dt className="text-gray-500">Stock</dt>
                <dd className="font-medium text-gray-900">{stockSummary}</dd>
                <dt className="text-gray-500">Promotion</dt>
                <dd className="font-medium text-gray-900">
                  {isPromotion && promoPriceNumber > 0
                    ? `${formatCurrency(promoPriceNumber)}${promoEnd ? ` until ${formatShortDate(promoEnd)}` : ""}`
                    : "Off"}
                </dd>
                <dt className="text-gray-500">Website</dt>
                <dd className="font-medium text-gray-900">{showOnWeb ? "Visible" : "Hidden"}</dd>
              </dl>
            </Card>

            <Card title="Organise">
              <div className="space-y-4">
                <div className="form-group">
                  <label className="form-label">
                    Category <span className="text-red-500">*</span>
                  </label>
                  <select
                    className={`form-select ${
                      fieldErrors.category ? "border-red-500 ring-1 ring-red-200" : ""
                    }`}
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      if (fieldErrors.category) {
                        setFieldErrors((prev) => ({ ...prev, category: null }));
                      }
                    }}
                  >
                    {categoriesLoading && (
                      <option value="" disabled>
                        Loading categories...
                      </option>
                    )}
                    <option value="Top Level">Top Level</option>
                    {categories.map((cat) => (
                      <option key={cat._id} value={cat._id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.category && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.category}</p>
                  )}
                </div>

                <ChipPicker
                  label="Vendor(s)"
                  placeholder={vendorsLoading ? "Loading vendors..." : "— Add a vendor —"}
                  options={allVendors.map((v) => ({ value: v._id, label: v.companyName }))}
                  selected={selectedVendors}
                  onChange={setSelectedVendors}
                  hint="Multiple vendors can supply the same product."
                  chipClassName="bg-blue-100 text-blue-700"
                />

                <ChipPicker
                  label="Location(s)"
                  placeholder="— Add a location —"
                  options={allLocations.map((loc) => ({ value: loc, label: loc }))}
                  selected={selectedLocations}
                  onChange={setSelectedLocations}
                  hint="Store locations that sell this product."
                  chipClassName="bg-emerald-100 text-emerald-700"
                />

                <div className="flex items-start justify-between gap-3 border-t border-gray-100 pt-4">
                  <div>
                    <p className="text-sm font-medium text-gray-700">Show on website</p>
                    <p className="text-xs text-gray-500">Visible on the online storefront.</p>
                  </div>
                  <Toggle checked={showOnWeb} onChange={setShowOnWeb} label="Show on website" />
                </div>
              </div>
            </Card>

            <Card title="Images" description="The first image is the main one.">
              <div className="grid grid-cols-3 gap-2">
                <label className="flex aspect-square cursor-pointer items-center justify-center rounded-lg border-2 border-dashed bg-gray-50 p-1 text-center text-xs text-gray-500 hover:bg-gray-100">
                  + Upload
                  <input type="file" multiple onChange={handleImageUpload} className="hidden" />
                </label>
                {images.map((img, i) => (
                  <div key={i} className="relative aspect-square overflow-hidden rounded-lg border">
                    <img src={img.thumb || img.full} alt="Product" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label="Remove image"
                      className="absolute right-1 top-1 rounded bg-red-500 p-1 text-xs text-white"
                      onClick={() => setImages(images.filter((_, idx) => idx !== i))}
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </div>
                ))}
                {isUploading && (
                  <div className="flex aspect-square items-center justify-center">
                    <Loader />
                  </div>
                )}
              </div>
            </Card>
          </aside>

          {/* Main column (rest) */}
          <div className="space-y-5 lg:col-span-2 lg:col-start-1 lg:row-start-2">
            <Card
              title="Pricing"
              description="Enter the cost, then set either the margin or the sale price — the other updates itself."
            >
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  <InputField
                    label="Cost price"
                    name="costPrice"
                    type="number"
                    prefix="₦"
                    value={costPrice}
                    setValue={handleCostPriceChange}
                    required
                    error={fieldErrors.costPrice}
                  />
                  <InputField
                    label="Margin (on cost)"
                    name="margin"
                    type="number"
                    suffix="%"
                    value={margin}
                    setValue={handleMarginChange}
                  />
                  <InputField
                    label={applyTax ? `Sale price (inc. ${VAT_RATE}% VAT)` : "Sale price (no VAT)"}
                    name="salePrice"
                    type="number"
                    prefix="₦"
                    value={salePriceIncTax}
                    setValue={handleSalePriceChange}
                  />
                  <VatChoice applyTax={applyTax} onChange={handleApplyTaxChange} />
                  {props._id && (
                    <AIPriceSuggestion
                      productId={props._id}
                      currentPrice={salePriceIncTax}
                      onApplyPrice={(price) => handleSalePriceChange(String(price))}
                    />
                  )}
                </div>
                <PriceBuildUp breakdown={priceBreakdown} applyTax={applyTax} />
              </div>
            </Card>

            <Card title="Stock & packs">
              <div className="grid gap-4 sm:grid-cols-3">
                {isAdmin && (
                  <InputField
                    label={isPack ? "Qty (packs)" : "Qty"}
                    name="quantity"
                    type="number"
                    value={quantity}
                    setValue={(v) => {
                      setQuantity(v);
                      setQuantityEdited(true);
                    }}
                    disabled={isLinkedChild}
                    hint={isLinkedChild ? "Comes from the parent pack." : ""}
                  />
                )}
                <InputField
                  label="Min stock"
                  name="minStock"
                  type="number"
                  value={minStock}
                  setValue={setMinStock}
                />
                <InputField
                  label="Expiry date"
                  type="date"
                  value={expiryDate}
                  setValue={setExpiryDate}
                />
              </div>

              <div className="mt-5 border-t border-gray-100 pt-5">
                <h3 className="text-sm font-semibold text-gray-800">Pack & child products</h3>
                {isLinkedChild ? (
                  <p className="mt-1 text-sm text-gray-600">
                    This product is a child of a pack. It has no stock of its own — see the parent below.
                  </p>
                ) : (
                  <div className="mt-3 grid gap-4 sm:grid-cols-3">
                    <div className="form-group">
                      <label className="form-label">Pack type</label>
                      <select
                        className="form-select"
                        value={packType}
                        onChange={(e) => setPackType(e.target.value)}
                      >
                        <option value="unit">Unit (single item)</option>
                        <option value="pack">Pack (multiple units)</option>
                      </select>
                    </div>
                    {packType === "pack" && (
                      <>
                        <InputField
                          label="Qty per pack"
                          type="number"
                          value={qtyPerPack}
                          setValue={setQtyPerPack}
                        />
                        <InputField
                          label="Auto unit child sale price"
                          type="number"
                          prefix="₦"
                          value={childSalePrice}
                          setValue={setChildSalePrice}
                        />
                      </>
                    )}
                  </div>
                )}
                {isPack && (
                  <div className="mt-3 space-y-2 rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm text-purple-700">
                    <p>
                      <strong>Pack of {qtyPerPack}:</strong> cost per unit{" "}
                      {formatCurrency((Number(costPrice) || 0) / (Number(qtyPerPack) || 1))}
                      {childSalePrice ? ` · auto unit child sale price ${formatCurrency(Number(childSalePrice))}` : ""}
                    </p>
                    {!(props._id && props.packType === "pack" && Number(props.qtyPerPack) > 1) && (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={autoCreateUnitChild}
                          onChange={(e) => setAutoCreateUnitChild(e.target.checked)}
                        />
                        <span>
                          Auto-create a new &quot;{name || "Product"} (Unit)&quot; child product
                          {props._id ? " (leave unticked to link existing products below instead)" : ""}
                        </span>
                      </label>
                    )}
                  </div>
                )}
                {props._id ? (
                  <ProductPackLinks productId={props._id} onRelationsChange={handleRelationsChange} />
                ) : (
                  <p className="mt-3 text-xs text-gray-500">
                    Save this product first to link existing products to it as children, or to link it to a parent pack.
                  </p>
                )}
              </div>
            </Card>

            <Card
              title="Promotion"
              description={isPromotion ? "A temporary price for a set period." : "No promotion is running."}
              action={<Toggle checked={isPromotion} onChange={handlePromotionToggle} label="Promotion" showState />}
            >
              {isPromotion && (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <InputField
                      label="Promo price"
                      type="number"
                      prefix="₦"
                      value={promoPrice}
                      setValue={setPromoPrice}
                      required
                    />
                    <InputField label="Starts" type="date" value={promoStart} setValue={setPromoStart} required />
                    <InputField label="Ends" type="date" value={promoEnd} setValue={setPromoEnd} required />
                  </div>

                  {(promoBreakdown || promoDays > 0) && (
                    <div className="flex flex-wrap gap-2 text-sm">
                      {promoDiscountPercent !== null && promoDiscountPercent > 0 && (
                        <ImpactChip>
                          {promoDiscountPercent.toFixed(1)}% off {formatCurrency(salePriceNumber)}
                        </ImpactChip>
                      )}
                      {promoBreakdown && (
                        <ImpactChip tone={promoBreakdown.marginAmount < 0 ? "danger" : "neutral"}>
                          Profit {formatCurrency(promoBreakdown.marginAmount)} ({promoBreakdown.marginPercent.toFixed(2)}% on
                          cost)
                        </ImpactChip>
                      )}
                      {promoDays > 0 && (
                        <ImpactChip>
                          Runs {promoDays} day{promoDays === 1 ? "" : "s"} · {formatShortDate(promoStart)} →{" "}
                          {formatShortDate(promoEnd)}
                        </ImpactChip>
                      )}
                    </div>
                  )}

                  {promoIssues.map((issue) => (
                    <p
                      key={issue.text}
                      className={`rounded-md px-3 py-2 text-sm ${
                        issue.tone === "danger"
                          ? "bg-red-50 text-red-700"
                          : issue.tone === "warning"
                          ? "bg-amber-50 text-amber-800"
                          : "bg-gray-50 text-gray-600"
                      }`}
                    >
                      {issue.tone === "info" ? "" : "⚠ "}
                      {issue.text}
                    </p>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Properties" description="Extra details such as size, colour or flavour.">
              <div className="space-y-2">
                {properties.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      className="form-input"
                      value={p.propName}
                      onChange={(e) => {
                        const newProps = [...properties];
                        newProps[i].propName = e.target.value;
                        setProperties(newProps);
                      }}
                      placeholder="Property name"
                    />
                    <input
                      className="form-input"
                      value={p.propValue}
                      onChange={(e) => {
                        const newProps = [...properties];
                        newProps[i].propValue = e.target.value;
                        setProperties(newProps);
                      }}
                      placeholder="Property value"
                    />
                    <button
                      type="button"
                      aria-label="Remove property"
                      className="px-2 text-red-500 hover:text-red-700"
                      onClick={() =>
                        setProperties(properties.filter((_, idx) => idx !== i))
                      }
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setProperties([...properties, { propName: "", propValue: "" }])
                }
                className="btn-action-secondary mt-3"
              >
                + Add property
              </button>
            </Card>
          </div>
        </div>
      </div>
    </form>
  );
}

function PriceBuildUp({ breakdown, applyTax }) {
  const { cost, marginAmount, marginPercent, profitMarginPercent, saleExTax, vatAmount, sale, totalAddOns, totalAddOnsPercent } =
    breakdown;
  const rows = [
    { label: "Cost price", value: cost },
    { label: `+ Margin (${marginPercent.toFixed(2)}%)`, value: marginAmount, loss: marginAmount < 0 },
    { label: "= Price before VAT", value: saleExTax, divider: true },
    { label: applyTax ? `+ VAT (${VAT_RATE}%)` : "+ VAT (not applied)", value: vatAmount },
    { label: "= Sale price", value: sale, divider: true, strong: true },
  ];

  return (
    <div className="self-start rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
      <h3 className="mb-3 font-semibold text-gray-800">Price build-up</h3>
      <dl className="grid grid-cols-[max-content_max-content] items-baseline gap-x-5 gap-y-1.5">
        {rows.map((row) => (
          <Fragment key={row.label}>
            {row.divider && <div className="col-span-2 border-t border-gray-200" />}
            <dt className={row.strong ? "font-semibold text-gray-900" : "text-gray-600"}>{row.label}</dt>
            <dd
              className={`text-right tabular-nums ${row.strong ? "font-semibold" : "font-medium"} ${
                row.loss ? "text-red-600" : "text-gray-900"
              }`}
            >
              {formatCurrency(row.value)}
            </dd>
          </Fragment>
        ))}
      </dl>
      <div className="mt-4 inline-flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md bg-blue-50 px-3 py-2 text-blue-900">
        <span className="font-semibold">Total add-ons</span>
        <span className={`font-bold tabular-nums ${totalAddOns < 0 ? "text-red-600" : ""}`}>
          {formatCurrency(totalAddOns)}
        </span>
        <span className="text-xs">{totalAddOnsPercent.toFixed(2)}% of cost · margin + VAT</span>
      </div>

      {/* The same product reads differently as an add-on to cost and as a share of the sale */}
      <dl className="mt-3 grid grid-cols-[max-content_max-content] items-baseline gap-x-5 gap-y-1 text-xs text-gray-600">
        <dt>Margin on cost</dt>
        <dd className="text-right font-medium tabular-nums text-gray-900">{marginPercent.toFixed(2)}%</dd>
        <dt>VAT</dt>
        <dd className="text-right font-medium tabular-nums text-gray-900">{applyTax ? `${VAT_RATE}%` : "None"}</dd>
        <dt>Profit margin (of the sale)</dt>
        <dd className="text-right font-medium tabular-nums text-gray-900">{profitMarginPercent.toFixed(2)}%</dd>
      </dl>
    </div>
  );
}

function VatChoice({ applyTax, onChange }) {
  const choices = [
    { value: true, label: `${VAT_RATE}% VAT` },
    { value: false, label: "No VAT" },
  ];
  return (
    <div className="form-group">
      <span className="form-label">VAT</span>
      <div role="radiogroup" aria-label="VAT" className="inline-flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
        {choices.map((choice) => {
          const active = applyTax === choice.value;
          return (
            <button
              key={choice.label}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(choice.value)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-white text-blue-700 shadow-sm ring-1 ring-gray-200" : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ImpactChip({ tone = "neutral", children }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
        tone === "danger" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-800"
      }`}
    >
      {children}
    </span>
  );
}

function ChipPicker({ label, placeholder, options, selected, onChange, hint, chipClassName }) {
  const labelFor = (value) => options.find((option) => option.value === value)?.label || value;
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <select
        className="form-select"
        value=""
        onChange={(e) => {
          const value = e.target.value;
          if (value && !selected.includes(value)) onChange([...selected, value]);
        }}
      >
        <option value="">{placeholder}</option>
        {options
          .filter((option) => !selected.includes(option.value))
          .map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
      </select>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {selected.map((value) => (
            <span
              key={value}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${chipClassName}`}
            >
              {labelFor(value)}
              <button
                type="button"
                aria-label={`Remove ${labelFor(value)}`}
                onClick={() => onChange(selected.filter((item) => item !== value))}
                className="transition-colors hover:text-red-500"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function Toggle({ checked, onChange, label, showState = false }) {
  return (
    <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium text-gray-700">
      {showState && <span>{checked ? "On" : "Off"}</span>}
      <input
        type="checkbox"
        className="peer sr-only"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="relative h-6 w-11 rounded-full bg-gray-300 transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300" />
    </label>
  );
}

function Card({ title, description, action, className = "", children }) {
  return (
    <section className={`content-card ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function InputField({
  label,
  value,
  setValue,
  name,
  type = "text",
  textarea,
  required,
  error,
  disabled,
  hint,
  prefix,
  suffix,
}) {
  const errorClass = error ? "border-red-500 ring-1 ring-red-200" : "";
  return (
    <div className="form-group">
      <label className="form-label">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {textarea ? (
        <textarea
          name={name}
          rows={3}
          className={`form-input min-h-[80px] ${errorClass}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required={required}
        />
      ) : (
        <div className="relative">
          {prefix && (
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-gray-500">
              {prefix}
            </span>
          )}
          <input
            name={name}
            type={type}
            className={`form-input ${prefix ? "!pl-8" : ""} ${suffix ? "!pr-9" : ""} ${errorClass} ${
              disabled ? "bg-gray-100 text-gray-500 cursor-not-allowed" : ""
            }`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onWheel={type === "number" ? (e) => e.currentTarget.blur() : undefined}
            required={required}
            disabled={disabled}
          />
          {suffix && (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-gray-500">
              {suffix}
            </span>
          )}
        </div>
      )}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
