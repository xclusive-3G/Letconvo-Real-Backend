import axios from "axios";
import { supabase } from "../config/supabase.js";
import { getBusinessHours, formatDateHuman, formatTimeHuman } from "../utils/bookings.js";

const formatHour = (h) => {
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:00 ${period}`;
};

// Must match the route in router/retellInboundWebhook.js exactly — this is
// what Retell POSTs to before answering any call on a number imported this
// way, to resolve override_agent_id + dynamic_variables.
const RETELL_INBOUND_WEBHOOK_URL = "https://api.letconvo.live/webhooks/retell/inbound-call";

// Registers a Telnyx-owned number directly with Retell as a native inbound
// number (10s webhook budget) instead of relying on the app's own
// SIP-transfer path (~1s Telnyx budget, too tight for a DB round trip —
// see router/telnyxVoiceWebhook2.js). Used by the admin panel's "migrate
// to Retell-native routing" action. Safe to call on a number that's
// already imported — Retell rejects the create with an "already exists"
// style error, so this deletes the stale registration and retries once
// rather than requiring the admin to do that manually first.
export async function importPhoneNumberToRetellNative({ phoneNumber, agentId, nickname, sipCreds }) {
  const payload = {
    phone_number: phoneNumber,
    termination_uri: sipCreds.terminationUri,
    sip_trunk_auth_username: sipCreds.authUsername,
    sip_trunk_auth_password: sipCreds.authPassword,
    transport: sipCreds.transport,
    nickname: nickname || phoneNumber,
    inbound_agents: [{ agent_id: agentId, weight: 1 }],
    inbound_webhook_url: RETELL_INBOUND_WEBHOOK_URL
  };

  const headers = {
    Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
    "Content-Type": "application/json"
  };

  try {
    const res = await axios.post("https://api.retellai.com/import-phone-number", payload, { headers });
    return res.data;
  } catch (err) {
    const message = JSON.stringify(err.response?.data || "");
    if (!/already|exist/i.test(message)) throw err;

    await axios
      .delete(`https://api.retellai.com/delete-phone-number/${encodeURIComponent(phoneNumber)}`, { headers })
      .catch(() => {});

    const retryRes = await axios.post("https://api.retellai.com/import-phone-number", payload, { headers });
    return retryRes.data;
  }
}

export async function createRetellCallback({
  toNumber,
  recoveryId,
  clientId
}) {
  // Unlike the live SIP-transfer path (service/telnyx.js's
  // transferCallToRetellSip, which has no channel to inject per-call
  // variables), we create this call ourselves via Retell's API, so the
  // agent's prompt can reference {{business_hours}} directly instead of
  // needing a tool call — /retell/get-business-hours (router/retellGetSlot.js)
  // still exists as the on-demand fallback for the live path.
  const { openHour, closeHour } = await getBusinessHours(clientId);

  const response = await axios.post(
    "https://api.retellai.com/v2/create-phone-call",
    {
      from_number: process.env.RETELL_FROM_NUMBER,
      to_number: toNumber,
      metadata: {
        clientId,
        recoveryId,
        source: "missed_call_recovery"
      },
      retell_llm_dynamic_variables: {
        business_hours: `${formatHour(openHour)} to ${formatHour(closeHour)}, Monday through Saturday`
      }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data;
}


// Placed ~20 minutes before a booking's scheduled time (see
// utils/bookings.js's scheduleAppointmentReminder / the "appointment-
// reminders" queue processed in worker.js). Same no-explicit-agent_id
// pattern as createRetellCallback — relies on RETELL_FROM_NUMBER's bound
// agent, not a per-client one.
//
// For the agent to actually act on "customer says they're not coming",
// its Retell dashboard prompt needs a tool call to POST
// /retell/update-booking with { clientId, phone, status: "cancelled" }
// (router/retellUpdateBooking.js) — that part is prompt configuration on
// the business's Retell agent, not something this function can do itself.
export async function createRetellReminderCall({ toNumber, clientId, booking }) {
  const { data: client } = await supabase
    .from("clients")
    .select("business_name")
    .eq("id", clientId)
    .maybeSingle();

  const response = await axios.post(
    "https://api.retellai.com/v2/create-phone-call",
    {
      from_number: process.env.RETELL_FROM_NUMBER,
      to_number: toNumber,
      metadata: {
        clientId,
        bookingId: booking.id,
        source: "appointment_reminder"
      },
      retell_llm_dynamic_variables: {
        business_name: client?.business_name || "the business",
        customer_name: booking.customer_name || "there",
        appointment_date: formatDateHuman(booking.appointment_date),
        appointment_time: formatTimeHuman(booking.appointment_time),
        service: booking.service || "your appointment"
      }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data;
}

export async function createRetellLiveCall({
  toNumber,
  clientId,
  agentId,
  fromNumber
}) {
  const response = await axios.post(
    "https://api.retellai.com/v2/create-phone-call",
    {
      from_number: fromNumber,
      to_number: toNumber,
      agent_id: agentId,
      metadata: {
        clientId,
        source: "live_call"
      }
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data;
}