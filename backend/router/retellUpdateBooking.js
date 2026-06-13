import express from "express";
import { supabase } from "../config/supabase.js";
const router = express.Router();

router.post("/retell/update-booking", async (req, res) => {
  const { phone, status, new_time } = req.body;

  // Strip + sign
  const cleanPhone = String(phone).replace("+", "");

  try {
    const updates = { status };
    if (new_time) updates.new_time = new_time;

    const { error } = await supabase
      .from("BarberShop")
      .update(updates)
      .eq("phone", cleanPhone);

    if (error) return res.json({ success: false, error: error.message });
    return res.json({ success: true });

  } catch (err) {
    console.error("❌ update-booking error:", err);
    return res.status(500).json({ success: false });
  }
});

export default router;