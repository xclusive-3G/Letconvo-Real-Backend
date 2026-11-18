import axios from "axios";
import { supabase } from "../config/supabase.js";
import { processCompletedCall } from "./retellCallProcessor.js";

const RETELL_API = "https://api.retellai.com";
const retellHeaders = () => ({
  Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
  "Content-Type": "application/json"
});

// Retell webhook delivery has proven unreliable in practice (calls that
// clearly happened never triggered call_ended here). This pulls the
// source-of-truth call list straight from Retell and backfills anything
// missing, so the dashboard reflects reality even when the push webhook
// silently fails.
//
// Most businesses share one master agent (RETELL_LIVE_AGENT_ID), so the
// agent's call list contains every business's calls. Only calls that
// provably belong to THIS business are backfilled — same ownership rule as
// router/retellWebhook.js's resolveClientId (metadata.clientId, else one of
// the business's own numbers), plus the client_id dynamic variable that
// router/retellInboundWebhook.js stamps on inbound calls. Anything else is
// skipped, never attributed (and billed) to the wrong business.
export async function reconcileClientCalls(clientId, { limit = 50 } = {}) {
  const { data: settings, error: settingsError } = await supabase
    .from("client_settings")
    .select("retell_agent_id")
    .eq("client_id", clientId)
    .maybeSingle();

  if (settingsError) throw settingsError;

  const agentId = settings?.retell_agent_id?.trim() || process.env.RETELL_LIVE_AGENT_ID;
  if (!agentId) {
    return { checked: 0, backfilled: 0, reason: "no Retell agent configured" };
  }

  const { data: numberRows, error: numbersError } = await supabase
    .from("client_numbers")
    .select("telnyx_number")
    .eq("client_id", clientId);

  if (numbersError) throw numbersError;
  const ownNumbers = new Set((numberRows || []).map((r) => r.telnyx_number).filter(Boolean));

  // v3 replaced the retired v2/list-calls: filter_criteria.agent is a list
  // of { agent_id }, and calls come back under `items`. The list payload
  // omits transcripts, so full details are fetched per call below.
  const { data: page } = await axios.post(
    `${RETELL_API}/v3/list-calls`,
    {
      filter_criteria: { agent: [{ agent_id: agentId }] },
      limit,
      sort_order: "descending"
    },
    { headers: retellHeaders() }
  );

  const items = page?.items || [];
  const mightBeOurs = (call) =>
    call?.metadata?.clientId === clientId ||
    ownNumbers.has(call?.to_number) ||
    ownNumbers.has(call?.from_number);

  const candidates = items.filter((c) => c.call_status === "ended" && mightBeOurs(c));

  // Skip calls already logged before paying for a get-call round trip each.
  const ids = candidates.map((c) => c.call_id);
  const { data: logged, error: loggedError } = ids.length
    ? await supabase.from("retell_call_logs").select("retell_call_id").in("retell_call_id", ids)
    : { data: [], error: null };
  if (loggedError) throw loggedError;
  const alreadyLogged = new Set((logged || []).map((r) => r.retell_call_id));

  let backfilled = 0;
  let skippedOtherClient = 0;

  for (const item of candidates) {
    if (alreadyLogged.has(item.call_id)) continue;

    const { data: call } = await axios.get(`${RETELL_API}/v2/get-call/${item.call_id}`, {
      headers: retellHeaders()
    });

    // A number can be reassigned between businesses; when the call itself
    // says which business it was for, that wins.
    const stampedClientId = call?.metadata?.clientId || call?.retell_llm_dynamic_variables?.client_id;
    if (stampedClientId && stampedClientId !== clientId) {
      skippedOtherClient += 1;
      continue;
    }

    const result = await processCompletedCall({ call, clientId, rawEvent: { event: "call_ended", call } });
    if (result.processed) backfilled += 1;
  }

  return { checked: items.length, candidates: candidates.length, backfilled, skippedOtherClient };
}
