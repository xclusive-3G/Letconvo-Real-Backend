import { getResend } from "../config/resend.js";

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Letconvo AI <notifications@letconvo.live>";

// Best-effort — never throws. Email is a nice-to-have on top of the
// in-app notification, not something that should ever break the billing
// flow that triggered it (a webhook handler, a credit deduction, etc.).
export async function sendEmail({ to, subject, text }) {
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
      text
    });

    if (error) {
      console.error("❌ Resend send error:", error);
    }
  } catch (err) {
    console.error("❌ Failed to send email:", err);
  }
}
