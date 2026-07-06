import nodemailer from "nodemailer";
import { authMiddleware, isStaff } from "@/lib/auth-middleware";

export default async function handler(req, res) {
  const authError = authMiddleware(req, res);
  if (authError) return authError;

  if (!isStaff(req)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { products, movementId } = req.body;

  if (!products || !Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ message: "No products provided" });
  }

  try {
    // Setup email transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Format low stock items
    const productsList = products
      .map(p => `• ${p.name}: ${p.quantity} units (Min: ${p.minStock || 0})`)
      .join("\n");

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">⚠️ Low Stock Alert</h1>
        </div>
        
        <div style="padding: 20px; background: #fafafa; border: 1px solid #eee;">
          <p style="color: #333; font-size: 14px; margin-top: 0;">
            The following products have fallen below their minimum stock levels:
          </p>
          
          <div style="background: white; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0; border-radius: 4px;">
            <pre style="margin: 0; white-space: pre-wrap; color: #333; font-family: Arial; font-size: 13px;">${productsList}</pre>
          </div>
          
          <div style="background: #fef3c7; padding: 12px; border-radius: 4px; margin: 15px 0; border-left: 4px solid #f59e0b;">
            <p style="margin: 0; color: #92400e; font-size: 13px;">
              <strong>Action Required:</strong> Please review inventory and consider restocking these items.
            </p>
          </div>
          
          <p style="color: #666; font-size: 12px; margin: 15px 0 0 0;">
            <strong>Movement ID:</strong> ${movementId}<br/>
            <strong>Alert Time:</strong> ${new Date().toLocaleString()}
          </p>
        </div>
        
        <div style="padding: 15px; background: #f3f4f6; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px; color: #666;">
          <p style="margin: 0;">
            This is an automated inventory management alert
          </p>
        </div>
      </div>
    `;

    // Send email to admin/warehouse staff
    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: adminEmail,
      subject: `⚠️ Low Stock Alert - ${products.length} Product(s)`,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("📧 Low stock notification sent:", info.messageId);

    return res.status(200).json({
      success: true,
      message: "Low stock notification sent",
      sentTo: adminEmail,
      productCount: products.length,
    });
  } catch (err) {
    console.error("❌ Low stock notification error:", err);
    return res.status(500).json({
      message: "Failed to send notification",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}
