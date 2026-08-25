import express from "express";
import axios from "axios";
import { requireAuth } from "../middleware/auth.js";
import { supabase } from "../config/supabase.js";

const router = express.Router();

router.get("/calls/:clientId", requireAuth, async (req, res) => {
  try {
    const { clientId } = req.params;

    const response = await axios.get(
      "https://api.retellai.com/v2/list-calls",
      {
        headers: {
          Authorization: `Bearer ${process.env.RETELL_API_KEY}`
        }
      }
    );

    // 🔥 THIS IS WHERE YOUR CODE GOES
    const callsForBusiness = response.data.calls.filter(call => {
      return call.metadata?.clientId === clientId;
    });

    res.json(callsForBusiness);

  } catch (err) {
    console.error("❌ Failed to fetch calls:", err);
    res.status(500).json({ error: "Failed to fetch calls" });
  }
});

router.post("/calls/outbound", requireAuth, async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("*")
      .eq("user_id", req.user.id)
      .single();

    if (clientError) throw clientError;

    const { data: numberRow, error: numberError } = await supabase
      .from("client_numbers")
      .select("*")
      .eq("client_id", client.id)
      .limit(1)
      .maybeSingle();

    if (numberError) throw numberError;

    if (!numberRow?.telnyx_number) {
      return res.status(400).json({
        error: "No business phone number assigned to this client"
      });
    }

    const response = await axios.post(
      "https://api.retellai.com/v2/create-phone-call",
      {
        from_number: numberRow.telnyx_number,
        to_number: to,
        override_agent_id: process.env.RETELL_AGENT_ID,
        metadata: {
          clientId: client.id,
          userId: req.user.id,
          source: "dashboard_dialer"
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return res.json({
      success: true,
      message: "Outbound AI call started",
      call: response.data
    });
  } catch (err) {
    console.error("❌ Outbound Retell call error:", err.response?.data || err);
    return res.status(500).json({
      error: err.response?.data?.message || err.message
    });
  }
});

export default router;