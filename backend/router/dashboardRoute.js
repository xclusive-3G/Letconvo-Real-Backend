import express from "express";
import { supabase } from "../../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (clientError) throw clientError;

    const { data: calls, error: callError } = await supabase
      .from("retell_call_logs")
      .select("*")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });

    if (callError) throw callError;

    res.json({ client, calls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;