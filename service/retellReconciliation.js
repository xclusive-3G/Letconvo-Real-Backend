import axios from "axios";
import { supabase } from "../config/supabase.js";
import { processCompletedCall } from "./retellCallProcessor.js";

const RETELL_API_KEY = process.env.RETELL_API_KEY;

// Retell webhook delivery has proven unreliable in practice (calls that
// clearly happened never triggered call_ended here). This pulls the
// source-of-truth call list straight from Retell for a client's own agent
// and backfills anything missing, so the dashboard reflects reality even
// when the push webhook silently fails.
export async function reconcileClientCalls(clientId, { limit = 20 } = {}) {
  const { data: settings, error: settingsError } = await supabase
    .from("client_settings")
    .select("retell_agent_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (settingsError) throw settingsError;
  if (!settings?.retell_agent_id) {
    return { checked: 0, backfilled: 0, reason: "no retell_agent_id configured" };
  }

  const { data: calls } = await axios.post(
    "https://api.retellai.com/v2/list-calls",
    {
      filter_criteria: { agent_id: [settings.retell_agent_id] },
      limit,
      sort_order: "descending"
    },
    { headers: { Authorization: `Bearer ${RETELL_API_KEY}`, "Content-Type": "application/json" } }
  );

  let backfilled = 0;

  for (const call of calls) {
    if (call.call_status !== "ended") continue;

    const result = await processCompletedCall({ call, clientId, rawEvent: { event: "call_ended", call } });
    if (result.processed) backfilled += 1;
  }

  return { checked: calls.length, backfilled };
}
