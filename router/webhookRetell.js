import express from "express";
import { supabase } from "../config/supabase.js";
import { findLatestBooking } from "../utils/bookings.js";

const router = express.Router();

// Legacy intent-style webhook (confirmed / reschedule / cancelled).
// Kept for backward compatibility with any existing Retell agent config
// that posts here instead of /retell/update-booking.
router.post("/webhooks/retell", async (req, res) => {
  try {
    console.log("🤖 Retell webhook payload:", req.body);

    const { clientId, phone, intent, newDate, newTime } = req.body;

    if (!clientId || !phone || !intent) {
      return res.status(400).json({ error: "clientId, phone, and intent are required" });
    }

    const existing = await findLatestBooking(clientId, phone);

    if (!existing) {
      return res.status(404).json({ error: "No booking found for that phone number" });
    }

    const updates = { updated_at: new Date().toISOString() };

    if (intent === "confirmed") {
      updates.status = "confirmed";
    } else if (intent === "reschedule") {
      updates.status = "rescheduled";
      if (newDate) updates.appointment_date = newDate;
      if (newTime) updates.appointment_time = newTime;
    } else if (intent === "cancelled") {
      updates.status = "cancelled";
    } else {
      return res.status(400).json({ error: `Unsupported intent: ${intent}` });
    }

    const { error } = await supabase
      .from("bookings")
      .update(updates)
      .eq("id", existing.id);

    if (error) throw error;

    console.log(`✅ Booking ${existing.id} updated via intent "${intent}" for ${phone}`);

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Retell webhook error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
