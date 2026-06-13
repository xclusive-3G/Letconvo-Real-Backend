import express from "express";
import { supabase } from "../config/supabase.js";

const router = express.Router();

router.post("/retell/get-booking", async (req, res) => {
  const { phone } = req.body;
  const cleanPhone = String(phone).replace("+", "");

  try {
    const { data, error } = await supabase
      .from("BarberShop")
      .select("*")
      .eq("phone", cleanPhone)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return res.json({ found: false });
    }

    // Build appointment datetime from date + time columns
    const apptDate = data.date && data.time
      ? new Date(`${data.date}T${data.time}`)
      : null;

    const formattedDate = apptDate
      ? apptDate.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric"
        })
      : "date not set";

    const formattedTime = apptDate
      ? apptDate.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit"
        })
      : "time not set";

    return res.json({
      found: true,
      customer_name:    data.first_name || data.full_name || "there",
      last_name:        data.last_name || "",
      appointment_date: formattedDate,
      appointment_time: formattedTime,
      raw_date:         data.date,
      raw_time:         data.time,
      service:          data.service || data.service_type || "haircut",
      barber:           data.barber || data.barber_name || "your barber",
      booking_id:       data.id,
      status:           data.status,
      phone:            data.phone,
      notes:            data.notes || "",
      address:          data.address || "",
    });

  } catch (err) {
    console.error("❌ get-booking error:", err);
    return res.status(500).json({ found: false });
  }
});
export default router;