import { model, Schema, models } from "mongoose";

const ProductSchema = new Schema(
  {
    /* =====================
       BASIC INFO
    ===================== */
    name: { type: String, required: true },
    description: { type: String, required: true },

    costPrice: { type: Number, required: true },
    taxRate: { type: Number, default: 0 },
    salePriceIncTax: { type: Number, required: true },
    margin: { type: Number, default: 0 },

    barcode: { type: String },
    category: { type: String, default: "Top Level" },

    images: [
      {
        full: { type: String, required: true },
        thumb: { type: String, required: true },
      },
    ],

    properties: [{ type: Object }],

    /* =====================
       STOCK CONTROL
    ===================== */
    quantity: { type: Number, default: 0 },
    isStockManaged: { type: Boolean, default: true },
    minStock: { type: Number, default: 0 },
    maxStock: { type: Number, default: 0 },

    /* =====================
       EXPIRY MANAGEMENT
    ===================== */
    expiryDate: { type: Date }, // optional
    isExpired: { type: Boolean, default: false },

    /* =====================
       PROMOTIONS
    ===================== */
    isPromotion: { type: Boolean, default: false },
    promoPrice: { type: Number },
    promoStart: { type: Date },
    promoEnd: { type: Date },

    /* =====================
       PROMOTION PERFORMANCE
    ===================== */
    promoStats: {
      views: { type: Number, default: 0 },
      salesQty: { type: Number, default: 0 },
      salesValue: { type: Number, default: 0 },
    },

    /* =====================
       SALES METRICS
    ===================== */
    totalUnitsSold: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    lastSoldAt: { type: Date },

    salesHistory: [
      {
        orderId: { type: Schema.Types.ObjectId, ref: "Order" },
        quantity: { type: Number, required: true },
        salePrice: { type: Number, required: true },
        soldAt: { type: Date, default: Date.now },
      },
    ],

    /* =====================
       PACK / CHILD PRODUCT
    ===================== */
    isChildProduct: { type: Boolean, default: false },
    parentProduct: { type: Schema.Types.ObjectId, ref: "Product", index: true },
    childSalePrice: { type: Number },
    packType: { type: String, enum: ["unit", "pack"], default: "unit" },
    // Parent: base units in one pack (e.g. 24)
    qtyPerPack: { type: Number, default: 1 },
    // Child: base units of the parent's pack in one child item (e.g. 6, 2 or 1)
    unitsPerChild: { type: Number, default: 1, min: 1 },
    // Child: work the cost price out from the parent pack's cost instead of holding its own
    costFromParent: { type: Boolean, default: false },

    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date },
    archivedReason: { type: String, default: "" },
    // Whether the product was on the web shop before it was archived, so restoring
    // puts it back as it was instead of republishing something that was hidden.
    archivedShowOnWeb: { type: Boolean },

    /* =====================
       VENDOR ASSOCIATION
    ===================== */
    vendors: [{ type: Schema.Types.ObjectId, ref: "Vendor" }],

    /* =====================
       LOCATION ASSIGNMENT
    ===================== */
    locations: [{ type: String }],

    /* =====================
       WEB / STOREFRONT VISIBILITY
    ===================== */
    showOnWeb: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default models.Product || model("Product", ProductSchema);
