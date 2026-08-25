import axios from "axios";

export const callUser = async (phone) => {
  console.log("📞 Initiating call:", phone);

  await axios.post(
    "https://api.telnyx.com/v2/calls",
    {
      connection_id: process.env.TELNYX_CONNECTION_ID,
      to: phone,
      from: process.env.TELNYX_FROM,

      // 🔥 Retell handles conversation
      webhook_url: "https://your-ngrok-url/retell-webhook"
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );
};