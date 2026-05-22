import axios from "axios";

export async function createRetellCallback({
  toNumber,
  recoveryId,
  clientId
}) {
  
  const response = await axios.post(
    "https://api.retellai.com/v2/create-phone-call",
    {
      from_number: process.env.RETELL_FROM_NUMBER,
      to_number: toNumber,
      metadata: {
        clientId,
        recoveryId,
        source: "missed_call_recovery"
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