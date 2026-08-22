import { supabase } from "../config/supabase.js";
import { reminderQueue } from "../queue/reminderQueue.js";

// Minutes before the appointment the reminder call should go out.
export const REMINDER_LEAD_MINUTES = 20;

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

// The master Retell agent's tools deliver clientId via an
// {{client_id}}-templated SIP header / dynamic variable (see
// router/telnyxVoiceWebhook2.js and router/retellInboundWebhook.js), which
// Retell may forward as a header, or as a query param under either
// camelCase or snake_case depending on the call path — checking every
// source and both spellings makes each endpoint resilient to whichever one
// actually arrives, instead of depending on one assumption being right.
export function resolveRetellClientId(req) {
  return (
    req.headers["x-client-id"] ||
    req.headers["client-id"] ||
    req.body?.clientId ||
    req.body?.client_id ||
    req.query?.clientId ||
    req.query?.client_id
  );
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

export async function isAppointmentReminderEnabled(clientId) {
  const { data, error } = await supabase
    .from("client_settings")
    .select("appointment_reminders")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    console.error("❌ Failed to load appointment_reminders, defaulting to enabled:", error.message);
    return true;
  }

  return data?.appointment_reminders ?? true;
}

const reminderJobId = (bookingId) => `reminder-${bookingId}`;

// Queues (or re-queues) a delayed job that calls the customer
// REMINDER_LEAD_MINUTES before their appointment. Uses a stable jobId
// per booking so a reschedule can cleanly replace the old delay instead
// of leaving a stale job pointing at the wrong time — always remove
// first, since BullMQ ignores new options (including delay) when a job
// with that ID is already waiting/delayed.
// Best-effort — never throws. Reminder scheduling is a side effect of
// creating/updating a booking; a Redis hiccup here should never break
// the booking request itself.
export async function scheduleAppointmentReminder(booking) {
  try {
    await cancelAppointmentReminder(booking.id);

    const enabled = await isAppointmentReminderEnabled(booking.client_id);
    if (!enabled) return null;

    const apptDateTime = new Date(`${booking.appointment_date}T${toHHMM(booking.appointment_time)}:00`);
    if (Number.isNaN(apptDateTime.getTime())) return null;

    const reminderAt = apptDateTime.getTime() - REMINDER_LEAD_MINUTES * 60 * 1000;
    const delay = reminderAt - Date.now();

    // Too close (or already past) to meaningfully remind — e.g. the
    // booking was made within the lead window of its own slot.
    if (delay <= 0) return null;

    return await reminderQueue.add(
      "appointment-reminder",
      { bookingId: booking.id },
      {
        delay,
        attempts: 2,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
        jobId: reminderJobId(booking.id)
      }
    );
  } catch (err) {
    console.error("❌ Failed to schedule appointment reminder:", err.message);
    return null;
  }
}

// Called when a booking is cancelled/completed, or before re-scheduling
// it, so a stale reminder never fires for a slot that no longer applies.
export async function cancelAppointmentReminder(bookingId) {
  try {
    const job = await reminderQueue.getJob(reminderJobId(bookingId));
    if (job) await job.remove();
  } catch (err) {
    console.error("❌ Failed to cancel appointment reminder job:", err.message);
  }
}
