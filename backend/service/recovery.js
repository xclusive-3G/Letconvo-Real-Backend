import { env } from "../../config/config.js";
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
import { deductCreditsAtomic, pauseClientIfLowCredits } from "./credit.js";

// const MIN_CALL_CREDITS = 5;

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
    await sendMissedCallSms(recovery.callerPhone);

    await updateRecovery(recovery.id, {
      smsSent: true,
      status: "sms_sent"
    });
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

  // Reserve minimum credits BEFORE Retell call
  const reserved = await deductCreditsAtomic({
    clientId: recovery.clientId,
    recoveryId: recovery.id,
    // amount: MIN_CALL_CREDITS,
    description: "AI callback minimum reservation"
  });

  if (!reserved) {
    await updateRecovery(recovery.id, {
      status: "insufficient_credits",
      callbackStatus: "blocked_no_minimum_credits"
    });

    console.log("❌ Not enough credits. Retell call blocked.");
    return null;
  }

  await pauseClientIfLowCredits(recovery.clientId, MIN_START_CREDITS);

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