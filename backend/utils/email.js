import { getResend } from "../config/resend.js";

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Letconvo AI <notifications@letconvo.live>";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://letconvo.live";
const BRAND_COLOR = "#8B6E3C";

// Best-effort — never throws. Email is a nice-to-have on top of the
// in-app notification, not something that should ever break the billing
// flow that triggered it (a webhook handler, a credit deduction, etc.).
export async function sendEmail({ to, subject, text, html }) {
  const resend = getResend();

  if (!resend) {
    console.warn("⚠️ Resend not configured — skipping email:", subject);
    return;
  }

  if (!to) return;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      text,
      html
    });

    if (error) {
      console.error("❌ Resend send error:", error);
    }
  } catch (err) {
    console.error("❌ Failed to send email:", err);
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Shared branded wrapper for transactional alert emails (low credit,
// trial ended, subscription active/renewed, top-up successful) — keeps
// every billing email visually consistent without each call site having
// to hand-roll HTML. Always pair with a plain-text version (see
// renderNotificationText) — email clients that block HTML, and spam
// filters scoring on the text/html ratio, both need it.
export function renderNotificationEmail({
  businessName,
  greetingName,
  title,
  message,
  ctaLabel = "Go to Dashboard",
  ctaUrl = `${FRONTEND_URL}/#dashboard`
}) {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f7f2ec;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f2ec;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e8e2d8;">
            <tr>
              <td style="background:${BRAND_COLOR};padding:20px 28px;">
                <span style="font-family:Georgia,serif;font-weight:700;font-size:16px;letter-spacing:0.08em;text-transform:uppercase;color:#ffffff;">Letconvo AI</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                ${businessName ? `<p style="margin:0 0 4px;font-size:11px;color:#8B7060;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(businessName)}</p>` : ""}
                <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#1A1614;">${escapeHtml(title)}</h1>
                ${greetingName ? `<p style="margin:0 0 10px;font-size:14px;color:#4E4439;">Hi ${escapeHtml(greetingName)},</p>` : ""}
                <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#4E4439;">${escapeHtml(message)}</p>
                <a href="${ctaUrl}" style="display:inline-block;padding:12px 24px;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:700;letter-spacing:0.04em;">${escapeHtml(ctaLabel)} &rarr;</a>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid #f0ebe4;">
                <p style="margin:0;font-size:11px;color:#8B7060;line-height:1.5;">
                  You're receiving this because Email Notifications is on for your Letconvo AI account.
                  You can turn it off anytime in Settings &rarr; Notifications.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// Plain-text companion to renderNotificationEmail — required alongside
// the HTML part for deliverability and for clients/screen readers that
// don't render HTML.
export function renderNotificationText({ businessName, greetingName, title, message, ctaUrl = `${FRONTEND_URL}/#dashboard` }) {
  const lines = [];
  if (businessName) lines.push(businessName);
  lines.push(title);
  lines.push("");
  if (greetingName) lines.push(`Hi ${greetingName},`);
  lines.push(message);
  lines.push("");
  lines.push(`Go to dashboard: ${ctaUrl}`);
  lines.push("");
  lines.push("You're receiving this because Email Notifications is on for your Letconvo AI account. You can turn it off anytime in Settings > Notifications.");
  return lines.join("\n");
}
