import { supabase } from "../config/supabase.js";
import { hasOptedOut } from "../db.js";
import {
  ACTIVE_STATUSES,
  isAppointmentReminderEnabled,
  toHHMM,
  REMINDER_LEAD_MINUTES
} from "../utils/bookings.js";
import { getClient, deductCreditsAtomic, pauseClientIfLowCredits } from "./credit.js";
import { createRetellReminderCall } from "./retell.js";

// Small pre-authorization reservation before the call — mirrors the
// intent of the missed-call-recovery reservation in service/recovery.js,
// which is meant to do the same thing but doesn't actually pass an
// amount (a pre-existing bug there, not replicated here). The real
// per-minute cost is reconciled after the call, same as every other
// call, via service/retellCallProcessor.js's processCompletedCall.
const RESERVATION_CREDITS = 5;

// Re-fetches the booking (not the queued job payload) so this always
// acts on current data — catches cancellations, and guards against a
// stale job that survived a reschedule without being cleanly replaced.
export async function processAppointmentReminder(bookingId) {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();

  if (error) throw error;
  if (!booking) return { skipped: "booking_not_found" };

  if (!ACTIVE_STATUSES.includes(booking.status)) {
    return { skipped: "booking_not_active", status: booking.status };
  }

  const apptDateTime = new Date(`${booking.appointment_date}T${toHHMM(booking.appointment_time)}:00`);
  const minutesUntil = (apptDateTime.getTime() - Date.now()) / 60000;

  // Tolerance window around the intended lead time, not an exact match —
  // guards against a job that's stale (survived a reschedule) firing at
  // the wrong moment, without being so strict that normal queue jitter
  // skips a legitimate reminder.
  if (minutesUntil < REMINDER_LEAD_MINUTES - 10 || minutesUntil > REMINDER_LEAD_MINUTES + 10) {
    return { skipped: "stale_timing", minutesUntil };
  }

  const enabled = await isAppointmentReminderEnabled(booking.client_id);
  if (!enabled) return { skipped: "disabled_for_client" };

  const optedOut = await hasOptedOut(booking.customer_phone);
  if (optedOut) return { skipped: "opted_out" };

  const client = await getClient(booking.client_id);
  if (!client || client.status !== "active") {
    return { skipped: "client_inactive" };
  }

  const reserved = await deductCreditsAtomic({
    clientId: booking.client_id,
    amount: RESERVATION_CREDITS,
    description: "Appointment reminder call reservation"
  });

  if (!reserved) return { skipped: "insufficient_credits" };

  await pauseClientIfLowCredits(booking.client_id);

  const result = await createRetellReminderCall({
    toNumber: booking.customer_phone,
    clientId: booking.client_id,
    booking
  });

  return { called: true, result };
}
