import express from "express";
import { supabase } from "../config/supabase.js";
import { processCompletedCall } from "../service/retellCallProcessor.js";

// import {
//   addLiveCall,
//   removeLiveCall
// } from "../services/liveCalls.js";



const router = express.Router();

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
  const { error: activeCallError } = await supabase
    .from("active_calls")
    .insert({
      client_id: clientId,
      call_id: retellCallId,
      caller_phone: getCallerPhone(call),
      business_number: getBusinessNumber(call),
      provider: "retell",
      status: "active"
    });

  if (activeCallError) {
    console.error("❌ Failed to record active call:", activeCallError);
  }

  console.log("📞 Active caller added:", {
    retellCallId,
    clientId,
    caller: getCallerPhone(call)
  });

  return res.json({ success: true });
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

    console.log("☎️ Active caller removed:", retellCallId);

    await supabase
      .from("active_calls")
      .delete()
      .eq("call_id", retellCallId);

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

    const result = await processCompletedCall({ call, clientId, rawEvent: event });

    console.log("✅ Retell call processed:", { retellCallId, ...result });

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