import express from "express";
import { supabase } from "../config/supabase.js";
import {
  findLatestBooking,
  BOOKING_STATUSES,
  ACTIVE_STATUSES,
  scheduleAppointmentReminder,
  cancelAppointmentReminder,
  resolveRetellClientId
} from "../utils/bookings.js";

const router = express.Router();

// Called by the Retell agent to confirm, cancel, or reschedule a booking.
router.post("/retell/update-booking", async (req, res) => {
  const clientId = resolveRetellClientId(req);
  const { phone, status, newDate, newTime } = req.body;

  if (!clientId || !phone) {
    return res.json({ success: false, error: "clientId and phone are required" });
  }

  if (status && !BOOKING_STATUSES.includes(status)) {
    return res.json({
      success: false,
      error: `status must be one of: ${BOOKING_STATUSES.join(", ")}`
    });
  }

  try {
    const existing = await findLatestBooking(clientId, phone);

    if (!existing) {
      return res.json({ success: false, error: "No booking found for that phone number" });
    }

    const updates = { updated_at: new Date().toISOString() };

    if (newDate) updates.appointment_date = newDate;
    if (newTime) updates.appointment_time = newTime;

    if (status) {
      updates.status = status;
    } else if (newDate || newTime) {
      updates.status = "rescheduled";
    }

    const { data, error } = await supabase
      .from("bookings")
      .update(updates)
      .eq("id", existing.id)
      .select()
      .single();

    if (error) throw error;

    // Keep the reminder call in sync with whatever the booking now looks
    // like: still active and the time actually changed -> re-schedule at
    // the new time; no longer active -> cancel the pending reminder so it
    // doesn't fire for a slot that's cancelled/completed.
    if (ACTIVE_STATUSES.includes(data.status) && (newDate || newTime)) {
      await scheduleAppointmentReminder(data);
    } else if (!ACTIVE_STATUSES.includes(data.status)) {
      await cancelAppointmentReminder(data.id);
    }

    return res.json({ success: true, booking: data });

  } catch (err) {
    console.error("❌ update-booking error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
