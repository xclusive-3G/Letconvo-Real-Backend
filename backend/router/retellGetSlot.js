import express from "express";
import { supabase } from "../../config/supabase.js";

const router = express.Router();
router.post("/retell/get-slots", async (req, res) => {
  console.log("📅 Fetching available slots...");

  try {
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Get already booked slots
    const { data: booked } = await supabase
      .from("BarberShop")
      .select("appointment_time")
      .gte("appointment_time", now.toISOString())
      .lte("appointment_time", nextWeek.toISOString())
      .in("status", ["confirmed", "calling"]);

    // Build available slots (9am - 6pm, Mon-Sat)
    const bookedTimes = (booked || []).map(b => b.appointment_time);
    const slots = [];
    const cursor = new Date(now);
    cursor.setHours(cursor.getHours() + 1, 0, 0, 0);

    while (cursor <= nextWeek && slots.length < 6) {
      const day = cursor.getDay();
      const hour = cursor.getHours();

      if (day !== 0 && hour >= 9 && hour < 18) {
        const iso = cursor.toISOString();
        if (!bookedTimes.includes(iso)) {
          slots.push({
            date: cursor.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric"
            }),
            time: cursor.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit"
            }),
            iso
          });
        }
      }
      cursor.setHours(cursor.getHours() + 1);
    }

    return res.json({ slots });

  } catch (err) {
    console.error("❌ get-slots error:", err);
    return res.status(500).json({ slots: [] });
  }
});

export default router;