import { supabase } from "../config/supabase.js";

// Statuses used consistently across every booking endpoint.
export const BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "rescheduled",
  "cancelled",
  "completed"
];

// Statuses that count as "the slot is taken" when checking availability.
export const ACTIVE_STATUSES = ["pending", "confirmed", "rescheduled"];

/**
 * Pulls the business's open/close hour from client_settings.
 * Falls back to 9am-6pm if the client hasn't configured hours.
 */
export async function getBusinessHours(clientId) {
  const { data, error } = await supabase
    .from("client_settings")
    .select("open_hour, close_hour")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    console.error("⚠️ Could not load business hours, using defaults:", error.message);
  }

  const openHour = parseInt(data?.open_hour, 10);
  const closeHour = parseInt(data?.close_hour, 10);

  return {
    openHour: Number.isFinite(openHour) ? openHour : 9,
    closeHour: Number.isFinite(closeHour) ? closeHour : 18
  };
}

// Normalizes a phone number so "+234...", "234...", and "0234..." style
// variations from a caller ID all match what was stored at booking time.
export function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

// "14:05:00" (what Postgres returns for a `time` column) -> "14:05"
export function toHHMM(time) {
  return String(time || "").slice(0, 5);
}

export function formatDateHuman(dateStr) {
  if (!dateStr) return "date not set";
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

export function formatTimeHuman(timeStr) {
  if (!timeStr) return "time not set";
  const [h, m] = toHHMM(timeStr).split(":").map(Number);
  if (Number.isNaN(h)) return timeStr;
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Finds the most recent, still-relevant booking for a phone number
 * scoped to one business (client). Used by get-booking/update-booking
 * so two different businesses' customers never collide on phone number.
 */
export async function findLatestBooking(clientId, phone) {
  const cleanPhone = normalizePhone(phone);

  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("client_id", clientId)
    .eq("customer_phone", cleanPhone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
