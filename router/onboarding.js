import express from "express";
import { supabase } from "../config/supabase.js";

const router = express.Router();

router.post("/onboard-client", async (req, res) => {
  try {
    const { businessName, phone, email } = req.body;

    // 1. Create client
    const { data: client, error } = await supabase
      .from("clients")
      .insert({
        business_name: businessName,
        credits_remaining: 20, // 👈 FREE credits
        status: "active"
      })
      .select()
      .single();

    if (error) throw error;

    // 2. Save settings (optional but recommended)
    await supabase.from("client_settings").insert({
      client_id: client.id,
      business_name: businessName,
      phone,
      email,
      greeting: `Welcome to ${businessName}`
    });

    return res.json({
      success: true,
      clientId: client.id
    });

  } catch (err) {
    console.error("❌ Onboarding error:", err);
    res.status(500).json({ error: "Failed to onboard client" });
  }
});

export default router;