import express from "express";
import { supabase } from "../config/supabase.js";
import { normalizePhone, ACTIVE_STATUSES, scheduleAppointmentReminder } from "../utils/bookings.js";
import { createNotification } from "../utils/createNotification.js";

const router = express.Router();

// Called by the Retell agent (or a booking widget) to create an appointment.
router.post("/book-appointment", async (req, res) => {
  try {
    const clientId = req.body.clientId || req.query.clientId;
    const {
      customerName,
      customerPhone,
      customerEmail,
      service,
      date,       // "YYYY-MM-DD"
      time,       // "HH:MM"
      notes
    } = req.body;

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
