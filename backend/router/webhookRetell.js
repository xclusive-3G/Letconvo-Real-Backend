import express from "express";
import { supabase } from "../config/supabase.js";

const router = express.Router();

router.post("/webhooks/retell", async (req, res) => {
  try {
    console.log("🤖 Retell webhook payload:", req.body);

    const { phone, intent, new_time } = req.body;

    if (!phone || !intent) {
      return res.status(400).json({ error: "phone and intent are required" });
    }

    if (intent === "confirmed") {
      const { error } = await supabase
        .from("BarberShop")
        .update({ status: "confirmed" })
        .eq("phone", phone);

      if (error) {
        console.error("Supabase confirm error:", error);
        return res.status(400).json({ error: error.message });
      }

      console.log("✅ Booking confirmed for:", phone);
    }

    if (intent === "reschedule") {
      const { error } = await supabase
        .from("BarberShop")
        .update({
          status: "reschedule_requested",
          new_time: new_time || null,
        })
        .eq("phone", phone);

      if (error) {
        console.error("Supabase reschedule error:", error);
        return res.status(400).json({ error: error.message });
      }

      console.log("🔄 Reschedule requested for:", phone);
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Retell webhook error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;