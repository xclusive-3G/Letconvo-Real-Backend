import { env } from "../config/config.js";
import {
  createRecovery,
  getRecovery,
  hasOptedOut,
  updateRecovery,
  findOrCreateRecovery
} from "../db.js";
import { callbackQueue } from "../queue/callBackQueue.js";
import { createRetellCallback } from "./retell.js";
import { sendMissedCallSms } from "./telnyx.js";
import { deductCreditsAtomic, hasEnoughCredits, pauseClientIfLowCredits, SMS_CREDIT_COST } from "./credit.js";
import { isSmsNotifEnabled } from "../utils/createNotification.js";

function isWithinAllowedHours() {
  const now = new Date();
  const hour = now.getHours();

  return (
    hour >= Number(env.CALLBACK_ALLOWED_START_HOUR) &&
    hour < Number(env.CALLBACK_ALLOWED_END_HOUR)
  );
}

export async function triggerMissedCallRecovery(input) {
  console.log("🔥 Recovery started:", input);

  const recovery = await findOrCreateRecovery(input);
  console.log("✅ Recovery loaded/created:", recovery);

  // 🔥 PREVENT DUPLICATE QUEUE JOBS
  if (recovery.callbackScheduled) {
    console.log("⛔ Callback already scheduled, skipping duplicate");
    return recovery;
  }

  try {
    if (await isSmsNotifEnabled(recovery.clientId)) {
      await sendMissedCallSms(recovery.callerPhone);

      // Charged only after a successful send — a failed send (e.g. no
      // alphanumeric sender ID registered for the destination country)
      // falls through to the catch below and is never billed.
      await deductCreditsAtomic({
        clientId: recovery.clientId,
        amount: SMS_CREDIT_COST,
        description: "Missed-call recovery SMS"
      });

      await updateRecovery(recovery.id, {
        smsSent: true,
        status: "sms_sent"
      });
    } else {
      console.log("🔕 SMS Notifications disabled for this client — skipping missed-call SMS");
    }
  } catch (err) {
    await updateRecovery(recovery.id, {
      smsSent: false,
      status: "sms_failed"
    });

    console.log("⚠️ SMS failed but continuing callback flow");
  }

  console.log("📞 Adding callback job...");

  const job = await callbackQueue.add(
    "callback",
    {
      recoveryId: recovery.id,
      clientId: recovery.clientId,
      callerPhone: recovery.callerPhone
    },
    {
      delay: Number(env.CALLBACK_DELAY_MS || 0),
      attempts: Number(env.MAX_CALLBACK_ATTEMPTS || 3),
      backoff: {
        type: "exponential",
        delay: 60_000
      },
      removeOnComplete: 100,
      removeOnFail: 100,
      jobId: `recovery-${recovery.id}`
    }
  );

  console.log("✅ Callback job queued:", job.id);

  return await updateRecovery(recovery.id, {
    callbackScheduled: true,
    status: "callback_scheduled",
    callbackStatus: `queued-${job.id}`
  });

  // import { supabase } from "../../config/supabase.js";
// 
// ⛔ Prevent spam calls (cooldown 60 seconds)
const { data: recent } = await supabase
  .from("missed_call_recoveries")
  .select("id, created_at")
  .eq("caller_phone", input.callerPhone)
  .gte("created_at", new Date(Date.now() - 60 * 1000).toISOString());

if (recent && recent.length > 0) {
  console.log("⛔ Duplicate call detected (cooldown), skipping");
  return;
}
}

export async function processCallbackJob(recoveryId) {
  console.log("🔍 processCallbackJob started:", recoveryId);

  const recovery = await getRecovery(recoveryId);

  if (!recovery) {
    throw new Error("Recovery not found");
  }

  if (!recovery.clientId) {
    await updateRecovery(recovery.id, {
      status: "missing_client_id",
      callbackStatus: "blocked_missing_client_id"
    });

    return null;
  }

  const optedOut = await hasOptedOut(recovery.callerPhone);

  if (optedOut) {
    await updateRecovery(recovery.id, {
      status: "opted_out",
      callbackStatus: "skipped_opt_out"
    });

    return null;
  }

  if (!isWithinAllowedHours()) {
    await updateRecovery(recovery.id, {
      status: "outside_business_hours",
      callbackStatus: "blocked_outside_hours"
    });

    return null;
  }

  // Affordability check BEFORE placing the Retell call — not a deduction.
  // The real cost is charged after the call ends via
  // retellCallProcessor.js's processCompletedCall (the single shared
  // billing entry point), so deducting anything here too would double-bill.
  // This previously called deductCreditsAtomic with no `amount` (the
  // MIN_CALL_CREDITS reservation was disabled by commenting out the amount
  // line, but the deduction call itself was left in place), which wrote
  // NaN into credits_remaining on every callback attempt.
  // >= 1, not >= 0 — matches the inbound-call gates' <= 0 floor
  // (telnyxVoiceWebhook2.js / retellInboundWebhook.js): a client at
  // exactly 0 credits must not get a callback placed either.
  const reserved = await hasEnoughCredits(recovery.clientId, 1);

  if (!reserved) {
    await updateRecovery(recovery.id, {
      status: "insufficient_credits",
      callbackStatus: "blocked_no_minimum_credits"
    });

    console.log("❌ Not enough credits. Retell call blocked.");
    return null;
  }

  await pauseClientIfLowCredits(recovery.clientId);

  console.log("📞 Calling Retell now...");

  const result = await createRetellCallback({
    toNumber: recovery.callerPhone,
    recoveryId: recovery.id,
    clientId: recovery.clientId
  });

  console.log("✅ Retell result:", result);

  await updateRecovery(recovery.id, {
    callbackAttempts: recovery.callbackAttempts + 1,
    status: "retell_call_started",
    callbackStatus: result?.call_id || result?.callId || "retell_triggered"
  });

  return result;
}