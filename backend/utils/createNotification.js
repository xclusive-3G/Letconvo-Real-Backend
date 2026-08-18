import { supabase } from "../config/supabase.js";
import { sendEmail } from "./email.js";

// email: opt-in per call site — only billing/credit alerts (low credit,
// trial ended, subscription active/renewed, top-up successful) actually
// email right now. Other callers (new booking, call summaries) still get
// the in-app notification row but no email, so this stays additive
// rather than emailing on every single notification type.
export async function createNotification({
  clientId,
  title,
  message,
  type = "info",
  email = false
}) {
  const { error } = await supabase
    .from("notifications")
    .insert({
      client_id: clientId,
      title,
      message,
      type
    });

  if (error) {
    console.error("❌ Failed to create notification:", error);
  }

  if (email) {
    await emailIfEnabled({ clientId, title, message });
  }
}

async function emailIfEnabled({ clientId, title, message }) {
  try {
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("ownerEmail")
      .eq("id", clientId)
      .maybeSingle();

    if (clientError || !client?.ownerEmail) return;

    const { data: settings } = await supabase
      .from("client_settings")
      .select("email_notif")
      .eq("client_id", clientId)
      .maybeSingle();

    // Matches GET /me/settings' own default (see middleware/me.js) —
    // email is on by default until a settings row exists to say otherwise.
    if (settings && settings.email_notif === false) return;

    await sendEmail({ to: client.ownerEmail, subject: title, text: message });
  } catch (err) {
    console.error("❌ Failed to email notification:", err);
  }
}
