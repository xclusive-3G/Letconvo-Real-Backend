import express from "express";
import { supabase } from "../../config/supabase.js";
import { createBillingTransaction } from "../service/billingTransaction.js";
import {
  deductCreditsAtomic,
  pauseClientIfLowCredits
} from "../service/credit.js";

import { liveCalls } from "../utils/liveCallsStore.js";

// import {
//   addLiveCall,
//   removeLiveCall
// } from "../services/liveCalls.js";



const router = express.Router();

const MIN_CALL_CREDITS = 1;
const MIN_START_CREDITS = 100;
const CREDIT_MULTIPLIER = 100;

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

function getBusinessNumber(call) {
  return call?.to_number || call?.toNumber || null;
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
  return Math.max(
    MIN_CALL_CREDITS,
    Math.ceil(callCost * CREDIT_MULTIPLIER)
  );
}

async function resolveClientId(call) {
  let clientId = call?.metadata?.clientId;

  if (clientId) return clientId;

  const possibleNumbers = [
    call?.to_number,
    call?.toNumber,
    call?.from_number,
    call?.fromNumber
  ].filter(Boolean);

  for (const number of possibleNumbers) {
    const { data, error } = await supabase
      .from("client_numbers")
      .select("client_id")
      .eq("telnyx_number", number)
      .maybeSingle();

    if (error) throw error;
    if (data?.client_id) return data.client_id;
  }

  return null;
}

router.post("/retell/webhook", async (req, res) => {
  try {
    const event = req.body;
    const eventType = event.event || event.event_type;
    const call = event.call || event.data || event;

    console.log("🔥 RETELL WEBHOOK HIT:", eventType);

    const retellCallId = call?.call_id || call?.callId;

    if (!retellCallId) {
      console.log("❌ Missing retellCallId");
      return res.status(200).json({ received: true });
    }

    const clientId = await resolveClientId(call);

    if (!clientId) {
      console.log("❌ Missing clientId for call:", retellCallId);
      return res.status(200).json({ received: true });
    }

    if (
  eventType === "call_started" ||
  eventType === "call_initiated" ||
  eventType === "call_created"
) {
  // await addLiveCall({
  //   callId: retellCallId,
  //   clientId,

  //   caller: getCallerPhone(call) || "Unknown caller",
  //   businessNumber: getBusinessNumber(call),

  //   provider: "retell",
  //   startedAt: Date.now()
  // });

  // console.log("📞 Active caller added:", {
  //   retellCallId,
  //   clientId,
  //   caller: getCallerPhone(call)
  // });

  liveCalls.set(retellCallId, {
    callId: retellCallId,
    clientId,
    caller: getCallerPhone(call),
    businessNumber: getBusinessNumber(call),
    startedAt: Date.now()
  });

  console.log("📞 Active callers:", liveCalls.size);

  return res.json({ success: true });

  // return res.status(200).json({ success: true });
}



    if (
      eventType === "transcript_updated" ||
      eventType === "transcript_update"
    ) {
      const transcriptObject =
        call?.transcript_object ||
        event?.transcript_object ||
        [];

      await supabase
        .from("active_calls")
        .update({
          transcript: transcriptObject,
          updated_at: new Date().toISOString()
        })
        .eq("call_id", retellCallId);

      console.log("🟢 Live transcript updated:", retellCallId);

      return res.status(200).json({ success: true });
    }

    if (eventType === "call_analyzed") {
      const durationSeconds = getDurationSeconds(call);

      const { error } = await supabase
        .from("retell_call_logs")
        .update({
          transcript: getTranscript(call),
          transcript_object: call?.transcript_object || [],
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
          raw_payload: event
        })
        .eq("retell_call_id", retellCallId);

      if (error) throw error;

      await supabase
        .from("active_calls")
        .delete()
        .eq("call_id", retellCallId);

      console.log("📝 Transcript + recording saved:", retellCallId);

      return res.status(200).json({ success: true });
    }

    if (eventType !== "call_ended") {
      return res.status(200).json({ received: true });
    }
    if (eventType === "call_ended") {

  liveCalls.delete(retellCallId);

  console.log("☎️ Active callers:", liveCalls.size);

  // Continue billing...
}

    const metadata =
  req.body.call?.metadata || {};

// // await removeLiveCall(
//   metadata.clientId,
//   req.body.call.call_id
// );
if (eventType === "call_ended") {

  liveCalls.delete(retellCallId);

  console.log("☎️ Active callers:", liveCalls.size);

  // Continue billing...
}

console.log(
  "☎️ Active caller removed"
);

    await supabase
      .from("active_calls")
      .delete()
      .eq("call_id", retellCallId);

    const recoveryId = call?.metadata?.recoveryId || null;

    const { data: existing, error: existingError } = await supabase
      .from("retell_call_logs")
      .select("id")
      .eq("retell_call_id", retellCallId)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      await supabase
        .from("retell_call_logs")
        .update({
          transcript: getTranscript(call),
          transcript_object: call?.transcript_object || [],
          transcript_with_tool_calls:
            call?.transcript_with_tool_calls || [],
          recording_url: getRecordingUrl(call),
          call_summary: getCallSummary(call),
          sentiment: getSentiment(call),
          caller_phone: getCallerPhone(call),
          raw_payload: event
        })
        .eq("retell_call_id", retellCallId);

      console.log("⛔ Already billed, updated call:", retellCallId);

      return res.status(200).json({ received: true });
    }

    const callCost = getCallCost(call);
    const durationSeconds = getDurationSeconds(call);
    const durationMinutes =
      durationSeconds > 0 ? Math.ceil(durationSeconds / 60) : 0;

    const failedReasons = [
      "dial_busy",
      "dial_no_answer",
      "dial_failed"
    ];

    if (
      durationSeconds === 0 ||
      callCost === 0 ||
      failedReasons.includes(call?.disconnection_reason)
    ) {
      await supabase.from("retell_call_logs").insert({
        client_id: clientId,
        recovery_id: recoveryId,
        retell_call_id: retellCallId,
        caller_phone: getCallerPhone(call),
        direction: call?.direction || null,
        duration_ms: durationSeconds * 1000,
        duration_minutes: durationMinutes,
        transcript: getTranscript(call),
        transcript_object: call?.transcript_object || [],
        transcript_with_tool_calls:
          call?.transcript_with_tool_calls || [],
        recording_url: getRecordingUrl(call),
        call_summary: getCallSummary(call),
        sentiment: getSentiment(call),
        disconnection_reason:
          call?.disconnection_reason || null,
        call_status:
          call?.call_status ||
          call?.status ||
          eventType,
        credits_deducted: 0,
        call_cost: callCost,
        raw_payload: event
      });

      console.log("⛔ Failed call saved without billing:", retellCallId);

      return res.status(200).json({ success: true });
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
        transcript_object: call?.transcript_object || [],
        transcript_with_tool_calls:
          call?.transcript_with_tool_calls || [],
        recording_url: getRecordingUrl(call),
        call_summary: getCallSummary(call),
        sentiment: getSentiment(call),
        disconnection_reason:
          call?.disconnection_reason || null,
        call_status:
          call?.call_status ||
          call?.status ||
          eventType,
        credits_deducted: deducted ? creditsToDeduct : 0,
        call_cost: callCost,
        raw_payload: event
      });

    if (logError) throw logError;

    console.log("✅ Retell call log saved:", {
      retellCallId,
      deducted,
      caller: getCallerPhone(call),
      recording: getRecordingUrl(call)
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ Retell webhook error:", err);

    if (!res.headersSent) {
      return res.status(500).json({
        error: err.message
      });
    }
  }
});

export default router;