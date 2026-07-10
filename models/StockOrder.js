import mongoose, { Schema, models } from "mongoose";

// Read-only model for the stockorders collection (from the expense/vendor app)
const StockOrderSchema = new Schema(
  {
    date: Date,
    supplier: String,
    contact: String,
    location: String,
    mainProduct: Schema.Types.Mixed,
    reason: String,
    grandTotal: { type: Number, default: 0 },
    products: [
      {
        productId: { type: Schema.Types.ObjectId, ref: "Product" },
        name: String,
        quantity: Number,
        price: Number,
        total: Number,
      },
    ],
    vendor: { type: Schema.Types.ObjectId, ref: "Vendor" },
    staff: { type: Schema.Types.ObjectId, ref: "Staff" },
    paymentMade: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["Not Paid", "Partly Paid", "Paid", "Credit"],
      default: "Not Paid",
    },
    paymentDate: String,
    payBeforeSupply: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default models.StockOrder || mongoose.model("StockOrder", StockOrderSchema);
