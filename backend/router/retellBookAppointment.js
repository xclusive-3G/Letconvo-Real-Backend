import express from "express";
import { supabase } from "../config/supabase.js";

const router = express.Router();

router.post("/book-appointment", async (req, res) => {
  try {
    const {
      clientId,
      customerName,
      customerPhone,
      service,
      date,
      time
    } = req.body;

    const { error } = await supabase.from("bookings").insert({
      client_id: clientId,
      customer_name: customerName,
      customer_phone: customerPhone,
      service,
      appointment_date: date,
      appointment_time: time
    });

    if (error) throw error;

    console.log("📅 Booking saved");

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Booking error:", err);
    return res.status(500).json({ success: false });
  }
});

export default router;