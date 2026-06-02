import { createBillingTransaction } from "../service/billingTransaction.js";
import express from "express";
import { supabase } from "../../config/supabase.js";
import {
  deductCreditsAtomic,
  pauseClientIfLowCredits
} from "../service/credit.js";

const router = express.Router();

const MIN_CALL_CREDITS = 1;
const MIN_START_CREDITS = 100;
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

function getRecordingUrl(call) {
  return (
    call?.recording_url ||
    call?.recordingUrl ||
    call?.recording?.url ||
    call?.recording?.recording_url ||
    null
  );
}

function getCallerPhone(call) {
  return (
    call?.from_number ||
    call?.fromNumber ||
    call?.caller_number ||
    call?.callerPhone ||
    null
  );
}

function getTranscript(call) {
  return call?.transcript || null;
}

function getCallSummary(call) {
  return (
    call?.call_analysis?.call_summary ||
    call?.callAnalysis?.callSummary ||
    call?.call_summary ||
    null
  );
}

function getSentiment(call) {
  return (
    call?.call_analysis?.user_sentiment ||
    call?.callAnalysis?.userSentiment ||
    call?.sentiment ||
    null
  );
}

function calculateCreditsFromCost(callCost) {
  return Math.max(MIN_CALL_CREDITS, Math.ceil(callCost * CREDIT_MULTIPLIER));
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

    // ✅ SAVE ANALYSIS DATA WHEN AVAILABLE
    if (eventType === "call_analyzed") {
      const durationSeconds = getDurationSeconds(call);

      const { error } = await supabase
        .from("retell_call_logs")
        .update({
          transcript: getTranscript(call),

          transcript_object:
            call?.transcript_object || [],

          transcript_with_tool_calls:
            call?.transcript_with_tool_calls || [],

          recording_url: getRecordingUrl(call),
          call_summary: getCallSummary(call),
          sentiment: getSentiment(call),

          caller_phone: getCallerPhone(call),

          duration_ms:
            call?.duration_ms ||
            call?.durationMs ||
            durationSeconds * 1000 ||
            0,

          duration_minutes:
            durationSeconds > 0
              ? Math.ceil(durationSeconds / 60)
              : 0,

          disconnection_reason:
            call?.disconnection_reason || null,

          call_status:
            call?.call_status ||
            call?.status ||
            eventType,

          raw_payload: event,
          transcript_object: call?.transcript_object || [],
          transcript_with_tool_calls: call?.transcript_with_tool_calls || [],
        })
        .eq("retell_call_id", retellCallId);

      if (error) {
        console.log("❌ Failed to update transcript/recording:", error);
        throw error;
      }

      console.log("📝 Transcript + recording saved:", {
        retellCallId,
        recording: getRecordingUrl(call),
        sentiment: getSentiment(call)
      });
      console.log("FROM:", call?.from_number);
      console.log("TO:", call?.to_number);


      console.log(
        "TRANSCRIPT OBJECT:",
        JSON.stringify(call?.transcript_object, null, 2)
      );

      console.log(
        "TRANSCRIPT WITH TOOLS:",
        JSON.stringify(call?.transcript_with_tool_calls, null, 2)
      );


      return res.json({ success: true });
    }

    // ✅ BILL ONLY ON CALL ENDED
    if (eventType !== "call_ended") {
      return res.json({ received: true });
    }

    let clientId = call?.metadata?.clientId;

    if (!clientId) {
      const businessNumber =
        call?.to_number ||
        call?.toNumber ||
        call?.from_number ||
        call?.fromNumber;

      const { data: numberRow, error } = await supabase
        .from("client_numbers")
        .select("client_id")
        .eq("telnyx_number", businessNumber)
        .maybeSingle();

      if (error) throw error;

      clientId = numberRow?.client_id;
    }

    if (!clientId) {
      console.log("❌ Missing clientId");
      return res.json({ received: true });
    }

    const recoveryId = call?.metadata?.recoveryId || null;

    const { data: existing, error: existingError } = await supabase
      .from("retell_call_logs")
      .select("id")
      .eq("retell_call_id", retellCallId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      console.log("⛔ Already billed, updating latest call data:", retellCallId);

      await supabase
        .from("retell_call_logs")
        .update({
          transcript: getTranscript(call),
          recording_url: getRecordingUrl(call),
          call_summary: getCallSummary(call),
          sentiment: getSentiment(call),
          caller_phone: getCallerPhone(call),
          raw_payload: event
        })
        .eq("retell_call_id", retellCallId);

      return res.json({ received: true });
    }

    const callCost = getCallCost(call);
    const durationSeconds = getDurationSeconds(call);
    const durationMinutes =
      durationSeconds > 0 ? Math.ceil(durationSeconds / 60) : 0;

    const failedReasons = ["dial_busy", "dial_no_answer", "dial_failed"];

    if (
      durationSeconds === 0 ||
      callCost === 0 ||
      failedReasons.includes(call?.disconnection_reason)
    ) {
      console.log("⛔ Skipping billing for failed call:", {
        retellCallId,
        callCost
      });

      await supabase.from("retell_call_logs").insert({
        client_id: clientId,
        recovery_id: recoveryId,
        retell_call_id: retellCallId,

        caller_phone: getCallerPhone(call),
        direction: call?.direction || null,

        duration_ms: durationSeconds * 1000,
        duration_minutes: durationMinutes,

        transcript: getTranscript(call),
        recording_url: getRecordingUrl(call),
        call_summary: getCallSummary(call),
        sentiment: getSentiment(call),

        disconnection_reason: call?.disconnection_reason || null,
        call_status: call?.call_status || call?.status || eventType,

        credits_deducted: 0,
        call_cost: callCost,
        raw_payload: event
      });

      return res.json({ success: true });
    }

    const creditsToDeduct = calculateCreditsFromCost(callCost);

    console.log("💳 Billing:", {
      clientId,
      retellCallId,
      callCost,
      creditsToDeduct
    });

    const deducted = await deductCreditsAtomic({
      clientId,
      amount: creditsToDeduct,
      description: `Retell call billing ($${callCost})`,
      callCost,
      callDuration: durationSeconds
    });

    const { data: latestClient, error: balanceError } = await supabase
      .from("clients")
      .select("credits_remaining")
      .eq("id", clientId)
      .single();

    if (balanceError) throw balanceError;

    await createBillingTransaction({
      clientId,
      type: "usage",
      description: `AI minutes consumed (${durationMinutes} min)`,
      amount: -Number(callCost || 0),
      balanceAfter: Number(latestClient?.credits_remaining || 0),
      minutes: durationMinutes,
      reference: retellCallId
    });

    await pauseClientIfLowCredits(clientId, MIN_START_CREDITS);

    const { error: logError } = await supabase
      .from("retell_call_logs")
      .insert({
        client_id: clientId,
        recovery_id: recoveryId,
        retell_call_id: retellCallId,

        caller_phone: getCallerPhone(call),
        direction: call?.direction || null,

        duration_ms: durationSeconds * 1000,
        duration_minutes: durationMinutes,

        transcript: getTranscript(call),
        recording_url: getRecordingUrl(call),
        call_summary: getCallSummary(call),
        sentiment: getSentiment(call),

        disconnection_reason: call?.disconnection_reason || null,
        call_status: call?.call_status || call?.status || eventType,

        credits_deducted: deducted ? creditsToDeduct : 0,
        call_cost: callCost,
        raw_payload: event,
        transcript_object: call?.transcript_object || [],
        transcript_with_tool_calls: call?.transcript_with_tool_calls || [],
      });

    if (logError) throw logError;

    console.log("✅ Retell call log saved:", {
      retellCallId,
      deducted,
      caller: getCallerPhone(call),
      recording: getRecordingUrl(call)
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Retell webhook error:", err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;