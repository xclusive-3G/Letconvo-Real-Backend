import axios from "axios";
import { getBusinessHours } from "../utils/bookings.js";

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