import express from "express";
import { supabase } from "../config/supabase.js";
import { normalizePhone, ACTIVE_STATUSES, scheduleAppointmentReminder, resolveRetellClientId } from "../utils/bookings.js";
import { createNotification } from "../utils/createNotification.js";

const router = express.Router();

// Called by the Retell agent (or a booking widget) to create an appointment.
router.post("/book-appointment", async (req, res) => {
  try {
    const clientId = resolveRetellClientId(req);
    const b = req.body;

    // The Retell agent's LLM doesn't reliably stick to the tool's declared
    // schema property names on every call (observed real calls sending
    // full_name/phone_number/email_address/service_reason instead of
    // customerName/customerPhone/customerEmail/service, even though the
    // schema only defines the latter) — accepting both keeps a booking
    // from silently failing over a naming mismatch outside our control.
    const customerName = b.customerName || b.full_name || b.name;
    const customerPhone = b.customerPhone || b.phone_number || b.phone;
    const customerEmail = b.customerEmail || b.email_address || b.email;
    const service = b.service || b.service_reason || b.reason;
    const date = b.date; // "YYYY-MM-DD"
    const time = b.time; // "HH:MM"
    const notes = b.notes;

    if (!clientId || !customerName || !customerPhone || !date || !time) {
      return res.status(400).json({
        success: false,
        error: "clientId, customerName, customerPhone, date, and time are required"
      });
    }

    const cleanPhone = normalizePhone(customerPhone);

    // Prevent double-booking the same slot for this business.
    const { data: clash, error: clashError } = await supabase
      .from("bookings")
      .select("id")
      .eq("client_id", clientId)
      .eq("appointment_date", date)
      .eq("appointment_time", time)
      .in("status", ACTIVE_STATUSES)
      .maybeSingle();

    if (clashError) throw clashError;

    if (clash) {
      return res.status(409).json({
        success: false,
        error: "That slot was just taken. Please choose another time."
      });
    }

    const { data, error } = await supabase
      .from("bookings")
      .insert({
        client_id: clientId,
        customer_name: customerName,
        customer_phone: cleanPhone,
        customer_email: customerEmail || null,
        service: service || null,
        appointment_date: date,
        appointment_time: time,
        notes: notes || null,
        status: "pending"
      })
      .select()
      .single();

    if (error) throw error;

    console.log("📅 Booking saved:", data.id);

    await createNotification({
      clientId,
      title: "New appointment booked",
      message: `${customerName} · ${date} at ${time}`,
      type: "appointment"
    });

    await scheduleAppointmentReminder(data);

    return res.status(201).json({ success: true, booking: data });
  } catch (err) {
    console.error("❌ Booking error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
