import express from "express";
import { supabase } from "../config/supabase.js";
import { findLatestBooking, formatDateHuman, formatTimeHuman, toHHMM, ACTIVE_STATUSES } from "../utils/bookings.js";

const router = express.Router();

// Same threshold telnyxVoiceWebhook2.js's live/callback gate uses — 30
// credits = 1 minute of call time (CREDITS_PER_SECOND in
// retellCallProcessor.js).
const MIN_START_CREDITS = 30;

const formatHour = (h) => {
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:00 ${period}`;
};

// For any number registered directly in Retell (imported via Retell's
// /import-phone-number API, not routed through Telnyx's SIP-transfer path)
// with this URL set as its "Inbound Webhook URL". Retell POSTs here BEFORE answering
// and waits up to 10 seconds for a response — a much wider budget than the
// ~1 second Telnyx allows on the SIP-transfer path (router/
// telnyxVoiceWebhook2.js), which turned out to be too tight for a DB
// lookup no matter how optimized. Same per-client resolution logic as that
// file, just delivered as dynamic_variables/override_agent_id instead of
// SIP custom headers.
router.post("/webhooks/retell/inbound-call", async (req, res) => {
  try {
    if (req.body?.event !== "call_inbound") {
      return res.json({});
    }

    const toNumber = req.body?.call_inbound?.to_number;

    if (!toNumber) {
      console.log("❌ Retell inbound webhook: no to_number in payload");
      return res.json({ call_inbound: { reject: true } });
    }

    const { data: numberRow, error } = await supabase
      .from("client_numbers")
      .select(`
        id,
        client:clients (
          id,
          business_name,
          credits_remaining,
          status,
          receptionist_mode,
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
      .eq("telnyx_number", toNumber)
      .maybeSingle();

    if (error) {
      console.log("❌ Retell inbound webhook: lookup failed for", toNumber, error.message);
      return res.json({ call_inbound: { reject: true } });
    }

    const client = numberRow?.client || null;

    if (!client) {
      console.log("❌ Retell inbound webhook: no client for number", toNumber);
      return res.json({ call_inbound: { reject: true } });
    }

    // <= not < — see telnyxVoiceWebhook2.js's identical gate for why a
    // client sitting at exactly the floor must be blocked here too.
    if (
      client.status !== "active" ||
      Number(client.credits_remaining || 0) <= MIN_START_CREDITS
    ) {
      console.log("❌ Retell inbound webhook: client blocked", {
        clientId: client.id,
        status: client.status,
        credits: client.credits_remaining
      });
      await supabase.from("clients").update({ status: "paused" }).eq("id", client.id);
      return res.json({ call_inbound: { reject: true } });
    }

    const settings = Array.isArray(client.client_settings)
      ? client.client_settings[0] || null
      : client.client_settings || null;

    const agentId = settings?.retell_agent_id?.trim() || process.env.RETELL_LIVE_AGENT_ID;

    if (!agentId) {
      console.log("❌ Retell inbound webhook: no agent available for client", client.id);
      return res.json({ call_inbound: { reject: true } });
    }

    const bookingFields = Array.isArray(settings?.booking_info_fields)
      ? settings.booking_info_fields.join(", ")
      : "Full Name, Phone Number";

    const parsedOpen = parseInt(settings?.open_hour, 10);
    const parsedClose = parseInt(settings?.close_hour, 10);

    // Looked up here — deterministically, before the call is even answered
    // — rather than leaving "does this caller already have a booking?" to
    // the LLM remembering to call get_booking/check_backend first. Real
    // calls showed the model sometimes skips that instruction entirely and
    // just guesses/hallucinates an answer instead of calling the tool, so
    // this can no longer depend on the LLM choosing to look it up.
    const fromNumber = req.body?.call_inbound?.from_number;
    let existingBooking = null;

    if (fromNumber) {
      try {
        existingBooking = await findLatestBooking(client.id, fromNumber);
      } catch (bookingErr) {
        console.log("⚠️ Retell inbound webhook: booking lookup failed, continuing without it", bookingErr.message);
      }
    }

    // A booking that's already in the past (or cancelled/completed) isn't
    // something to offer "reschedule or cancel" for — that only makes
    // sense while it's still upcoming. Computed here rather than trusting
    // the LLM to reason about dates correctly mid-call.
    let bookingIsUpcoming = false;
    if (existingBooking) {
      const apptDateTime = new Date(`${existingBooking.appointment_date}T${toHHMM(existingBooking.appointment_time)}:00`);
      bookingIsUpcoming =
        !Number.isNaN(apptDateTime.getTime()) &&
        apptDateTime.getTime() > Date.now() &&
        ACTIVE_STATUSES.includes(existingBooking.status);
    }

    return res.json({
      call_inbound: {
        override_agent_id: agentId,
        dynamic_variables: {
          client_id: client.id,
          business_name: client.business_name || "the business",
          business_type: settings?.businessType || "local business",
          greeting_message: settings?.greeting || "",
          open_hour: formatHour(Number.isFinite(parsedOpen) ? parsedOpen : 9),
          close_hour: formatHour(Number.isFinite(parsedClose) ? parsedClose : 18),
          booking_fields: bookingFields,
          services_offered: settings?.services_offered || "not specified",
          booking_policies: settings?.booking_policies || "none specified",
          has_existing_booking: existingBooking ? "yes" : "no",
          booking_is_upcoming: bookingIsUpcoming ? "yes" : "no",
          existing_booking_summary: existingBooking
            ? `${existingBooking.customer_name || "Caller"}, ${existingBooking.service || "an appointment"} on ${formatDateHuman(existingBooking.appointment_date)} at ${formatTimeHuman(existingBooking.appointment_time)}, currently ${existingBooking.status}.`
            : "none"
        }
      }
    });
  } catch (err) {
    console.error("❌ Retell inbound webhook error:", err);
    return res.json({ call_inbound: { reject: true } });
  }
});

export default router;
