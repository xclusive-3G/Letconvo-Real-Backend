import { supabase } from "../config/supabase.js";
import { createBillingTransaction } from "./billingTransaction.js";
import { deductCreditsAtomic, pauseClientIfLowCredits } from "./credit.js";
import { createNotification } from "../utils/createNotification.js";

const MIN_CALL_CREDITS = 1;
const MIN_START_CREDITS = 0;
const CREDIT_MULTIPLIER = 100;

function getCallCost(call) {
  return Number(call?.call_cost?.combined_cost ?? call?.callCost?.combinedCost ?? 0);
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
  return call?.recording_url || call?.recordingUrl || call?.recording?.url || call?.recording?.recording_url || null;
}

function getCallerPhone(call) {
  return call?.from_number || call?.fromNumber || call?.caller_number || call?.callerPhone || null;
}

function getTranscript(call) {
  return call?.transcript || null;
}

function getCallSummary(call) {
  return call?.call_analysis?.call_summary || call?.callAnalysis?.callSummary || call?.call_summary || null;
}

function getSentiment(call) {
  return call?.call_analysis?.user_sentiment || call?.callAnalysis?.userSentiment || call?.sentiment || null;
}

function calculateCreditsFromCost(callCost) {
  return Math.max(MIN_CALL_CREDITS, Math.ceil(callCost * CREDIT_MULTIPLIER));
}

// Shared by the live Retell webhook (call_ended) and the reconciliation job —
// both need the exact same billing/logging behavior for a finished call, and
// both are safe to call more than once for the same call (idempotent via the
// retell_call_id existence check).
export async function processCompletedCall({ call, clientId, rawEvent }) {
  const retellCallId = call?.call_id || call?.callId;
  if (!retellCallId || !clientId) return { processed: false, reason: "missing retellCallId or clientId" };

  const { data: existing, error: existingError } = await supabase
    .from("retell_call_logs")
    .select("id")
    .eq("retell_call_id", retellCallId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return { processed: false, reason: "already logged" };

  const recoveryId = call?.metadata?.recoveryId || null;
  const callCost = getCallCost(call);
  const durationSeconds = getDurationSeconds(call);
  const durationMinutes = durationSeconds > 0 ? Math.ceil(durationSeconds / 60) : 0;

  // When this runs via reconciliation (backfilling calls Retell's webhook
  // never delivered), letting the DB default created_at to "now" would make
  // old calls show up as today's — use the call's own start time instead.
  const occurredAt = call?.start_timestamp
    ? new Date(call.start_timestamp).toISOString()
    : call?.startTimestamp
      ? new Date(call.startTimestamp).toISOString()
      : undefined;

  const failedReasons = ["dial_busy", "dial_no_answer", "dial_failed"];

  if (durationSeconds === 0 || callCost === 0 || failedReasons.includes(call?.disconnection_reason)) {
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
      transcript_with_tool_calls: call?.transcript_with_tool_calls || [],
      recording_url: getRecordingUrl(call),
      call_summary: getCallSummary(call),
      sentiment: getSentiment(call),
      disconnection_reason: call?.disconnection_reason || null,
      call_status: call?.call_status || call?.status || "call_ended",
      credits_deducted: 0,
      call_cost: callCost,
      raw_payload: rawEvent || { call },
      ...(occurredAt ? { created_at: occurredAt } : {})
    });

    if (failedReasons.includes(call?.disconnection_reason)) {
      await createNotification({
        clientId,
        title: "Missed call",
        message: `Missed call from ${getCallerPhone(call) || "unknown number"}`,
        type: "call"
      });
    }

    return { processed: true, billed: false };
  }

  const creditsToDeduct = calculateCreditsFromCost(callCost);

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

  const { error: logError } = await supabase.from("retell_call_logs").insert({
    client_id: clientId,
    recovery_id: recoveryId,
    retell_call_id: retellCallId,
    caller_phone: getCallerPhone(call),
    direction: call?.direction || null,
    duration_ms: durationSeconds * 1000,
    duration_minutes: durationMinutes,
    transcript: getTranscript(call),
    transcript_object: call?.transcript_object || [],
    transcript_with_tool_calls: call?.transcript_with_tool_calls || [],
    recording_url: getRecordingUrl(call),
    call_summary: getCallSummary(call),
    sentiment: getSentiment(call),
    disconnection_reason: call?.disconnection_reason || null,
    call_status: call?.call_status || call?.status || "call_ended",
    credits_deducted: deducted ? creditsToDeduct : 0,
    call_cost: callCost,
    raw_payload: rawEvent || { call },
    ...(occurredAt ? { created_at: occurredAt } : {})
  });

  if (logError) throw logError;

  await createNotification({
    clientId,
    title: "Call completed",
    message: `${getCallerPhone(call) || "Unknown caller"} · ${durationMinutes} min`,
    type: "call"
  });

  return { processed: true, billed: deducted };
}
