import axios from "axios";
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
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
  calculateProfit,
  calculateSalePriceIncTax,
} from "@/lib/pricing";

function toDateInputValue(v) {
  if (!v) return "";
  try {
    const s = typeof v === "string" ? v : new Date(v).toISOString();
    return s.slice(0, 10);
  } catch {
    return "";
  }
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

const STANDARD_PRODUCT_TYPE = "standard";
const ROOM_PRODUCT_TYPE = "room";

function formatRoomBookingDate(value) {
  if (!value) return "Not set";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not set";
  return parsed.toLocaleDateString();
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
  const [taxRate, setTaxRate] = useState(
    props.taxRate != null ? String(props.taxRate) : "4.5"
  );
  const [salePriceIncTax, setSalePriceIncTax] = useState(
    props.salePriceIncTax ?? ""
  );
  const [margin, setMargin] = useState(props.margin ?? "");
  const [barcode, setBarcode] = useState(props.barcode || "");
  const [quantity, setQuantity] = useState(props.quantity ?? "");
  const [category, setCategory] = useState(props.category || "Top Level");
  const [productType, setProductType] = useState(props.productType || STANDARD_PRODUCT_TYPE);
  const [roomStatus, setRoomStatus] = useState(props.roomStatus || "available");
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
  const [selectedLocations, setSelectedLocations] = useState(props.locations || []);
  const [allLocations, setAllLocations] = useState([]);

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
  const [applyTax, setApplyTax] = useState(true);
  const [fieldErrors, setFieldErrors] = useState({});
  const [descriptionEdited, setDescriptionEdited] = useState(false);

  // Sync props to state if they change
  useEffect(() => {
    setName(props.name || "");
    setDescription(props.description || "");
    setCostPrice(props.costPrice ?? "");
    setTaxRate(props.taxRate != null ? String(props.taxRate) : "4.5");
    setSalePriceIncTax(props.salePriceIncTax ?? "");
    setMargin(props.margin ?? "");
    setBarcode(props.barcode || "");
    setQuantity(props.quantity ?? "");
    setCategory(props.category || "Top Level");
    setProductType(props.productType || STANDARD_PRODUCT_TYPE);
    setRoomStatus(props.roomStatus || "available");
    setImages(props.images || []);
    setProperties(props.properties || []);
    setMinStock(props.minStock ?? "");
    setSelectedVendors(normalizeVendorIds(props.vendors));
    setPackType(props.packType || "unit");
    setQtyPerPack(props.qtyPerPack ?? 1);
    setChildSalePrice(props.childSalePrice ?? "");
    setSelectedLocations(props.locations || []);
    setIsPromotion(props.isPromotion || false);
    setPromoPrice(props.promoPrice ?? "");
    setPromoStart(toDateInputValue(props.promoStart));
    setPromoEnd(toDateInputValue(props.promoEnd));
    setExpiryDate(toDateInputValue(props.expiryDate || ""));
    setDescriptionEdited(Boolean(props.description));
  }, [props]);

  useEffect(() => {
    if (productType !== ROOM_PRODUCT_TYPE) return;

    setQuantity(0);
    setMinStock(0);
    setPackType("unit");
    setQtyPerPack(1);
    setChildSalePrice("");
  }, [productType]);

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
    axios.get("/api/vendors?active=true")
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

  // --- Pricing logic ---
  useEffect(() => {
    const cp = Number(costPrice) || 0;
    const tr = Number(taxRate) || 0;
    const mg = Number(margin) || 0;
    const sp = Number(salePriceIncTax) || 0;

    if (document.activeElement?.name === "margin") {
      setSalePriceIncTax(
        calculateSalePriceIncTax(cp, mg, tr, applyTax).toFixed(2)
      );
    }

    if (document.activeElement?.name === "salePrice") {
      setMargin(calculateMarginPercent(cp, sp, tr, applyTax).toFixed(2));
    }

    if (["costPrice", "taxRate"].includes(document.activeElement?.name)) {
      setMargin(calculateMarginPercent(cp, sp, tr, applyTax).toFixed(2));
    }
  }, [costPrice, taxRate, margin, salePriceIncTax, applyTax]);

  // --- Profit calculator --- (uses effectivePrice)
  const { profit, margin: calcMargin } = (() => {
    const cp = Number(costPrice) || 0;
    const sp = Number(effectivePrice) || 0;
    if (sp === 0) return { profit: 0, margin: "0.00" };
    return {
      profit: calculateProfit(cp, sp, taxRate, applyTax).toFixed(2),
      margin: calculateMarginPercent(cp, sp, taxRate, applyTax).toFixed(2),
    };
  })();

  // --- Promo Margin & Warning ---
  const promoMargin = (() => {
    const sp = Number(salePriceIncTax) || 0;
    const pp = Number(promoPrice) || 0;
    if (pp === 0 || sp === 0) return 0;
    return (((sp - pp) / sp) * 100).toFixed(2);
  })();
  const promoWarning = Number(promoPrice) > Number(salePriceIncTax);
  const isRoomProduct = productType === ROOM_PRODUCT_TYPE;
  const currentRoomBooking = props.currentBooking || null;
  const hasCurrentRoomBooking = Boolean(
    currentRoomBooking &&
      (
        currentRoomBooking.guestName ||
        currentRoomBooking.checkInAt ||
        currentRoomBooking.checkOutAt ||
        currentRoomBooking.notes
      )
  );

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
      productType,
      roomStatus: isRoomProduct ? roomStatus : "available",
      images,
      properties,
      minStock: isRoomProduct ? 0 : (minStock === "" ? undefined : Number(minStock)),
      quantity: isRoomProduct ? 0 : (quantity === "" ? undefined : Number(quantity)),
      expiryDate,
      isPromotion,
      promoPrice: isPromotion ? promoPrice : "",
      promoStart: isPromotion ? promoStart : "",
      promoEnd: isPromotion ? promoEnd : "",
      effectivePrice, // ✅ enforce effective price
      vendors: selectedVendors,
      locations: selectedLocations,
      packType: isRoomProduct ? "unit" : packType,
      qtyPerPack: isRoomProduct ? 1 : (packType === "pack" ? Number(qtyPerPack) || 1 : 1),
      childSalePrice: isRoomProduct ? undefined : (packType === "pack" ? Number(childSalePrice) || 0 : undefined),
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

  return (
    <form
      onSubmit={saveProduct}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target?.tagName !== "TEXTAREA") {
          e.preventDefault();
        }
      }}
      className="page-container !p-0"
    >
      {isSaving && (
        <Loader
          fullScreen
          text="Saving product..."
          progress={saveProgress}
        />
      )}
      <div className="content-card">
      <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-6 text-gray-800">
        {props._id ? "Edit Product" : "Add New Product"}
      </h2>

      {/* Basic Info */}
      <Section title="Basic Information">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            error={fieldErrors.description}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Barcode</label>
          <div className="flex gap-2">
            <input
              name="barcode"
              type="text"
              className="form-input"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
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

        {/* Category Select */}
        <div className="form-group">
          <label className="form-label">
            Category
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

        {/* Vendor Selection */}
        <div className="form-group">
          <label className="form-label">Vendor(s)</label>
          <div className="space-y-2">
            <select
              className="form-select"
              value=""
              onChange={(e) => {
                const vendorId = e.target.value;
                if (vendorId && !selectedVendors.includes(vendorId)) {
                  setSelectedVendors((prev) => [...prev, vendorId]);
                }
              }}
            >
              <option value="">
                {vendorsLoading ? "Loading vendors..." : "— Select vendor to add —"}
              </option>
              {allVendors
                .filter((v) => !selectedVendors.includes(v._id))
                .map((v) => (
                  <option key={v._id} value={v._id}>
                    {v.companyName}
                  </option>
                ))}
            </select>
            {selectedVendors.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedVendors.map((vId) => {
                  const vendor = allVendors.find((v) => v._id === vId);
                  return (
                    <span
                      key={vId}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium"
                    >
                      {vendor?.companyName || vId}
                      <button
                        type="button"
                        onClick={() => setSelectedVendors((prev) => prev.filter((id) => id !== vId))}
                        className="hover:text-red-500 transition-colors"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-gray-400">Multiple vendors can supply the same product.</p>
          </div>
        </div>

        {/* Location Assignment */}
        <div className="form-group">
          <label className="form-label">Location(s)</label>
          <div className="space-y-2">
            <select
              className="form-select"
              value=""
              onChange={(e) => {
                const loc = e.target.value;
                if (loc && !selectedLocations.includes(loc)) {
                  setSelectedLocations((prev) => [...prev, loc]);
                }
              }}
            >
              <option value="">— Select location to add —</option>
              {allLocations
                .filter((loc) => !selectedLocations.includes(loc))
                .map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
            </select>
            {selectedLocations.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedLocations.map((loc) => (
                  <span
                    key={loc}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium"
                  >
                    {loc}
                    <button
                      type="button"
                      onClick={() => setSelectedLocations((prev) => prev.filter((l) => l !== loc))}
                      className="hover:text-red-500 transition-colors"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-400">Assign product to specific store locations.</p>
          </div>
        </div>
      </Section>

      <Section title="Product Type">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="form-group">
            <label className="form-label">Type</label>
            <select
              className="form-select"
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
            >
              <option value={STANDARD_PRODUCT_TYPE}>Standard Product</option>
              <option value={ROOM_PRODUCT_TYPE}>Room / Reservation</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Room products skip stock counting and open a booking flow in the sales point.
            </p>
          </div>

          {isRoomProduct && (
            <div className="form-group">
              <label className="form-label">Availability</label>
              <select
                className="form-select"
                value={roomStatus}
                onChange={(e) => setRoomStatus(e.target.value)}
              >
                <option value="available">Available</option>
                <option value="reserved">Reserved</option>
                <option value="occupied">Occupied</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Set the room back to available after checkout or cancellation.
              </p>
            </div>
          )}
        </div>

        {isRoomProduct && hasCurrentRoomBooking && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="font-semibold text-amber-950">Current booking</div>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <span className="font-medium">Guest:</span> {currentRoomBooking.guestName || "Not set"}
              </div>
              <div>
                <span className="font-medium">Phone:</span> {currentRoomBooking.guestPhone || "Not set"}
              </div>
              <div>
                <span className="font-medium">Check-in:</span> {formatRoomBookingDate(currentRoomBooking.checkInAt)}
              </div>
              <div>
                <span className="font-medium">Check-out:</span> {formatRoomBookingDate(currentRoomBooking.checkOutAt)}
              </div>
            </div>
            {currentRoomBooking.notes && (
              <div className="mt-2">
                <span className="font-medium">Notes:</span> {currentRoomBooking.notes}
              </div>
            )}
            {roomStatus === "available" && (
              <div className="mt-2 text-xs text-amber-700">
                Saving this room as available clears the current booking details.
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Pricing */}
      <Section title="Pricing">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          <InputField
            label="Cost Price (₦)"
            name="costPrice"
            type="number"
            value={costPrice}
            setValue={(v) => {
              setCostPrice(v);
              if (fieldErrors.costPrice) {
                setFieldErrors((prev) => ({ ...prev, costPrice: null }));
              }
            }}
            required
            error={fieldErrors.costPrice}
          />
          <div className="form-group">
            <label className="form-label">
              Tax Rate
            </label>
            <div className="flex items-center gap-2">
              <select
                name="taxRate"
                className="form-select flex-1"
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
                disabled={!applyTax}
              >
                <option value="4.5">4.5%</option>
                <option value="7.5">7.5%</option>
              </select>
              <label className="flex items-center gap-1 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={applyTax}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setApplyTax(checked);
                    const nextMargin = calculateMarginPercent(
                      costPrice,
                      salePriceIncTax,
                      taxRate,
                      checked
                    );
                    setMargin(nextMargin.toFixed(2));
                  }}
                />{" "}
                Apply
              </label>
            </div>
          </div>
          <InputField
            label="Margin %"
            name="margin"
            type="number"
            value={margin}
            setValue={setMargin}
          />
        </div>
        <InputField
          label="Sale Price (₦, inc. tax)"
          name="salePrice"
          type="number"
          value={salePriceIncTax}
          setValue={setSalePriceIncTax}
        />
        <InputField
          label="Expiry Date (optional)"
          type="date"
          value={expiryDate}
          setValue={setExpiryDate}
        />
        <div className="mt-4 p-4 bg-gray-50 border rounded-lg">
          <p className="text-sm text-gray-700">
            <span className="font-semibold">Profit:</span> {formatCurrency(Number(profit) || 0)}
          </p>
          <p className="text-sm text-gray-700">
            <span className="font-semibold">Margin:</span> {calcMargin}%
          </p>
        </div>
      </Section>

      {!isRoomProduct && (
        <>
          <Section title="Stock & Quantity">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
              <InputField
                label="Min Stock (optional)"
                name="minStock"
                type="number"
                value={minStock}
                setValue={setMinStock}
              />
              {isAdmin && (
                <InputField
                  label="Qty (optional)"
                  name="quantity"
                  type="number"
                  value={quantity}
                  setValue={setQuantity}
                />
              )}
            </div>
          </Section>

          {/* Pack / Child Product */}
          <Section title="Pack & Child Product">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
              <div className="form-group">
                <label className="form-label">Pack Type</label>
                <select
                  className="form-select"
                  value={packType}
                  onChange={(e) => setPackType(e.target.value)}
                >
                  <option value="unit">Unit (Single Item)</option>
                  <option value="pack">Pack (Multiple Units)</option>
                </select>
              </div>
              {packType === "pack" && (
                <>
                  <InputField
                    label="Qty Per Pack"
                    type="number"
                    value={qtyPerPack}
                    setValue={setQtyPerPack}
                  />
                  <InputField
                    label="Child Sale Price (₦)"
                    type="number"
                    value={childSalePrice}
                    setValue={setChildSalePrice}
                  />
                </>
              )}
            </div>
            {packType === "pack" && Number(qtyPerPack) > 1 && (
              <div className="mt-3 p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-700">
                <p>
                  <strong>Pack of {qtyPerPack}:</strong> Cost per unit = {formatCurrency((Number(costPrice) || 0) / (Number(qtyPerPack) || 1))}
                  {childSalePrice ? ` | Child sale price = ${formatCurrency(Number(childSalePrice))}` : ""}
                </p>
              </div>
            )}
          </Section>
        </>
      )}

      {/* Promotion */}
      <Section title="Promotion">
        <label className="flex items-center gap-2 mb-4">
          <input
            type="checkbox"
            checked={isPromotion}
            onChange={(e) => setIsPromotion(e.target.checked)}
          />
          <span className="text-gray-700">Enable Promotion</span>
        </label>
        {isPromotion && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            <div>
              <InputField
                label="Promo Price (₦)"
                type="number"
                value={promoPrice}
                setValue={setPromoPrice}
              />
              {promoPrice && (
                <p
                  className={`text-sm mt-1 ${
                    promoWarning ? "text-red-600" : "text-gray-700"
                  }`}
                >
                  Promo Margin: {promoMargin}%{" "}
                  {promoWarning && "- Warning: higher than sale price!"}
                </p>
              )}
            </div>
            <InputField
              label="Start Date"
              type="date"
              value={promoStart}
              setValue={setPromoStart}
            />
            <InputField
              label="End Date"
              type="date"
              value={promoEnd}
              setValue={setPromoEnd}
            />
          </div>
        )}
      </Section>

      {/* Properties */}
      <Section title="Properties">
        {properties.map((p, i) => (
          <div key={i} className="flex gap-3 mb-2">
            <input
              className="w-1/2 border rounded-md px-3 py-2"
              value={p.propName}
              onChange={(e) => {
                const newProps = [...properties];
                newProps[i].propName = e.target.value;
                setProperties(newProps);
              }}
              placeholder="Property name"
            />
            <input
              className="w-1/2 border rounded-md px-3 py-2"
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
              className="text-red-500"
              onClick={() =>
                setProperties(properties.filter((_, idx) => idx !== i))
              }
            >
              <FontAwesomeIcon icon={faTrash} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setProperties([...properties, { propName: "", propValue: "" }])
          }
          className="btn-action-primary"
        >
          + Add Property
        </button>
      </Section>

      {/* Images */}
      <Section title="Images">
        <div className="flex gap-2 md:gap-3 flex-wrap">
          <label className="w-24 h-24 md:w-28 md:h-28 flex items-center justify-center border-2 border-dashed rounded-md cursor-pointer bg-gray-50 text-gray-400 hover:bg-gray-100 text-xs md:text-sm text-center p-1">
            + Upload
            <input
              type="file"
              multiple
              onChange={async (e) => {
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
              }}
              className="hidden"
            />
          </label>

          {images.map((img, i) => (
            <div
              key={i}
              className="relative w-24 h-24 md:w-28 md:h-28 rounded-md overflow-hidden border"
            >
              <img
                src={img.thumb || img.full}
                alt="Product"
                className="object-cover w-full h-full"
              />
              <button
                type="button"
                className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded"
                onClick={() => setImages(images.filter((_, idx) => idx !== i))}
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
            </div>
          ))}

          {isUploading && (
            <div className="w-24 h-24 md:w-28 md:h-28 flex items-center justify-center">
              <Loader />
            </div>
          )}
        </div>
      </Section>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row justify-end gap-3 mt-6 pt-6 border-t border-gray-200">
        <button
          type="button"
          onClick={handleCancel}
          className="btn-action-secondary w-full sm:w-auto"
        >
          Cancel
        </button>
        <button
          type="submit"
          className={`btn-action-primary w-full sm:w-auto ${
            isSaving || isUploading ? "opacity-50 cursor-not-allowed" : ""
          }`}
          disabled={isSaving || isUploading}
        >
          {isSaving ? `Saving... ${Math.round(saveProgress)}%` : "Save Product"}
        </button>
      </div>

      {errorMessage && <p className="text-red-600 mt-4">{errorMessage}</p>}
      {successMessage && (
        <p className="text-green-600 mt-4">{successMessage}</p>
      )}
      </div>
    </form>
  );
}

// InputField & Section
function InputField({
  label,
  value,
  setValue,
  name,
  type = "text",
  textarea,
  required,
  error,
}) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      {textarea ? (
        <textarea
          name={name}
          className={`form-input min-h-[80px] ${
            error ? "border-red-500 ring-1 ring-red-200" : ""
          }`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required={required}
        />
      ) : (
        <input
          name={name}
          type={type}
          className={`form-input ${error ? "border-red-500 ring-1 ring-red-200" : ""}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onWheel={type === "number" ? (e) => e.currentTarget.blur() : undefined}
          required={required}
        />
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-6 pb-6 border-b border-gray-100 last:border-b-0">
      <h3 className="text-lg sm:text-xl font-semibold text-gray-800 mb-4">
        {title}
      </h3>
      {children}
    </div>
  );
}
