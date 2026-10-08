// models/User.js
import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  pendingEmail: { type: String, default: "" },
  emailChangeTokenHash: { type: String, default: "" },
  emailChangeExpiresAt: { type: Date, default: null },
  role: { type: String, enum: ["admin", "sub-admin", "inventory", "account", "manager", "staff", "viewer"], default: "staff" },
  isActive: { type: Boolean, default: true },
  permissions: {
    type: [String],
    default: [],
    // Possible values: setup, manage, stock, reporting, expenses, support, staff, assets, users
  },
  // The staff member this sign-in is (Manage Staff). Their name and location fill in the
  // staff and location of the entries this user makes (lib/linkedStaff.js).
  staffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", default: null },
}, { timestamps: true });

export default mongoose.models.User || mongoose.model("User", UserSchema);
