import express from "express";
import axios from "axios";
import { triggerMissedCallRecovery } from "../service/recovery.js";
import { getClientByTelnyxNumber } from "../service/credit.js";
import { logger } from "../utils/logger.js";
import { supabase } from "../../config/supabase.js";
import { createRetellLiveCall } from "../service/retell.js";

const router = express.Router();

const MIN_START_CREDITS = 100; // block live/callback if client has less than this

async function hangupCall(callControlId) {
  await axios.post(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`,
    {},
    {
      headers: {
        Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );
}

router.post("/telnyx/voice", async (req, res) => {
  res.sendStatus(200);

  try {
    const eventType = req.body?.data?.event_type;
    const payload = req.body?.data?.payload;

    const callerPhone = payload?.from;
    const to = payload?.to;
    const callControlId = payload?.call_control_id;
    const direction = payload?.direction;

    logger.info("Telnyx voice webhook", {
      eventType,
      callerPhone,
      to,
      callControlId,
      direction
    });

    if (eventType !== "call.initiated") return;

    if (direction !== "incoming") {
      console.log("⛔ Ignoring non-incoming call:", {
        from: callerPhone,
        to,
        direction
      });
      return;
    }

    const client = await getClientByTelnyxNumber(to);

    if (!client) {
      console.log("❌ No client found for number:", to);
      await hangupCall(callControlId);
      return;
    }

    // ✅ BLOCK BEFORE RETELL OR CALLBACK STARTS
    if (
      client.status !== "active" ||
      Number(client.credits_remaining || 0) < MIN_START_CREDITS
    ) {
      console.log("❌ Client blocked before Retell starts:", {
        clientId: client.id,
        businessName: client.business_name,
        credits: client.credits_remaining,
        status: client.status
      });
      await supabase
        .from("clients")
        .update({ status: "paused" })
        .eq("id", client.id);

      try {
        await hangupCall(callControlId);
        console.log("✅ Call terminated successfully");
      } catch (err) {
        console.log("❌ Hangup failed:", err.response?.data || err.message);
      }

      return;
    }

    if (client.receptionist_mode === "live") {
      console.log("☎️ LIVE MODE → calling Retell immediately");

      const { data: settings, error } = await supabase
        .from("client_settings")
        .select("retell_agent_id, retell_from_number")
        .eq("client_id", client.id)
        .maybeSingle();

      if (error) {
        console.log("❌ Error fetching client settings:", error.message);
        await hangupCall(callControlId);
        return;
      }

      if (!settings?.retell_agent_id || !settings?.retell_from_number) {
        console.log("❌ Missing agent or number for client:", client.id);
        await hangupCall(callControlId);
        return;
      }

      await createRetellLiveCall({
        toNumber: callerPhone.trim(),
        clientId: client.id,
        agentId: settings.retell_agent_id.trim(),
        fromNumber: settings.retell_from_number.trim()
      });

      return;
    }

    console.log("📞 CALLBACK MODE → queuing missed-call recovery");

    await triggerMissedCallRecovery({
      clientId: client.id,
      callerPhone,
      forwardedToNumber: to,
      telnyxCallControlId: callControlId
    });
  } catch (err) {
    logger.error("Error handling Telnyx voice webhook", err);
  }
});

export default router;