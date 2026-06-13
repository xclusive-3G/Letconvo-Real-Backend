import { supabase } from "./config/supabase.js";

/**
 * Normalize DB row → App object
 */
function toAppRecord(row) {
  if (!row) return null;

  return {
    id: row.id,
    clientId: row.client_id, // ✅ VERY IMPORTANT
    callerPhone: row.caller_phone,
    forwardedToNumber: row.forwarded_to_number,
    telnyxCallControlId: row.telnyx_call_control_id,
    status: row.status,
    smsSent: row.sms_sent,
    callbackScheduled: row.callback_scheduled,
    callbackStatus: row.callback_status,
    callbackAttempts: row.callback_attempts || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Opt-out check
 */
export async function hasOptedOut(phone) {
  const { data, error } = await supabase
    .from("sms_opt_outs")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

/**
 * Add opt-out
 */
export async function setOptOut(phone) {
  const { error } = await supabase
    .from("sms_opt_outs")
    .upsert({ phone }, { onConflict: "phone" });

  if (error) throw error;
}

/**
 * Create recovery (STRICT - requires clientId)
 */
export async function createRecovery(input) {
  if (!input.clientId) {
    throw new Error("clientId is required to create recovery");
  }

  const { data, error } = await supabase
    .from("missed_call_recoveries")
    .insert({
      client_id: input.clientId,
      caller_phone: input.callerPhone,
      forwarded_to_number: input.forwardedToNumber,
      telnyx_call_control_id: input.telnyxCallControlId || null,
      status: "missed_triggered",
      sms_sent: false,
      callback_scheduled: false,
      callback_status: null,
      callback_attempts: 0
    })
    .select("*")
    .single();

  if (error) throw error;

  return toAppRecord(data);
}

/**
 * Find existing or create new recovery
 */
export async function findOrCreateRecovery(input) {
  if (!input.clientId) {
    throw new Error("clientId is required");
  }

  // Prevent duplicate webhook processing
  if (input.telnyxCallControlId) {
    const { data: existing, error: existingError } = await supabase
      .from("missed_call_recoveries")
      .select("*")
      .eq("telnyx_call_control_id", input.telnyxCallControlId)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) return toAppRecord(existing);
  }

  const { data, error } = await supabase
    .from("missed_call_recoveries")
    .insert({
      client_id: input.clientId, // ✅ CRITICAL
      caller_phone: input.callerPhone,
      forwarded_to_number: input.forwardedToNumber,
      telnyx_call_control_id: input.telnyxCallControlId || null,
      status: "missed_triggered",
      sms_sent: false,
      callback_scheduled: false,
      callback_status: null,
      callback_attempts: 0
    })
    .select("*")
    .single();

  if (error) throw error;

  return toAppRecord(data);
}

/**
 * Get recovery by ID
 */
export async function getRecovery(id) {
  const { data, error } = await supabase
    .from("missed_call_recoveries")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return toAppRecord(data);
}

/**
 * Update recovery safely
 */
export async function updateRecovery(id, updates) {
  const dbUpdates = {
    updated_at: new Date().toISOString()
  };

  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.smsSent !== undefined) dbUpdates.sms_sent = updates.smsSent;
  if (updates.callbackScheduled !== undefined)
    dbUpdates.callback_scheduled = updates.callbackScheduled;
  if (updates.callbackStatus !== undefined)
    dbUpdates.callback_status = updates.callbackStatus;
  if (updates.callbackAttempts !== undefined)
    dbUpdates.callback_attempts = updates.callbackAttempts;

  const { data, error } = await supabase
    .from("missed_call_recoveries")
    .update(dbUpdates)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return toAppRecord(data);
}

/**
 * List all recoveries
 */
export async function listRecoveries() {
  const { data, error } = await supabase
    .from("missed_call_recoveries")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data.map(toAppRecord);
}