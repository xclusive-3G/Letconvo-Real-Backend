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


async function answerCall(callControlId) {
  const response = await axios.post(
    `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
    {},
    {
      headers: {
        Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data;
}

// Telnyx's transfer action requires the call to already be answered — calling
// it immediately on call.initiated races an implicit auto-answer and
// intermittently fails with a 422 ("call has already ended" / invalid state).
// Answering explicitly first removes that race.
export async function transferCallToRetellSip({
  callControlId,
  retellAgentId
}) {
  const sipUri = `sip:${retellAgentId}@sip.retellai.com`;

  try {
    await answerCall(callControlId);
  } catch (err) {
    // Already answered (e.g. by a prior webhook retry) is fine to ignore —
    // any other failure here means the call itself is gone, so transfer
    // would fail too; let it surface below via the same error path.
    const alreadyAnswered = err.response?.data?.errors?.some(
      (e) => String(e?.code) === "90009" || /already answered/i.test(e?.detail || "")
    );
    if (!alreadyAnswered) {
      console.error("❌ Telnyx answer failed:", JSON.stringify(err.response?.data || err.message, null, 2));
      throw err;
    }
  }

  try {
    const response = await axios.post(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/transfer`,
      {
        to: sipUri
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