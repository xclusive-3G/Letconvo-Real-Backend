import { supabase } from "../config/supabase.js";

const MIN_START_CREDITS = 100;

export async function getClientByTelnyxNumber(telnyxNumber) {
  const { data, error } = await supabase
    .from("client_numbers")
    .select(`
      id,
      telnyx_number,
      client:clients (
        id,
        business_name,
        credits_remaining,
        status,
        receptionist_mode,
        plan_id
      )
    `)
    .eq("telnyx_number", telnyxNumber)
    .maybeSingle();

  if (error) throw error;

  return data?.client || null;
}

export async function getClient(clientId) {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function hasEnoughCredits(clientId, requiredCredits) {
  const client = await getClient(clientId);

  if (!client) return false;
  if (client.status !== "active") return false;

  return Number(client.credits_remaining || 0) >= requiredCredits;
}

export async function deductCreditsAtomic({
  clientId,
  amount,
  description,
  callCost = null,
  callDuration = null
}) {
  const { data: client, error: fetchError } = await supabase
    .from("clients")
    .select("id, business_name, credits_remaining, status")
    .eq("id", clientId)
    .single();

  if (fetchError) throw fetchError;

  const currentCredits = Number(client.credits_remaining || 0);

  if (currentCredits < amount) {
    console.log("❌ Not enough credits");

    await pauseClientIfLowCredits(clientId, MIN_START_CREDITS);

    return false;
  }

  const newBalance = currentCredits - amount;

  const { error: updateError } = await supabase
    .from("clients")
    .update({ credits_remaining: newBalance })
    .eq("id", clientId);

  if (updateError) throw updateError;

  const { error: txError } = await supabase
    .from("credit_transactions")
    .insert({
      client_id: clientId,
      amount,
      type: "debit",
      description,
      call_cost: callCost,
      call_duration: callDuration
    });

  if (txError) throw txError;

  console.log("💳 Credits deducted:", {
    amount,
    oldBalance: currentCredits,
    newBalance
  });

  await pauseClientIfLowCredits(clientId, MIN_START_CREDITS);

  return true;
}

export async function deductCredits({
  clientId,
  recoveryId,
  amount,
  description
}) {
  console.warn("⚠️ Using NON-ATOMIC deduction. Use deductCreditsAtomic in production.");

  const client = await getClient(clientId);

  if (!client) {
    throw new Error("Client not found");
  }

  const currentCredits = Number(client.credits_remaining || 0);

  if (currentCredits < amount) {
    await pauseClientIfLowCredits(clientId, MIN_START_CREDITS);
    throw new Error("Insufficient credits");
  }

  const newBalance = currentCredits - amount;

  const { error: updateError } = await supabase
    .from("clients")
    .update({ credits_remaining: newBalance })
    .eq("id", clientId);

  if (updateError) throw updateError;

  const { error: txError } = await supabase
    .from("credit_transactions")
    .insert({
      client_id: clientId,
      recovery_id: recoveryId,
      type: "debit",
      amount,
      description
    });

  if (txError) throw txError;

  await pauseClientIfLowCredits(clientId, MIN_START_CREDITS);

  return newBalance;
}

export async function pauseClientIfLowCredits(clientId, minimumCredits = 100) {
  const { data: client, error: fetchError } = await supabase
    .from("clients")
    .select("id, business_name, credits_remaining, status")
    .eq("id", clientId)
    .single();

  if (fetchError) throw fetchError;

  const credits = Number(client.credits_remaining || 0);

  if (credits <= minimumCredits && client.status !== "paused") {
    const { data, error } = await supabase
      .from("clients")
      .update({ status: "paused" })
      .eq("id", clientId)
      .select("id, business_name, credits_remaining, status")
      .single();

    if (error) throw error;

    console.log("⏸️ CLIENT AUTO-PAUSED:", {
      clientId: data.id,
      businessName: data.business_name,
      credits: data.credits_remaining,
      status: data.status
    });

    return data;
  }

  console.log("✅ Client not paused:", {
    clientId,
    credits,
    minimumCredits,
    status: client.status
  });

  return client;
}

// Backward compatibility for old imports
export const pauseClientIfNoCredits = pauseClientIfLowCredits;

export async function activateClientIfEnoughCredits(clientId, minimumCredits = 100) {
  const { data: client, error } = await supabase
    .from("clients")
    .select("id, credits_remaining, status")
    .eq("id", clientId)
    .single();

  if (error) throw error;

  const credits = Number(client.credits_remaining || 0);

  if (credits > minimumCredits && client.status !== "active") {
    const { error: updateError } = await supabase
      .from("clients")
      .update({ status: "active" })
      .eq("id", clientId);

    if (updateError) throw updateError;

    console.log("🟢 CLIENT RE-ACTIVATED:", {
      clientId,
      credits
    });
  }
}