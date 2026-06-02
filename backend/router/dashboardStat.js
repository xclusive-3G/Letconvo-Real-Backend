import express from "express";
import { supabase } from "../../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/me/dashboard-stats", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (clientError) throw clientError;

    const { data: calls, error: callsError } = await supabase
      .from("retell_call_logs")
      .select("*")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });

    if (callsError) throw callsError;

    const today = new Date().toISOString().slice(0, 10);

    const callsToday = calls.filter(call =>
      call.created_at?.startsWith(today)
    );

    const totalCreditsUsed = calls.reduce(
      (sum, call) => sum + Number(call.credits_deducted || 0),
      0
    );

    const totalCost = calls.reduce(
      (sum, call) => sum + Number(call.call_cost || 0),
      0
    );

    return res.json({
      success: true,
      stats: {
        callsToday: callsToday.length,
        totalCalls: calls.length,
        liveCalls: 0,
        creditsRemaining: client.credits_remaining,
        creditsUsed: totalCreditsUsed,
        totalCost: Number(totalCost.toFixed(2)),
        status: client.status,
        receptionistMode: client.receptionist_mode
      },
      recentCalls: calls.slice(0, 5)
    });
  } catch (err) {
    console.error("❌ Dashboard stats error:", err);
    return res.status(500).json({ error: err.message });
  }
});