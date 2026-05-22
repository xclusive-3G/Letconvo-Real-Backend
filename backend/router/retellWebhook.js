import express from "express";
import { supabase } from "../../config/supabase.js";
import {
  deductCreditsAtomic,
  pauseClientIfLowCredits
} from "../service/credit.js";

const router = express.Router();

const MIN_CALL_CREDITS = 1;
const CREDIT_MULTIPLIER = 100; // $0.01 = 1 credit

function getCallCost(call) {
  return Number(
    call?.call_cost?.combined_cost ??
    call?.callCost?.combinedCost ??
    0
  );
}

function getDurationSeconds(call) {
  return Number(
    call?.call_cost?.total_duration_seconds ??
    call?.callCost?.totalDurationSeconds ??
    call?.duration_seconds ??
    call?.durationSeconds ??
    0
  );
}

function calculateCreditsFromCost(callCost) {
  return Math.max(
    MIN_CALL_CREDITS,
    Math.ceil(callCost * CREDIT_MULTIPLIER)
  );
}

router.post("/retell/webhook", async (req, res) => {
  try {
    console.log("🔥 RETELL WEBHOOK HIT");
    console.log(JSON.stringify(req.body, null, 2));

    const event = req.body;
    const eventType = event.event || event.event_type;
    const call = event.call || event.data || event;

    const retellCallId = call?.call_id || call?.callId;

    if (!retellCallId) {
      console.log("❌ Missing retellCallId");
      return res.json({ received: true });
    }

    // ✅ call_analyzed: update transcript + recording only
    if (eventType === "call_analyzed") {
      const { error } = await supabase
        .from("retell_call_logs")
        .update({
          transcript: call?.transcript || null,
          recording_url: call?.recording_url || call?.recordingUrl || null,
          duration_ms: call?.duration_ms || 0,
          duration_minutes: Math.ceil((call?.duration_ms || 0) / 60000),
          disconnection_reason: call?.disconnection_reason || null,
          call_status: call?.call_status || null,
          raw_payload: event
        })
        .eq("retell_call_id", retellCallId);

      if (error) {
        console.log("❌ Failed to update transcript:", error);
        throw error;
      }

      console.log("📝 Transcript + recording saved:", retellCallId);
      return res.json({ success: true });
    }

    // ✅ call_ended: billing only
    if (eventType !== "call_ended") {
      return res.json({ received: true });
    }

    const clientId = call?.metadata?.clientId;
    const recoveryId = call?.metadata?.recoveryId || null;

    if (!clientId) {
      console.log("❌ Missing clientId");
      return res.json({ received: true });
    }

    // Prevent duplicate billing
    const { data: existing, error: existingError } = await supabase
      .from("retell_call_logs")
      .select("id")
      .eq("retell_call_id", retellCallId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      console.log("⛔ Already billed, skipping:", retellCallId);
      return res.json({ received: true });
    }

    const callCost = getCallCost(call);
    const durationSeconds = getDurationSeconds(call);
    const durationMinutes =
      durationSeconds > 0 ? Math.ceil(durationSeconds / 60) : 0;

    // Do not charge failed/no-answer calls
    const failedReasons = ["dial_busy", "dial_no_answer", "dial_failed"];

    if (
      durationSeconds === 0 ||
      callCost === 0 ||
      failedReasons.includes(call?.disconnection_reason)
    ) {
      console.log("⛔ Skipping billing for failed call:", {
        retellCallId,
        disconnectionReason: call?.disconnection_reason,
        durationSeconds,
        callCost
      });

      const { error: failedLogError } = await supabase
        .from("retell_call_logs")
        .insert({
          client_id: clientId,
          recovery_id: recoveryId,
          retell_call_id: retellCallId,

          caller_phone: call?.to_number || call?.toNumber || call?.from_number,
          direction: call?.direction || null,

          duration_ms: durationSeconds * 1000,
          duration_minutes: durationMinutes,

          transcript: call?.transcript || null,
          recording_url: call?.recording_url || call?.recordingUrl || null,

          disconnection_reason: call?.disconnection_reason || null,
          call_status: call?.call_status || call?.status || eventType,

          reserved_credits: 0,
          final_credits: 0,
          extra_credits_deducted: 0,
          credits_deducted: 0,

          call_cost: callCost,
          raw_payload: event
        });

      if (failedLogError) throw failedLogError;

      return res.json({ success: true });
    }

    const creditsToDeduct = calculateCreditsFromCost(callCost);

    console.log("💳 Billing:", {
      clientId,
      recoveryId,
      retellCallId,
      callCost,
      durationSeconds,
      creditsToDeduct
    });

    const deducted = await deductCreditsAtomic({
      clientId,
      amount: creditsToDeduct,
      description: `Retell call billing ($${callCost})`,
      callCost,
      callDuration: durationSeconds
    });

    console.log("💳 deducted result:", deducted);

    await pauseClientIfLowCredits(clientId, MIN_START_CREDITS);

    const { error: logError } = await supabase
      .from("retell_call_logs")
      .insert({
        client_id: clientId,
        recovery_id: recoveryId,
        retell_call_id: retellCallId,

        caller_phone: call?.to_number || call?.toNumber || call?.from_number,
        direction: call?.direction || null,

        duration_ms: durationSeconds * 1000,
        duration_minutes: durationMinutes,

        transcript: call?.transcript || null,
        recording_url: call?.recording_url || call?.recordingUrl || null,

        disconnection_reason: call?.disconnection_reason || null,
        call_status: call?.call_status || call?.status || eventType,

        reserved_credits: 0,
        final_credits: creditsToDeduct,
        extra_credits_deducted: 0,
        credits_deducted: deducted ? creditsToDeduct : 0,

        call_cost: callCost,
        raw_payload: event
      });

    if (logError) {
      console.log("❌ Failed to insert retell log:", logError);
      throw logError;
    }

    console.log("✅ Retell call log saved:", {
      retellCallId,
      deducted,
      creditsToDeduct
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Retell webhook error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;