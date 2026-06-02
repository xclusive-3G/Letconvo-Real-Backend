import { supabase } from "../../config/supabase.js";

export async function createBillingTransaction({
  clientId,
  type,
  description,
  amount,
  balanceAfter,
  minutes = 0,
  status = "completed",
  reference = null
}) {
  const { error } = await supabase.from("billing_transactions").insert({
    client_id: clientId,
    type,
    description,
    amount,
    balance_after: balanceAfter,
    minutes,
    status,
    reference
  });

  if (error) throw error;
}