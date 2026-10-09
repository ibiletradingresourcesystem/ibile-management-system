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
    // When the selling price last changed, and what it was before: what Price Tags' "Price
    // Changed" lists. Set by the hooks below on every write, not by each screen. A new product
    // counts as a change (it needs its first tag); previousSalePrice is then empty.
    priceChangedAt: { type: Date, default: null, index: true },
    previousSalePrice: { type: Number, default: null },

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
    // Printed on the receipt, so the customer knows what they saved on
    promoName: { type: String, default: "" },
    // "price": each at promoPrice · "multibuy": promoBuyQty for promoPrice · "percent": promoBuyQty or more, promoPercent off
    promoType: { type: String, enum: ["price", "multibuy", "percent"], default: "price" },
    promoBuyQty: { type: Number, default: 1 },
    promoPercent: { type: Number },
    // "mon" … "sun"; none means every day
    promoDays: { type: [String], default: [] },
    // Customer types it is kept for; none means everyone
    promoCustomerTypes: { type: [String], default: [] },

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

/* =====================
   SELLING PRICE CHANGES
   Kept here so every way a price is written counts — the product form, import, pack and child
   re-pricing, receiving — and a save that leaves the price as it was does not.
===================== */
const samePrice = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;

/** The sale price an update sets, or undefined when it does not set one. */
function salePriceIn(update) {
  if (!update || Array.isArray(update)) return undefined;
  if (update.$set && Object.prototype.hasOwnProperty.call(update.$set, "salePriceIncTax")) return update.$set.salePriceIncTax;
  if (Object.prototype.hasOwnProperty.call(update, "salePriceIncTax")) return update.salePriceIncTax;
  return undefined;
}

function stampUpdate(update, previous, at) {
  update.$set = { ...(update.$set || {}), priceChangedAt: at, previousSalePrice: Number(previous) || 0 };
}

ProductSchema.post("init", function rememberPrice(doc) {
  doc.$locals.loadedSalePrice = doc.salePriceIncTax;
});

ProductSchema.pre("save", function stampSave(next) {
  if (this.isNew) {
    if (Number(this.salePriceIncTax) > 0 && !this.priceChangedAt) this.priceChangedAt = new Date();
  } else if (this.isModified("salePriceIncTax") && !samePrice(this.salePriceIncTax, this.$locals.loadedSalePrice)) {
    this.previousSalePrice = Number(this.$locals.loadedSalePrice) || 0;
    this.priceChangedAt = new Date();
  }
  next();
});

ProductSchema.pre("insertMany", function stampInsert(next, docs) {
  const now = new Date();
  for (const doc of Array.isArray(docs) ? docs : [docs]) {
    if (doc && Number(doc.salePriceIncTax) > 0 && !doc.priceChangedAt) doc.priceChangedAt = now;
  }
  next();
});

async function stampOneUpdate() {
  const update = this.getUpdate();
  const price = salePriceIn(update);
  if (price === undefined) return;
  const current = await this.model.findOne(this.getFilter()).select("salePriceIncTax").lean();
  if (current && !samePrice(current.salePriceIncTax, price)) stampUpdate(update, current.salePriceIncTax, new Date());
}
ProductSchema.pre("findOneAndUpdate", stampOneUpdate);
ProductSchema.pre("updateOne", { document: false, query: true }, stampOneUpdate);

// Many products to one price: the ones whose price is different now are stamped first, keeping
// each one's old price
ProductSchema.pre("updateMany", async function stampMany() {
  const price = salePriceIn(this.getUpdate());
  if (price === undefined) return;
  await this.model.updateMany(
    { ...this.getFilter(), salePriceIncTax: { $ne: Number(price) } },
    [{ $set: { previousSalePrice: "$salePriceIncTax", priceChangedAt: "$$NOW" } }]
  );
});

ProductSchema.pre("bulkWrite", async function stampBulk(next, ops) {
  const priced = (Array.isArray(ops) ? ops : []).filter((op) => op?.updateOne && salePriceIn(op.updateOne.update) !== undefined);
  if (priced.length === 0) return;
  const ids = priced.map((op) => op.updateOne.filter?._id).filter(Boolean);
  const current = new Map(
    (await this.find({ _id: { $in: ids } }).select("salePriceIncTax").lean()).map((p) => [String(p._id), p.salePriceIncTax])
  );
  const now = new Date();
  for (const op of priced) {
    const id = String(op.updateOne.filter?._id || "");
    if (!current.has(id)) continue;
    const price = salePriceIn(op.updateOne.update);
    if (!samePrice(current.get(id), price)) stampUpdate(op.updateOne.update, current.get(id), now);
  }
});

export default models.Product || model("Product", ProductSchema);
