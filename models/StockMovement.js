// models/StockMovement.js
import mongoose, { Schema, models } from "mongoose";

const StockMovementSchema = new Schema(
  {
    transRef: { 
      type: String, 
      required: true,
      unique: true,
      index: true 
    },

    fromLocationId: { 
      type: Schema.Types.ObjectId,
      ref: "Store.locations",
    },

    vendorName: {
      type: String,
      trim: true,
      default: "",
    },

    toLocationId: { 
      type: Schema.Types.ObjectId,
      ref: "Store.locations",
    },

    staffId: { 
      type: Schema.Types.ObjectId, 
      ref: "Staff" 
    },

    reason: { 
      type: String, 
      required: true,
      enum: ["Restock", "Transfer", "Return", "Adjustment", "Operational Loss"],
    },

    status: {
      type: String,
      enum: ["Pending", "Sent", "Received"],
      default: "Received",
      index: true
    },

    totalCostPrice: { 
      type: Number, 
      default: 0 
    },
    
    barcode: {
      type: String,
      index: true
    },

    dateSent: {
      type: Date,
      default: Date.now,
      index: true
    },
    
    dateReceived: Date,

    products: [
      {
        productId: { 
          type: Schema.Types.ObjectId, 
          ref: "Product" 
        },
        // Counted in the product's own stock unit. For a pack that is packs, so
        // loose units arrive as a fraction (7 cans of a 24-carton is 0.2917).
        // Zero is allowed so a received line can record that nothing arrived;
        // creating a movement still requires more than zero (stock-movement API).
        quantity: {
          type: Number,
          required: true,
          validate: {
            validator: (value) => Number.isFinite(value) && value >= 0,
            message: "Quantity cannot be negative",
          },
        },
        expiryDate: {
          type: Date,
          default: null
        },
        costPrice: Number,
        notes: String,
      },
    ],

    notes: String,
    
    approvedBy: { 
      type: Schema.Types.ObjectId, 
      ref: "Staff" 
    },
    
    approvalDate: Date,
  },
  { timestamps: true }
);

// Indexes for common queries and performance
StockMovementSchema.index({ createdAt: -1 }); // For sorting by newest
StockMovementSchema.index({ dateSent: -1, status: 1 });
StockMovementSchema.index({ fromLocationId: 1, toLocationId: 1 });
StockMovementSchema.index({ reason: 1 });
StockMovementSchema.index({ 'products.expiryDate': 1 }); // For expiry queries
StockMovementSchema.index({ status: 1, createdAt: -1 }); // For filtered lists

export default models.StockMovement || 
  mongoose.model("StockMovement", StockMovementSchema);

export const StockMovement = 
  models.StockMovement || mongoose.model("StockMovement", StockMovementSchema);
