import { supabase } from "../config/supabase.js";

export async function createNotification({
  clientId,
  title,
  message,
  type = "info"
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
}
