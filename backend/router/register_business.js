import express from "express";
import { supabase } from "../../config/supabase.js";
import bcrypt from "bcrypt";


const router = express.Router();
// const hashedPassword = await bcrypt.hash(password, 10);

router.post("/register-business", async (req, res) => {
  try {
    const {
  businessName,
  businessType,
  businessPhone,
  businessEmail,
  businessAddress,
  receptionistMode,
  greetingMessage,
  openTime,
  closeTime,
  plan,
  ownerName,
  ownerEmail,
  password
} = req.body;
const hashedPassword = await bcrypt.hash(password, 10)
const planMap = {
  starter: "STARTER_PLAN_UUID",
  growth: "GROWTH_PLAN_UUID",
  premium: "PREMIUM_PLAN_UUID"
};

const planId = planMap[plan];

if (!planId) {
  return res.status(400).json({ error: "Invalid plan selected" });
}

    // 1️⃣ Create client
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .insert({
        business_name: businessName,
        email: businessEmail,
        phone: businessPhone,
        credits_remaining: 20, // 👈 free credits
        status: "active",
        ownerName:ownerName,
        ownerEmail:ownerEmail,  
        password: hashedPassword,
        receptionist_mode: receptionistMode,
      })
      .select()
      .single();

    if (clientError) throw clientError;

    // 2️⃣ Save settings
    const { error: settingsError } = await supabase
      .from("client_settings")
      .insert({
        client_id: client.id,
        receptionist_mode: receptionistMode,
        business_name: businessName,
        greeting: greetingMessage,
        businessAddress: businessAddress,
        open_hour: openTime,
        close_hour: closeTime,
        businessType:businessType,
        // ownerName:ownerName,
        email:ownerEmail,  
        plan:plan
      });

    if (settingsError) throw settingsError;

    // 3️⃣ (Optional) assign Telnyx number
    const telnyxNumber = "+12014621533"; // demo

    const { error: numberError } = await supabase
      .from("client_numbers")
      .insert({
        client_id: client.id,
        telnyx_number: telnyxNumber
      });

    if (numberError) throw numberError;

    res.json({
      success: true,
      clientId: client.id
    });

  } catch (error) {
  console.error("❌ FULL ERROR:", error); // 👈 IMPORTANT

  return res.status(500).json({
    error: error.message // 👈 send real error to frontend
  });
}
});

export default router;