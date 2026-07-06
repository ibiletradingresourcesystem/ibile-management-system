import mongoose from "mongoose";

const itemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    name: String,
    price: Number, // Price from POS (for backward compatibility)
    quantity: Number, // Quantity from POS
    salePriceIncTax: Number, // Standardized field for reports
    qty: Number, // Standardized field for reports
  },
  {
    _id: false,
    strict: false, // Allow additional fields from POS
  }
);

const tenderPaymentSchema = new mongoose.Schema(
  {
    tenderType: { type: String },
    tenderName: { type: String },
    amount: { type: Number, default: 0 },
  },
  { _id: false }
);

const creditPaymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, default: 0 },
    tenderType: { type: String, default: "CASH" },
    tenderName: { type: String, default: "Cash" },
    reference: { type: String, default: "" },
    note: { type: String, default: "" },
    notes: { type: String, default: "" },
    paidAt: { type: Date, default: Date.now },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", default: null },
    recordedByName: { type: String, default: "" },
    sequence: { type: Number, default: 1 },
  },
  { _id: false }
);

const TransactionSchema = new mongoose.Schema({
  tenderType: String,
  tenderPayments: {
    type: [tenderPaymentSchema],
    default: [],
  },
  amountPaid: Number,
  total: Number,
  subtotal: Number,
  tax: Number,
  staff: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
  staffName: { type: String }, // Staff name for reference (redundant but useful)
  location: { type: String }, // Store location as string (location name or 'online')
  
  // Held-by tracking (who originally held the transaction)
  heldByStaffName: { type: String },
  heldByStaffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
  device: String,
  tableName: String,
  discount: Number,
  discountReason: String,
  incrementAmount: { type: Number }, // Amount added by INCREMENT promotions
  promotionValueType: { type: String }, // "DISCOUNT" or "INCREMENT"
  customerType: { type: String }, // Customer type / promotion name
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
  customerName: String,
  creditStatus: {
    type: String,
    enum: ["none", "open", "partly_paid", "paid", "overdue", "written_off"],
    default: "none",
  },
  creditCustomerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", default: null },
  creditCustomerName: { type: String, default: "" },
  creditOriginalTotal: { type: Number, default: 0 },
  creditPaidAmount: { type: Number, default: 0 },
  creditBalance: { type: Number, default: 0 },
  creditDueDate: { type: Date, default: null },
  creditPaidAt: { type: Date, default: null },
  creditNotes: { type: String, default: "" },
  creditPayments: {
    type: [creditPaymentSchema],
    default: [],
  },

  // Attribution for sales influenced by external channels such as the online store
  salesChannel: { type: String, trim: true, default: "POS" },
  sourceOrderId: { type: String, trim: true, default: "" },
  sourceOrderType: { type: String, trim: true, default: "" },
  sourceSiteKey: { type: String, trim: true, default: "" },

  transactionType: { type: String, enum: ["pos"], default: "pos" }, // Only POS transactions
  status: { 
    type: String, 
    enum: ["held", "completed", "refunded", "credit"],
    default: "completed" 
  },
  subStatus: {
    type: String,
    enum: ["none", "edited", "void"],
    default: "none",
  },
  change: Number,
  items: {
    type: [itemSchema],
    default: [],
  },
  refundReason: String,
  refundBy: { type: mongoose.Schema.Types.ObjectId, ref: "Staff" },
  refundedAt: Date,
  inventoryUpdated: { type: Boolean, default: false },
  inventoryRestockedAt: Date,
  externalId: { type: String },
  dedupeKey: { type: String },
  createdAt: { type: Date, default: Date.now },
});

TransactionSchema.index({ externalId: 1 }, { unique: true, sparse: true });
TransactionSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
TransactionSchema.index({ salesChannel: 1, createdAt: -1 });
TransactionSchema.index({ sourceOrderId: 1 }, { sparse: true });
TransactionSchema.index({ status: 1, creditStatus: 1, createdAt: -1 });
TransactionSchema.index({ creditCustomerId: 1, creditStatus: 1, createdAt: -1 });

// Avoid re-registering the model in development
const Transaction =
  mongoose.models.Transaction ||
  mongoose.model("Transaction", TransactionSchema);

export default Transaction;
export { Transaction };
