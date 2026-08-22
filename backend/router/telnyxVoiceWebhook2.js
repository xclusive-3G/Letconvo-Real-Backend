// import express from "express";
// import axios from "axios";
// import { triggerMissedCallRecovery } from "../service/recovery.js";
// import { getClientByTelnyxNumber } from "../service/credit.js";
// import { logger } from "../utils/logger.js";
// import { supabase } from "../../config/supabase.js";
// import { createRetellLiveCall } from "../service/retell.js";

// const router = express.Router();

// const MIN_START_CREDITS = 100; // block live/callback if client has less than this

// async function hangupCall(callControlId) {
//   await axios.post(
//     `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`,
//     {},
//     {
//       headers: {
//         Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
//         "Content-Type": "application/json"
//       }
//     }
//   );
// }

// router.post("/telnyx/voice", async (req, res) => {
//   res.sendStatus(200);

//   try {
//     const eventType = req.body?.data?.event_type;
//     const payload = req.body?.data?.payload;

//     const callerPhone = payload?.from;
//     const to = payload?.to;
//     const callControlId = payload?.call_control_id;
//     const direction = payload?.direction;

//     logger.info("Telnyx voice webhook", {
//       eventType,
//       callerPhone,
//       to,
//       callControlId,
//       direction
//     });

//     if (eventType !== "call.initiated") return;

//     if (direction !== "incoming") {
//       console.log("⛔ Ignoring non-incoming call:", {
//         from: callerPhone,
//         to,
//         direction
//       });
//       return;
//     }

//     const client = await getClientByTelnyxNumber(to);

//     if (!client) {
//       console.log("❌ No client found for number:", to);
//       await hangupCall(callControlId);
//       return;
//     }

//     // ✅ BLOCK BEFORE RETELL OR CALLBACK STARTS
//     if (
//       client.status !== "active" ||
//       Number(client.credits_remaining || 0) < MIN_START_CREDITS
//     ) {
//       console.log("❌ Client blocked before Retell starts:", {
//         clientId: client.id,
//         businessName: client.business_name,
//         credits: client.credits_remaining,
//         status: client.status
//       });
//       await supabase
//         .from("clients")
//         .update({ status: "paused" })
//         .eq("id", client.id);

//       try {
//         await hangupCall(callControlId);
//         console.log("✅ Call terminated successfully");
//       } catch (err) {
//         console.log("❌ Hangup failed:", err.response?.data || err.message);
//       }

//       return;
//     }

//     if (client.receptionist_mode === "live") {
//       console.log("☎️ LIVE MODE → calling Retell immediately");

//       const { data: settings, error } = await supabase
//         .from("client_settings")
//         .select("retell_agent_id, retell_from_number")
//         .eq("client_id", client.id)
//         .maybeSingle();

//       if (error) {
//         console.log("❌ Error fetching client settings:", error.message);
//         await hangupCall(callControlId);
//         return;
//       }

//       if (!settings?.retell_agent_id || !settings?.retell_from_number) {
//         console.log("❌ Missing agent or number for client:", client.id);
//         await hangupCall(callControlId);
//         return;
//       }

//       await createRetellLiveCall({
//         toNumber: callerPhone.trim(),
//         clientId: client.id,
//         agentId: settings.retell_agent_id.trim(),
//         fromNumber: settings.retell_from_number.trim()
//       });

//       return;
//     }

//     console.log("📞 CALLBACK MODE → queuing missed-call recovery");

//     await triggerMissedCallRecovery({
//       clientId: client.id,
//       callerPhone,
//       forwardedToNumber: to,
//       telnyxCallControlId: callControlId
//     });
//   } catch (err) {
//     logger.error("Error handling Telnyx voice webhook", err);
//   }
// });

// export default router;


import express from "express";
import axios from "axios";
import { triggerMissedCallRecovery } from "../service/recovery.js";
import { logger } from "../utils/logger.js";
import { supabase } from "../config/supabase.js";
// import { createRetellLiveCall } from "../service/retell.js";
import { transferCallToRetellSip, warmTelnyxConnection } from "../service/telnyx.js";
import { telnyxKeepAliveAgent } from "../config/httpAgents.js";

const router = express.Router();

const MIN_START_CREDITS = 0; // block live/callback if client has less than this

async function hangupCall(callControlId) {
  await axios.post(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`,
    {},
    {
      headers: {
        Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
        "Content-Type": "application/json"
      },
      httpsAgent: telnyxKeepAliveAgent
    }
  );
}

const formatHour = (h) => {
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:00 ${period}`;
};

// SIP header values ride straight into the INVITE Telnyx sends Retell —
// strip CR/LF so a business's own free-text settings can't inject extra
// headers, and cap length since these are short signaling fields, not a
// place for a whole paragraph.
const sanitizeHeaderValue = (value, maxLen = 200) =>
  String(value ?? "")
    .replace(/[\r\n]/g, " ")
    .trim()
    .slice(0, maxLen);

// Builds the X- headers that become the master agent's per-call dynamic
// variables (see transferCallToRetellSip / the master prompt's
// {{business_name}}, {{booking_fields}}, etc.). Only used for clients
// riding the shared agent — a client with its own retell_agent_id
// override doesn't need this.
function buildRetellDynamicVariableHeaders(client, settings) {
  const bookingFields = Array.isArray(settings?.booking_info_fields)
    ? settings.booking_info_fields.join(", ")
    : "";

  // open_hour/close_hour are stored as "HH:MM" strings (from the signup
  // form's <input type="time">), not plain integers — parseInt to match
  // utils/bookings.js's getBusinessHours, which relies on the same thing.
  const parsedOpen = parseInt(settings?.open_hour, 10);
  const parsedClose = parseInt(settings?.close_hour, 10);
  const openHour = formatHour(Number.isFinite(parsedOpen) ? parsedOpen : 9);
  const closeHour = formatHour(Number.isFinite(parsedClose) ? parsedClose : 18);

  // Retell turns an inbound "X-<name>" SIP header into a dynamic variable
  // named exactly "<name>" (prefix stripped, nothing else transformed) —
  // these header names are lowercase/underscored on purpose so they land
  // as {{client_id}}, {{business_name}}, etc. in the master prompt/tools,
  // not some re-cased variant.
  return [
    { name: "X-client_id", value: sanitizeHeaderValue(client.id, 64) },
    { name: "X-business_name", value: sanitizeHeaderValue(client.business_name || "the business") },
    { name: "X-business_type", value: sanitizeHeaderValue(settings?.businessType || "local business") },
    { name: "X-greeting_message", value: sanitizeHeaderValue(settings?.greeting || "") },
    { name: "X-open_hour", value: openHour },
    { name: "X-close_hour", value: closeHour },
    { name: "X-booking_fields", value: sanitizeHeaderValue(bookingFields || "Full Name, Phone Number") },
    { name: "X-services_offered", value: sanitizeHeaderValue(settings?.services_offered || "not specified") },
    { name: "X-booking_policies", value: sanitizeHeaderValue(settings?.booking_policies || "none specified") }
  ];
}

router.post("/telnyx/voice", async (req, res) => {
  res.sendStatus(200);

  try {
    const eventType = req.body?.data?.event_type;
    const payload = req.body?.data?.payload;

    const callerPhone = payload?.from;
    const to = payload?.to;
    const callControlId = payload?.call_control_id;
    const direction = payload?.direction;

    logger.info("Telnyx voice webhook", {
      eventType,
      callerPhone,
      to,
      callControlId,
      direction
    });

    if (eventType !== "call.initiated") return;

    if (direction !== "incoming") {
      console.log("⛔ Ignoring non-incoming call:", {
        from: callerPhone,
        to,
        direction
      });
      return;
    }

    // Not awaited on purpose — starts the TLS handshake to Telnyx right
    // now, in parallel with the Supabase lookup below, instead of paying
    // for it cold at the very end of the critical path (see
    // warmTelnyxConnection's own comment for why keep-alive reuse alone
    // isn't enough for infrequent, minutes-apart phone calls).
    warmTelnyxConnection();

    // Fetches client + client_settings in a single round trip (relies on
    // the client_settings.client_id -> clients.id FK — see
    // 006_add_client_settings_fk.sql) rather than getClientByTelnyxNumber
    // followed by a second sequential client_settings query. Telnyx gives
    // roughly ~1 second before it gives up on an unanswered inbound call
    // (observed: a transfer at 0.94s succeeded, one at 0.75s that hit two
    // sequential DB round trips first did not), so cutting one full
    // network hop off this path is what keeps the live-call transfer
    // inside that window.
    const { data: numberRow, error: lookupError } = await supabase
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
          plan_id,
          client_settings (
            retell_agent_id,
            businessType,
            greeting,
            open_hour,
            close_hour,
            booking_info_fields,
            services_offered,
            booking_policies
          )
        )
      `)
      .eq("telnyx_number", to)
      .maybeSingle();

    if (lookupError) {
      console.log("❌ Failed to look up client for number:", to, lookupError.message);
      await hangupCall(callControlId);
      return;
    }

    const client = numberRow?.client || null;

    if (!client) {
      console.log("❌ No client found for number:", to);
      await hangupCall(callControlId);
      return;
    }

    // PostgREST returns the embedded child as an array unless it knows the
    // relationship is one-to-one (no unique constraint on client_id here),
    // so normalize either shape defensively.
    const settings = Array.isArray(client.client_settings)
      ? client.client_settings[0] || null
      : client.client_settings || null;

    // ✅ BLOCK BEFORE RETELL OR CALLBACK STARTS
    if (
      client.status !== "active" ||
      Number(client.credits_remaining || 0) < MIN_START_CREDITS
    ) {
      console.log("❌ Client blocked before Retell starts:", {
        clientId: client.id,
        businessName: client.business_name,
        credits: client.credits_remaining,
        status: client.status
      });
      await supabase
        .from("clients")
        .update({ status: "paused" })
        .eq("id", client.id);

      try {
        await hangupCall(callControlId);
        console.log("✅ Call terminated successfully");
      } catch (err) {
        console.log("❌ Hangup failed:", err.response?.data || err.message);
      }

      return;
    }

    const mode = String(client.receptionist_mode || "")
  .trim()
  .toLowerCase();

if (mode === "live") {
  console.log("☎️ LIVE MODE → transferring call to Retell SIP");

  // A per-client agent (hand-built by an admin) always wins if set — this
  // keeps any already-configured client untouched. Everyone else (every
  // new signup by default) rides the one shared master agent instead,
  // personalized per call via SIP header -> dynamic variable injection
  // (see transferCallToRetellSip) rather than a bespoke agent each.
  const retellAgentId = settings?.retell_agent_id?.trim() || process.env.RETELL_LIVE_AGENT_ID;

  if (!retellAgentId) {
    console.log("❌ No Retell agent available (no per-client override and RETELL_LIVE_AGENT_ID unset) for client:", client.id);
    await hangupCall(callControlId);
    return;
  }

  await transferCallToRetellSip({
    callControlId,
    retellAgentId,
    customHeaders: buildRetellDynamicVariableHeaders(client, settings)
  });

  return;
}

if (mode === "callback") {
  console.log("📞 CALLBACK MODE → queuing missed-call recovery");

  await triggerMissedCallRecovery({
    clientId: client.id,
    callerPhone,
    forwardedToNumber: to,
    telnyxCallControlId: callControlId
  });

  return;
}

console.log("❌ Invalid receptionist mode:", mode);
await hangupCall(callControlId);
return;

  } catch (err) {
    logger.error("Error handling Telnyx voice webhook", err);
  }
});

export default router;