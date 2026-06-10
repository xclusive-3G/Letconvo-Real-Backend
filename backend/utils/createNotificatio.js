// utils/createNotification.js

import { supabase } from "../lib/supabase.js";

export async function createNotification({
  clientId,
  title,
  message,
  type = "info"
}) {
  return supabase
    .from("notifications")
    .insert({
      client_id: clientId,
      title,
      message,
      type
    });
}