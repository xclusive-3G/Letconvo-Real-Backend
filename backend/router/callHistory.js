import express from "express";
import { supabase } from "../../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import e from "express";
const router = express.Router();


router.get("/me/calls", requireAuth, async (req, res) => {
  const userId = req.user.id;

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", userId)
    .single();

  if (clientError) throw clientError;

  const { data: calls, error: callsError } = await supabase
    .from("retell_call_logs")
    .select("*")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false });

  if (callsError) throw callsError;

  const uniqueCallers = new Set(
    calls.map(c => c.caller_phone).filter(Boolean)
  ).size;

  res.json({
    success: true,
    totalCalls: calls.length,
    uniqueCallers,
    calls
  });
});

export default router;