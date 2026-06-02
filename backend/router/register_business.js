import express from "express";
import { supabase } from "../../config/supabase.js";

const router = express.Router();

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

    if (!ownerEmail || !password) {
      return res.status(400).json({ error: "Owner email and password are required" });
    }

    // 1. Check if client already exists
    const { data: existingClient, error: existingError } = await supabase
      .from("clients")
      .select("*")
      .eq("ownerEmail", ownerEmail)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existingClient) {
      return res.status(409).json({
        error: "Business account already exists. Please login instead."
      });
    }

    // 2. Create Supabase Auth user from backend
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email: ownerEmail,
        password,
        email_confirm: true
      });

    if (authError) throw authError;

    const user = authData.user;

    if (!user?.id) {
      return res.status(500).json({ error: "Failed to create auth user" });
    }

    const { data: selectedPlan, error: planError } = await supabase
      .from("plans")
      .select("id, monthly_credits, min_start_credits")
      .eq("slug", plan)
      .eq("is_active", true)
      .single();

    if (planError || !selectedPlan) {
      return res.status(400).json({ error: "Invalid plan selected" });
    }

    // 3. Create client row
    const { data: client, error: clientError } = await supabase
      .from("clients")
      .insert({
        user_id: user.id,
        business_name: businessName,
        email: businessEmail,
        phone: businessPhone,
        credits_remaining: selectedPlan.monthly_credits,
        status: "active",
        ownerName,
        ownerEmail,
        receptionist_mode: receptionistMode,
        plan_id: selectedPlan.id
      })
      .select()
      .single();

    if (clientError) throw clientError;

    // 4. Create client settings
    const { error: settingsError } = await supabase
      .from("client_settings")
      .insert({
        client_id: client.id,
        receptionist_mode: receptionistMode,
        business_name: businessName,
        greeting: greetingMessage,
        businessAddress,
        open_hour: openTime,
        close_hour: closeTime,
        businessType,
        email: ownerEmail,
        plan
      });

    if (settingsError) throw settingsError;

    // // 5. Assign demo Telnyx number
    // const telnyxNumber = NULL;

    // const { error: numberError } = await supabase
    //   .from("client_numbers")
    //   .insert({
    //     client_id: client.id,
    //     telnyx_number: telnyxNumber
    //   });

    // if (numberError) throw numberError;

    // 6. Login user after registration
    const { data: loginData, error: loginError } =
      await supabase.auth.signInWithPassword({
        email: ownerEmail,
        password
      });

    if (loginError) throw loginError;

    return res.json({
      success: true,
      clientId: client.id,
      user,
      access_token: loginData.session.access_token
    });
  } catch (error) {
    console.error("❌ FULL ERROR:", error);

    return res.status(500).json({
      error: error.message
    });
  }
});

export default router;