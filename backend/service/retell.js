import axios from "axios";
import { supabase } from "../config/supabase.js";
import { getBusinessHours, formatDateHuman, formatTimeHuman } from "../utils/bookings.js";

const formatHour = (h) => {
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:00 ${period}`;
};

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