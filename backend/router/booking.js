import express from "express";
import { supabase } from "../config/supabase.js";
import { normalizePhone, ACTIVE_STATUSES } from "../utils/bookings.js";
import { createNotification } from "../utils/createNotification.js";

const router = express.Router();

// Generic public booking endpoint (e.g. a "book appointment" web widget).
// Same bookings table and rules as the Retell voice booking flow, so a
// slot booked over the phone and one booked on the web can never clash.
router.post("/api/bookings", async (req, res) => {
  const bookingData = req.body;

  const {
    clientId,
    firstName,
    lastName,
    phone,
    email,
    service,
    date,
    time,
    notes
  } = bookingData;

  if (!clientId || !firstName || !phone || !date || !time) {
    return res.status(400).json({
      error: "clientId, firstName, phone, date, and time are required"
    });
  }

  const customerName = lastName ? `${firstName} ${lastName}` : firstName;
  const cleanPhone = normalizePhone(phone);

  try {
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
      return res.status(409).json({ error: "That slot was just taken. Please choose another time." });
    }

    const { data, error } = await supabase
      .from("bookings")
      .insert({
        client_id: clientId,
        customer_name: customerName,
        customer_phone: cleanPhone,
        customer_email: email || null,
        service: service || null,
        appointment_date: date,
        appointment_time: time,
        notes: notes || null,
        status: "pending"
      })
      .select()
      .single();

    if (error) throw error;

    console.log("Appointment created:", data.id);

    await createNotification({
      clientId,
      title: "New appointment booked",
      message: `${customerName} · ${date} at ${time}`,
      type: "appointment"
    });

    return res.status(201).json(data);

  } catch (err) {
    console.error("Error inserting appointment:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
