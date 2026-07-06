import mongoose from "mongoose";

const CustomerSnapshotSchema = new mongoose.Schema(
  {
    name: String,
    email: String,
    phone: String,
    address: String,
    city: String,
    type: String,
  },
  { _id: false }
);

const ShippingDetailsSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
  },
  { _id: false }
);

const OrderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: false },
    name: { type: String, default: "" },
    price: { type: Number, default: 0 },
    quantity: { type: Number, default: 0 },
    category: String,
    description: String,
    images: [String],
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: false,
      default: null,
    },

    siteKey: {
      type: String,
      enum: ["store", "hotel"],
      default: "store",
    },

    customerSnapshot: CustomerSnapshotSchema,

    shippingDetails: ShippingDetailsSchema,

    items: [OrderItemSchema],

    cartProducts: [OrderItemSchema],

    subtotal: { type: Number, required: true },
    shippingCost: { type: Number, default: 0 },
    total: { type: Number, required: true },

    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
      default: null,
    },
    locationName: {
      type: String,
      default: "",
      index: true,
    },

    paymentReference: { type: String },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Failed"],
      default: "Pending",
    },
    paymentChannel: {
      type: String,
      default: "manual-entry",
    },

    status: {
      type: String,
      enum: [
        // Standard fulfilment statuses (set by admin)
        "Pending", "Processing", "Shipped", "Delivered", "Cancelled",
        // Online order lifecycle statuses (set by webpage-app)
        "Pending Payment", "Inventory Reserved", "Reservation Expired",
      ],
      default: "Pending",
    },

    deliveryPerson: {
      name: { type: String, default: "" },
      phone: { type: String, default: "" },
    },

    completedByStaffId: {
      type: String,
      default: "",
    },
    completedByStaffName: {
      type: String,
      default: "",
    },

    paid: { type: Boolean, default: false },

    reservationStatus: {
      type: String,
      enum: ["active", "releasing", "released", "finalizing", "finalized", null],
      default: "active",
    },
    reservationExpiresAt: Date,
    reservationReleasedAt: Date,
    finalizedAt: Date,
    cancellationReason: String,

    // Prevents double inventory deduction across systems.
    // Set to 'paystack' when online payment finalizes, 'admin' when admin delivers.
    inventoryFinalizedBy: { type: String, enum: ["paystack", "admin", "pos", null], default: null },
  },
  { timestamps: true }
);

export default mongoose.models.Order || mongoose.model("Order", orderSchema);