import express from "express";
import { supabase } from "../config/supabase.js";
import { sendEmail } from "../utils/email.js";
import { strictLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

// Where every public "Contact Us" submission gets emailed, in addition to
// showing up in the admin panel's Messages page.
const ADMIN_NOTIFY_EMAIL = "isaac@sekanihub.com";

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Public — no auth, hit directly from the marketing site's Contact page.
router.post("/contact", strictLimiter, async (req, res) => {
  try {
    const { firstName, lastName, email, phone, companyName, interest, message } = req.body;

    if (!firstName || !email || !message) {
      return res.status(400).json({ error: "Name, email, and message are required" });
    }

    const { data, error } = await supabase
      .from("contact_messages")
      .insert({
        first_name: firstName,
        last_name: lastName || null,
        email,
        phone: phone || null,
        company_name: companyName || null,
        interest: interest || null,
        message
      })
      .select("id")
      .single();

    if (error) throw error;

    const fullName = [firstName, lastName].filter(Boolean).join(" ");

    // Best-effort — sendEmail never throws, so a delivery failure never
    // blocks the visitor's submission from succeeding.
    await sendEmail({
      to: ADMIN_NOTIFY_EMAIL,
      subject: `New contact form message from ${fullName}`,
      text: [
        `From: ${fullName} <${email}>`,
        `Phone: ${phone || "-"}`,
        `Company: ${companyName || "-"}`,
        `Interested in: ${interest || "-"}`,
        "",
        message
      ].join("\n"),
      html: `
        <p><strong>From:</strong> ${escapeHtml(fullName)} &lt;${escapeHtml(email)}&gt;</p>
        <p><strong>Phone:</strong> ${escapeHtml(phone || "-")}</p>
        <p><strong>Company:</strong> ${escapeHtml(companyName || "-")}</p>
        <p><strong>Interested in:</strong> ${escapeHtml(interest || "-")}</p>
        <p style="white-space:pre-wrap;">${escapeHtml(message)}</p>
      `
    });

    return res.json({ success: true, id: data.id });
  } catch (err) {
    console.error("❌ Contact form error:", err);
    return res.status(500).json({ error: "Failed to submit message" });
  }
});

export default router;
