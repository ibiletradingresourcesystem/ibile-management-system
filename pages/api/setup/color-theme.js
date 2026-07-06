import { mongooseConnect } from "@/lib/mongodb";
import SystemTheme from "@/models/SystemTheme";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  await mongooseConnect();
  const { method } = req;

  if (method === "GET") {
    let theme = await SystemTheme.findOne({ key: "system-theme" }).lean();
    if (!theme) {
      theme = await SystemTheme.create({ key: "system-theme" });
      theme = theme.toObject();
    }
    return res.json({ success: true, theme });
  }

  if (method === "PUT") {
    const allowedFields = [
      "primaryColor", "secondaryColor", "sidebarBg",
      "sidebarActiveGradientFrom", "sidebarActiveGradientTo",
      "tableHeaderGradientFrom", "tableHeaderGradientTo",
      "buttonPrimaryBg", "buttonPrimaryHover", "pageBg",
      "successColor", "warningColor", "errorColor", "infoColor",
      "presetName",
    ];

    const update = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        update[field] = req.body[field];
      }
    }

    const theme = await SystemTheme.findOneAndUpdate(
      { key: "system-theme" },
      { $set: update },
      { new: true, upsert: true }
    );

    return res.json({ success: true, theme });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
