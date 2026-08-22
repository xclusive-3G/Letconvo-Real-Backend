import axios from "axios";
import { env } from "../config/config.js";

export async function sendMissedCallSms(to) {
  const text =
    "Sorry we missed your call. This is Bella, our assistant. We’ll call you shortly.";

  try {
    const response = await axios.post(
      "https://api.telnyx.com/v2/messages",
      {
        from: env.TELNYX_SMS_FROM,
        to,
        text
      },
      {
        headers: {
          Authorization: `Bearer ${env.TELNYX_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ SMS sent:", response.data);

    return response.data;

  } catch (error) {

    console.error(
      "❌ TELNYX SMS ERROR:",
      JSON.stringify(error.response?.data || error.message, null, 2)
    );

    throw error;
  }
}


// NOTE: this connection is an FQDN/SIP-trunk-style Telnyx connection, not a
// traditional Call Control app — Telnyx rejects an explicit /actions/answer
// on these calls with "Can not issue an answer command on an outbound call"
// (code 90102), even though the call is genuinely inbound from our side.
// Do not add an answer step here; transfer directly.
export async function transferCallToRetellSip({
  callControlId,
  retellAgentId,
  // [{ name, value }] — becomes SIP INVITE headers. Retell auto-converts
  // any inbound X-/x- prefixed header into a dynamic variable (stripping
  // the prefix), which is how a single shared agent gets per-client
  // context on this SIP-transfer path (its REST API's own
  // retell_llm_dynamic_variables param has no equivalent here).
  customHeaders
}) {
  const sipUri = `sip:${retellAgentId}@sip.retellai.com`;

  try {
    const response = await axios.post(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/transfer`,
      {
        to: sipUri,
        ...(customHeaders?.length ? { custom_headers: customHeaders } : {})
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    return response.data;
  } catch (err) {
    console.error("❌ Telnyx transfer failed:", JSON.stringify(err.response?.data || err.message, null, 2));
    throw err;
  }
}