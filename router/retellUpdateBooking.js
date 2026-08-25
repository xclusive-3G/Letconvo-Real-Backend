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
  // Same schema-drift issue as book_appointment/get_existing_booking — the
  // LLM sometimes sends alternate field names instead of the declared ones.
  const phone = req.body.phone || req.body.phone_number;
  // "work test" (an earlier hand-built Retell agent) declares its status
  // enum as reschedule_requested/confirmed/cancelled rather than this
  // table's actual rescheduled/confirmed/... statuses — normalize so an
  // agent built against either wording still lands on a valid status.
  const STATUS_ALIASES = { reschedule_requested: "rescheduled" };
  const rawStatus = req.body.status;
  const status = STATUS_ALIASES[rawStatus] || rawStatus;
  const newDate = req.body.newDate || req.body.new_date || req.body.date;
  const newTime = req.body.newTime || req.body.new_time || req.body.time;

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
